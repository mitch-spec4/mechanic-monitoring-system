import { defineConfig } from "@playwright/test";

// Starts a fresh seeded API and the Vite dev server, then drives the real UI.
// Tests share one database and run in order, so keep workers at 1.
const python = process.env.E2E_PYTHON || (process.platform === "win32" ? "py" : "python3");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:5173",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: [
    {
      command: `${python} scripts/e2e_server.py`,
      cwd: "../backend",
      url: "http://127.0.0.1:5000/api/health",
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "ignore",
    },
    {
      command: "npm run dev -- --port 5173 --strictPort",
      url: "http://localhost:5173",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
