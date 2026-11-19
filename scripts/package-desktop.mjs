import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import electron from 'electron';
import cameraSupported from '../electron/camera-support.cjs';

const platforms = { win32: 'windows', darwin: 'macos', linux: 'linux' };
const platform = platforms[process.platform];
if (!platform || !['x64', 'arm64'].includes(process.arch))
  throw new Error(`Unsupported packaging host: ${process.platform}-${process.arch}`);

const windows = process.platform === 'win32';
const mac = process.platform === 'darwin';
const output = resolve(process.argv[2] ?? 'release');
const { name, version, main, type } = JSON.parse(await readFile('package.json', 'utf8'));
const archive = `${name}-${version}-${platform}-${process.arch}.${windows || mac ? 'zip' : 'tar.gz'}`;
const nativePackage = `@smartspectra/node-sdk-${process.platform}-${process.arch}`;
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });

// Copy the resolved pnpm packages, since junctions won't survive extraction.
const runtime = new Map();
function addDependencies(dependencies = {}) {
  for (const [name, dependency] of Object.entries(dependencies)) {
    if (name.startsWith('@smartspectra/node-sdk-') && name !== nativePackage) continue;
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
if (cameraSupported()) {
  const [installed] = JSON.parse(execFileSync(process.execPath, [
    process.env.npm_execpath, 'list', '--prod', '--depth', 'Infinity', '--json',
  ], { encoding: 'utf8' }));
  addDependencies(installed.dependencies);
  if (!runtime.has(nativePackage)) throw new Error('Missing runtime package ' + nativePackage);
}

await mkdir(output, { recursive: true });
const staging = await mkdtemp(join(output, '.cueback-'));
try {
  const bundle = join(staging, name);
  const macApp = join(bundle, name + '.app');
  const resources = mac ? join(macApp, 'Contents', 'Resources') : join(bundle, 'resources');
  if (mac) {
    const electronApp = resolve(dirname(electron), '..', '..');
    await mkdir(bundle);
    run('ditto', [electronApp, macApp]);
    const plist = join(macApp, 'Contents', 'Info.plist');
    for (const [key, value] of Object.entries({
      CFBundleName: name,
      CFBundleDisplayName: name,
      CFBundleIdentifier: 'com.arjuncodess.cueback',
      CFBundleShortVersionString: version,
    })) run('plutil', ['-replace', key, '-string', value, plist]);
    run('plutil', ['-replace', 'NSCameraUsageDescription', '-string',
      'cueback uses your camera to pause and replay the current tutorial step.', plist]);
    for (const license of ['LICENSE', 'LICENSES.chromium.html'])
      await cp(join(dirname(electronApp), license), join(bundle, license));
  } else {
    await cp(dirname(electron), bundle, { recursive: true });
    await rename(join(bundle, basename(electron)), join(bundle, windows ? name + '.exe' : name));
  }
  await rm(join(resources, 'default_app.asar'), { force: true });
  const app = join(resources, 'app');
  await mkdir(app, { recursive: true });
  await cp('README.md', join(bundle, 'README.md'));
  await mkdir(join(app, dirname(main)), { recursive: true });
  for (const file of [main, 'electron/camera-support.cjs']) await cp(file, join(app, file));
  const dist = join(app, 'dist');
  await mkdir(dist);
  for (const asset of ['index.html', 'style.css', 'renderer.js', 'preload.cjs', 'fonts', 'lesson'])
    await cp(join('dist', asset), join(dist, asset), { recursive: true });
  for (const [name, source] of runtime)
    await cp(source, join(app, 'node_modules', name), { recursive: true, dereference: true });
  await writeFile(join(app, 'package.json'), JSON.stringify({ name, version, main, type }) + '\n');

  const stagedArchive = join(staging, archive);
  if (mac) {
    run('codesign', ['--force', '--deep', '--sign', '-', macApp]);
    run('codesign', ['--verify', '--deep', '--strict', macApp]);
    run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', bundle, stagedArchive]);
  } else {
    const tar = windows ? join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';
    run(tar, [windows ? '-a' : '-z', '-cf', stagedArchive, '-C', staging, name]);
  }
  await rename(stagedArchive, join(output, archive));
  console.log(join(output, archive));
} finally {
  await rm(staging, { recursive: true, force: true });
}
