import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import electron from 'electron';

export function launchDesktop(args = [], stdio = 'inherit', executable) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return executable
    ? spawn(executable, args, { cwd: dirname(executable), env, stdio })
    : spawn(electron, ['.', ...args], { env, stdio });
}
