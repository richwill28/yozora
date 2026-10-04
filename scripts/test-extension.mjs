import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

const root = fileURLToPath(new URL('../', import.meta.url));

await runTests({
  version: '1.140.0',
  extensionDevelopmentPath: root,
  extensionTestsPath: path.join(root, 'node_modules/@vscode/test-cli/out/runner.cjs'),
  extensionTestsEnv: {
    VSCODE_TEST_OPTIONS: JSON.stringify({
      files: [path.join(root, 'dist/test/integration/viewer.test.cjs')],
      mochaOpts: { timeout: 90_000, reporter: 'spec' },
      preload: [],
      colorDefault: false,
    }),
  },
  launchArgs: [
    '--no-sandbox',
    '--disable-gpu',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-workspace-trust',
    '--disable-extensions',
  ],
});
