// Playwright settings for the PetSociety E2E tests.
import { defineConfig, devices } from '@playwright/test'
import { CLIENT_PORT, SERVER_PORT, SERVER_ENV } from './e2eEnv.js'

export default defineConfig({
  testDir: './tests',

  // Before anything else: reset the tests' own database (petsociety_e2e) to the test data (see global-setup.js)
  globalSetup: './global-setup.js',

  // All tests share ONE database, so run them one at a time.
  // (Two tests at once could both try to accept the same request.)
  fullyParallel: false,
  workers: 1,

  // Don't re-run failed tests: a flaky test should show up as a failure, not be hidden
  retries: 0,

  // Each test gets 30 seconds before it counts as failed
  timeout: 30_000,

  // 'list' prints ✓/✗ in the terminal, 'html' makes the report you open with: pnpm report
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    // page.goto('/login') becomes http://localhost:5174/login (the tests' own copy of the app, see e2eEnv.js)
    baseURL: `http://localhost:${CLIENT_PORT}`,
    // When a test fails, keep a screenshot and a step-by-step recording (trace) to look at
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },

  // Starts the tests' own copy of the app on ports 5050 / 5174, using the petsociety_e2e database.
  // It never reuses your normal pnpm dev (5000 / 5173), so tests can't change your own data. Both can run at once.
  webServer: [
    {
      command: 'pnpm start', cwd: '../server', url: `http://localhost:${SERVER_PORT}/api/health`,
      env: { ...process.env, ...SERVER_ENV }, reuseExistingServer: false, timeout: 60_000
    },
    {
      command: `pnpm dev --port ${CLIENT_PORT} --strictPort`, cwd: '../client', url: `http://localhost:${CLIENT_PORT}`,
      env: { ...process.env, API_PROXY_TARGET: `http://localhost:${SERVER_PORT}` }, reuseExistingServer: false, timeout: 60_000
    }
  ],

  projects: [
    // 1) Log in as each test user once and save the logins (tests/auth.setup.js)
    { name: 'setup', testMatch: /auth\.setup\.js/ },

    // 2) Every test on a laptop-sized Chrome, except the phone-only test
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      testIgnore: /responsive\.spec\.js/
    },

    // 3) The phone-only test, on an iPhone 6 sized screen (graders check from iPhone 6 up)
    {
      name: 'iphone-6',
      use: { ...devices['iPhone 6'], browserName: 'chromium' },
      dependencies: ['setup'],
      testMatch: /responsive\.spec\.js/
    }
  ]
})