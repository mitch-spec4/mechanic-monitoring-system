import { defineConfig, devices } from "@playwright/test";

// Starts a fresh seeded API and the Vite dev server, then drives the real UI.
// Tests share one database and run in order, so keep workers at 1.
const chromiumLaunch = process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {};
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
    // The same clock and language everywhere: tests that need another set their own.
    // (Africa/Nairobi would offer Kiswahili on first visits, see languages.spec.ts.)
    timezoneId: "UTC",
    locale: "en-US",
    screenshot: "only-on-failure",
    // A fixed phone position (Nairobi) with location allowed; location.spec.ts also tests it blocked.
    geolocation: { latitude: -1.2995, longitude: 36.79, accuracy: 20 },
    permissions: ["geolocation"],
    trace: "retain-on-failure",
  },
  // Each project needs a fresh database, so run one per invocation: --project=<name>.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 }, launchOptions: chromiumLaunch } },
    { name: "firefox", use: { ...devices["Desktop Firefox"], viewport: { width: 1440, height: 1000 } } },
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], launchOptions: chromiumLaunch } },
  ],
  webServer: [
    {
      command: `"${python}" scripts/e2e_server.py`,
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
