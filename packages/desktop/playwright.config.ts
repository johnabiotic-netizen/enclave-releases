import { defineConfig } from '@playwright/test';

// UI tests drive the real app (Electron), one at a time: they share Docker on this PC.
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: './e2e-results',
});
