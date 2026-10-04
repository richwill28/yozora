import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/papers',
  outputDir: 'test-results/papers',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  // Paper screenshots can contain transformed BY-ND content; keep every image local.
  snapshotPathTemplate: '.cache/paper-baselines/{platform}/{projectName}/{arg}{ext}',
  updateSnapshots: 'none',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1800, height: 1280 },
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    { name: 'chromium-dpr1', use: { browserName: 'chromium', deviceScaleFactor: 1 } },
    { name: 'chromium-dpr2', use: { browserName: 'chromium', deviceScaleFactor: 2 } },
  ],
  webServer: {
    command: 'node scripts/browser-harness.mjs',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
  reporter: [['list']],
});
