import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import electron from 'electron';

if (process.platform !== 'win32' || process.arch !== 'x64')
  throw new Error('Build the Windows package on Windows x64.');

const output = resolve(process.argv[2] ?? 'release');
const { name, version, main, type } = JSON.parse(await readFile('package.json', 'utf8'));
const [installed] = JSON.parse(execFileSync(process.execPath, [
  process.env.npm_execpath, 'list', '--prod', '--depth', 'Infinity', '--json',
], { encoding: 'utf8' }));

// pnpm uses junctions to share packages. Copy the resolved production
// packages themselves so the archive works outside this checkout.
const runtime = new Map();
function addDependencies(dependencies = {}) {
  for (const [name, dependency] of Object.entries(dependencies)) {
    if (name.startsWith('@smartspectra/node-sdk-') && name !== '@smartspectra/node-sdk-win32-x64')
      continue;
    if (runtime.has(name)) {
      if (runtime.get(name) !== dependency.path)
        throw new Error('The package contains conflicting versions of ' + name + '.');
      continue;
    }
    runtime.set(name, dependency.path);
    addDependencies(dependency.dependencies);
    addDependencies(dependency.optionalDependencies);
  }
}
addDependencies(installed.dependencies);

await mkdir(output, { recursive: true });
const staging = await mkdtemp(join(output, '.cueback-'));
const archive = name + '-' + version + '-windows-x64.zip';
try {
  const bundle = join(staging, name);
  await cp(dirname(electron), bundle, {
    recursive: true,
    filter: path => basename(path) !== 'default_app.asar',
  });
  await rename(join(bundle, basename(electron)), join(bundle, name + '.exe'));
  const app = join(bundle, 'resources', 'app');
  await mkdir(app, { recursive: true });
  await cp('README.md', join(bundle, 'README.md'));
  await cp(main, join(app, main));
  const dist = join(app, 'dist');
  await mkdir(dist);
  for (const asset of ['index.html', 'style.css', 'renderer.js', 'preload.cjs', 'fonts', 'lesson'])
    await cp(join('dist', asset), join(dist, asset), { recursive: true });
  for (const [name, source] of runtime)
    await cp(source, join(app, 'node_modules', name), { recursive: true, dereference: true });

  // Electron only needs the entry point and the app's identity at runtime.
  await writeFile(join(app, 'package.json'), JSON.stringify({ name, version, main, type }) + '\n');
  execFileSync('tar.exe', ['-a', '-cf', join(staging, archive), '-C', staging, name], { stdio: 'inherit' });
  await rename(join(staging, archive), join(output, archive));
  console.log(join(output, archive));
} finally {
  await rm(staging, { recursive: true, force: true });
}
