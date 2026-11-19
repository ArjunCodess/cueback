import { spawn } from 'node:child_process';
import electron from 'electron';

export function launchDesktop(args = [], stdio = 'inherit') {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return spawn(electron, ['.', ...args], { env, stdio });
}
