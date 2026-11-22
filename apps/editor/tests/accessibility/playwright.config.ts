import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'full-workspace.spec.ts',
  workers: 1,
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
  ],
});
