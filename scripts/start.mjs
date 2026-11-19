import { launchDesktop } from './desktop.mjs';

const child = launchDesktop();
child.once('error', error => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once('exit', code => { process.exitCode = code ?? 1; });
