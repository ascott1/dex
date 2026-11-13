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
    // The smoke tests (`pnpm test:e2e`). The screenshot spec is left out so they stay fast.
    {
      name: 'chromium',
      testIgnore: /shots\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } },
    },
    // `pnpm shots` only: the only thing that writes to docs/shots/.
    {
      name: 'shots',
      testMatch: /shots\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 },
    },
  ],
  webServer: {
    // Plain vite, not `pnpm start`, so no browser tab opens on the machine.
    command: `vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/decks/index.json`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
