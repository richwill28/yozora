import { spawn } from 'node:child_process';

import { verifyCorpus } from './verify-corpus.mjs';

const args = process.argv.slice(2);
const captureBaselines = args.includes('--baseline');
const compareScreenshots = captureBaselines || args.includes('--visual');
const playwrightArgs = args.filter((arg) => !['--baseline', '--visual'].includes(arg));

async function runNodeScript(script, scriptArgs = []) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...scriptArgs], {
      stdio: 'inherit',
      env: { ...process.env, YOZORA_PAPER_VISUAL: compareScreenshots ? '1' : '0' },
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${script} failed (${signal ?? code})`));
      }
    });
  });
}

await verifyCorpus();
await runNodeScript('scripts/build.mjs');

if (captureBaselines) {
  console.log(
    'Capturing local baselines of current behavior. Inspect changes before accepting a new baseline.',
  );
}

await runNodeScript('node_modules/playwright/cli.js', [
  'test',
  ...(captureBaselines ? ['--update-snapshots=all'] : []),
  ...playwrightArgs,
]);
