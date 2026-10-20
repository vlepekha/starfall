import { defineConfig, devices } from "@playwright/test";

/**
 * E2E: два справжні браузери в одній кімнаті.
 *
 * `webServer` піднімає і сервер гри, і клієнт — Playwright чекає,
 * доки обидва відгукнуться, і сам їх гасить наприкінці. Без цього
 * тест довелося б запускати «спершу руками підніміть два процеси».
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",

  use: {
    baseURL: "http://127.0.0.1:5174",
    trace: "retain-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: [
    {
      command: "npm run start -w @starfall/server",
      url: "http://127.0.0.1:8099/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { PORT: "8099", LOG_DIR: "./logs" },
    },
    {
      // --host 127.0.0.1 обов'язковий: без нього Vite слухає лише
      // IPv6-localhost, і очікування на 127.0.0.1 ніколи не завершується.
      command: "npm run dev -w @starfall/client -- --port 5174 --strictPort --host 127.0.0.1",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { SERVER_URL: "http://127.0.0.1:8099" },
    },
  ],
});
