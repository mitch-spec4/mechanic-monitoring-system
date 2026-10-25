import { expect, test, type Request } from "@playwright/test";
import { failOnPageErrors, finishSignIn, goTo, openPage, signIn } from "./helpers";

// Each test puts back what it changes: the database is shared with the other spec files.
test.describe.configure({ mode: "serial" });

test("a visitor picks Kiswahili on the sign-in page", async ({ page }) => {
  await page.goto("/#/signin");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.getByLabel("Language").selectOption("sw");
  await expect(page.locator("h1")).toHaveText("Karibu tena");
  await expect(page.locator("html")).toHaveAttribute("lang", "sw");
  // Kept on this device.
  await page.reload();
  await expect(page.locator("h1")).toHaveText("Karibu tena");
  // The server answers in the same language.
  await page.getByLabel("Barua pepe").fill("james@mechanicpro.test");
  await page.getByLabel("Nenosiri").fill("wrong-password");
  await page.getByRole("button", { name: "Ingia" }).click();
  await expect(page.getByRole("alert")).toHaveText("Barua pepe au nenosiri si sahihi");
  await page.getByLabel("Lugha").selectOption("en");
  await expect(page.locator("h1")).toHaveText("Welcome back");
});

test("a technician switches the whole app to Kiswahili in Settings", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "brian@mechanicpro.test");
  await openPage(page, "Settings");
  await page.locator(".settingsSection", { hasText: "The app, your emails" }).getByLabel("Language").selectOption("sw");
  await expect(page.locator(".subPage h1")).toHaveText("Mipangilio");
  // The navigation too: the sidebar on a computer, the bottom bar on a technician's phone.
  await expect(page.locator('[data-page="My Jobs"]:visible')).toHaveText(/^(Kazi zangu|Kazi)$/);
  await expect(page.locator(".subPage .eyebrow")).toContainText("FUNDI");

  // The choice belongs to the account, so it follows the technician to a fresh browser.
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await page.goto("/#/signin");
  await page.reload();
  await expect(page.locator("h1")).toHaveText("Welcome back");
  await page.getByLabel("Email").fill("brian@mechanicpro.test");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  // A new browser: the sign-in code step comes up in Kiswahili too.
  await finishSignIn(page, "brian@mechanicpro.test");
  await expect(page.locator('[data-page="Dashboard"]:visible')).toHaveText(/^(Dashibodi|Leo)$/);
  await expect(page.locator(".clockCard")).toContainText("Umetoka kazini");

  await goTo(page, "Settings");
  await page.locator(".settingsSection", { hasText: "Programu, barua pepe" }).getByLabel("Lugha").selectOption("en");
  await expect(page.locator(".subPage h1")).toHaveText("Settings");
  noErrors();
});

test("dark mode is chosen in Settings and kept on the device", async ({ page }) => {
  await signIn(page, "james@mechanicpro.test");
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const light = await background();
  await openPage(page, "Settings");
  await page.getByRole("radio", { name: "Dark" }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(background).not.toBe(light);
  // A dark background: every channel well below the middle.
  const channels = (await background()).match(/\d+/g)!.slice(0, 3).map(Number);
  expect(Math.max(...channels)).toBeLessThan(80);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await openPage(page, "Settings");
  await page.getByRole("radio", { name: "Light" }).check();
  await expect.poll(background).toBe(light);
});

test("a manager changes the company's units", async ({ page }) => {
  await signIn(page, "james@mechanicpro.test");
  await openPage(page, "Settings");
  const company = page.locator(".settingsSection", { hasText: "Company settings" });
  await expect(company.getByLabel("Time zone")).toHaveValue("Africa/Nairobi");
  await company.getByLabel("Units").selectOption("imperial");
  await company.getByRole("button", { name: "Save company settings" }).click();
  await expect(page.locator(".toast")).toContainText("Company settings saved");
  await page.reload();
  await openPage(page, "Settings");
  await expect(company.getByLabel("Units")).toHaveValue("imperial");
  await company.getByLabel("Units").selectOption("metric");
  await company.getByRole("button", { name: "Save company settings" }).click();
  await expect(page.locator(".toast").last()).toContainText("Company settings saved");
});

test("an answer that comes late doesn't undo a change in Settings", async ({ page }) => {
  // In development React loads each form twice; here the first load answers last, after the
  // manager has already changed something.
  await signIn(page, "james@mechanicpro.test");
  let loads = 0;
  let delayed: Request | undefined;
  await page.route("**/api/company/settings", async (route) => {
    if (route.request().method() === "GET" && ++loads === 1) {
      delayed = route.request();
      await new Promise((done) => setTimeout(done, 1500));
    }
    await route.continue();
  });
  const late = page.waitForEvent("requestfinished", { predicate: (request) => request === delayed, timeout: 20_000 });
  await openPage(page, "Settings");
  const units = page.locator(".settingsSection", { hasText: "Company settings" }).getByLabel("Units");
  await units.selectOption("imperial");
  await late;
  await page.waitForTimeout(300); // time for the late answer to reach the form
  expect(await units.inputValue()).toBe("imperial");
  await page.unroute("**/api/company/settings");
});

test("technicians and customers don't see company settings", async ({ page }) => {
  await signIn(page, "brian@mechanicpro.test");
  await openPage(page, "Settings");
  await expect(page.locator(".settingsSection", { hasText: "Appearance" })).toBeVisible();
  await expect(page.locator(".settingsSection", { hasText: "Company settings" })).toHaveCount(0);
});
