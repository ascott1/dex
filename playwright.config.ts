import { defineConfig, devices } from '@playwright/test';

const PORT = 4319;

export default defineConfig({
  testDir: './e2e',
  // One worker, in order: the live-reload tests add a temporary deck, which
  // would change what `/` shows for tests running alongside them.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  globalTeardown: './e2e/teardown.ts',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    viewport: { width: 1600, height: 900 },
    reducedMotion: 'reduce',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } } },
  ],
  webServer: {
    // Plain vite, not `pnpm start`, so no browser tab opens on the machine.
    command: `vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/decks/index.json`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
