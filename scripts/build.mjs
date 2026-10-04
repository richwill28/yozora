import * as esbuild from 'esbuild';
import { readdir } from 'node:fs/promises';

import { ensurePdfJs } from './vendor-pdfjs.mjs';

const watch = process.argv.includes('--watch');

await ensurePdfJs();

const tests = [];
for (const directory of ['unit', 'integration']) {
  for (const file of await readdir(`test/${directory}`)) {
    if (file.endsWith('.ts')) {
      tests.push(`test/${directory}/${file}`);
    }
  }
}

const builds = [
  {
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.cjs',
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['vscode'],
  },
  {
    entryPoints: ['src/webview/bridge.ts', 'src/webview/viewer.css'],
    outdir: 'dist/webview',
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
  },
  {
    entryPoints: tests,
    outdir: 'dist/test',
    outbase: 'test',
    outExtension: { '.js': '.cjs' },
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['vscode', 'mocha'],
  },
];

for (const options of builds) {
  const context = await esbuild.context({
    ...options,
    bundle: true,
    sourcemap: true,
    logLevel: 'info',
  });

  if (watch) {
    await context.watch();
  } else {
    await context.rebuild();
    await context.dispose();
  }
}

console.log(watch ? 'Watching TypeScript and CSS sources.' : 'Build complete.');
