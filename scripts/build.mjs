import { cp, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

await mkdir('dist', { recursive: true });
await Promise.all([
  cp('index.html', 'dist/index.html'),
  cp('src/style.css', 'dist/style.css'),
  cp('public/lesson', 'dist/lesson', { recursive: true }),
  build({
    entryPoints: ['src/renderer.ts'],
    outfile: 'dist/renderer.js',
    bundle: true,
    platform: 'browser',
    target: 'es2023',
  }),
]);
