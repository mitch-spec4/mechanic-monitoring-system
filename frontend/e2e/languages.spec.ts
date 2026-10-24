import { expect, test, type Page } from "@playwright/test";
import { failOnPageErrors, finishSignIn, forget, goTo, openPage, signIn } from "./helpers";

// English is the default everywhere; Kiswahili when the browser asks for it, when someone picks it,
// or for new people in a company that works in it. Each test puts back what it changes.
test.describe.configure({ mode: "serial" });

const me = async (page: Page) => (await (await page.request.get("/api/users/me")).json()).user;

test("the language button in the top bar switches the app and saves it to the account", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "james@mechanicpro.test");
  const button = page.getByRole("button", { name: "Language: English" });
  await expect(button).toHaveText("EN");
  // The buttons float over the page's header without covering its notification bell.
  const bell = (await page.locator("header .notif").boundingBox())!;
  const topBar = (await page.locator(".topBar").boundingBox())!;
  expect(bell.x + bell.width).toBeLessThanOrEqual(topBar.x);
  await button.click();
  await page.getByRole("menuitemradio", { name: "Kiswahili" }).click();
  await expect(page.locator('.sidebarLink[data-page="Dashboard"]')).toHaveText("Dashibodi");
  await expect(page.locator("html")).toHaveAttribute("lang", "sw");
  expect((await me(page)).language).toBe("sw");

  // On every screen, not just the dashboard.
  await goTo(page, "Customers");
  const switchBack = page.getByRole("button", { name: "Lugha: Kiswahili" });
  await expect(switchBack).toHaveText("SW");
  await switchBack.click();
  await expect(page.getByRole("menuitemradio", { name: "Kiswahili" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitemradio", { name: "English" }).click();
  await expect(page.locator(".subPage h1")).toHaveText("Customers");
  expect((await me(page)).language).toBe("en");
  noErrors();
});

test.describe("a browser set to Kiswahili", () => {
  test.use({ locale: "sw-KE" });

  test("opens in Kiswahili on a first visit", async ({ page }) => {
    await page.goto("/#/signin");
    await expect(page.locator("h1")).toHaveText("Karibu tena");
    await expect(page.locator("html")).toHaveAttribute("lang", "sw");
    // Nothing was chosen yet, so the browser's language isn't stored as a choice.
    expect(await page.evaluate(() => localStorage.getItem("language"))).toBeNull();
  });
});

test.describe("a browser in another language", () => {
  test.use({ locale: "fr-FR" });

  test("opens in English", async ({ page }) => {
    await page.goto("/#/signin");
    await expect(page.locator("h1")).toHaveText("Welcome back");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});

test.describe("a first visit from East Africa", () => {
  test.use({ timezoneId: "Africa/Nairobi" });

  test("is offered Kiswahili, in English by default", async ({ page }) => {
    await page.goto("/");
    const offer = page.getByRole("dialog", { name: "Ungependa kutumia MechanicPro kwa Kiswahili?" });
    await expect(offer).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await offer.getByRole("button", { name: "Tumia Kiswahili" }).click();
    await expect(offer).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("lang", "sw");
    // Asked once: a reload keeps the choice and doesn't ask again.
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "sw");
    await expect(page.locator(".languageSuggestion")).toHaveCount(0);
  });

  test("can keep English, and isn't asked again", async ({ page }) => {
    await page.goto("/#/signin");
    const offer = page.locator(".languageSuggestion");
    await offer.getByRole("button", { name: "Keep English" }).click();
    await expect(offer).toHaveCount(0);
    await page.reload();
    await expect(page.locator("h1")).toHaveText("Welcome back");
    await expect(offer).toHaveCount(0);
  });
});

test("elsewhere, nobody is asked", async ({ page }) => {
  // The browser tests run on UTC (playwright.config.ts).
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Try the demo" })).toBeVisible();
  await expect(page.locator(".languageSuggestion")).toHaveCount(0);
});

async function setCompanyLanguage(page: Page, code: string) {
  await openPage(page, "Settings");
  const company = page.locator(".settingsSection", { hasText: "Company settings" });
  await company.getByLabel("Company language").selectOption(code);
  await company.getByRole("button", { name: "Save company settings" }).click();
  await expect(page.locator(".toast").last()).toContainText("Company settings saved");
}

async function inviteCustomer(page: Page, name: string, email: string) {
  await goTo(page, "Customers");
  await page.getByRole("button", { name: "Add customer" }).click();
  const form = page.locator("form.form-upgraded");
  await form.locator("input[name=name]").fill(name);
  await form.locator("input[name=email]").fill(email);
  await form.getByRole("button", { name: "Send invitation" }).click();
  const code = (await page.getByTestId("share-code").textContent()) ?? "";
  await page.getByRole("button", { name: "Done" }).click();
  return code;
}

test("new people join in the company's language", async ({ page }) => {
  await signIn(page, "james@mechanicpro.test");
  try {
    await setCompanyLanguage(page, "sw");
    // Only new people: the manager's own language stays as it was.
    await expect(page.locator(".subPage h1")).toHaveText("Settings");
    const code = await inviteCustomer(page, "Kilimo Mills", "kilimo@example.com");
    const { emails } = await (await page.request.get("/api/test/outbox")).json();
    const invitation = emails.find((email: { to: string }) => email.to === "kilimo@example.com");
    expect(invitation.subject).toBe("James Mwangi amekualika kwenye DK Engineering katika MechanicPro");

    // The new customer didn't choose a language, so they start in the company's.
    await forget(page);
    await page.getByRole("button", { name: "Have an invitation code?" }).click();
    await page.getByLabel("Invitation code").fill(code);
    await page.getByLabel("Full name").fill("Kilimo Mills");
    await page.getByLabel("Email").fill("kilimo@example.com");
    await page.getByLabel("Password").fill("kilimo-password");
    await page.getByLabel(/I agree to the privacy policy/).check();
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page.locator(".success")).toContainText("Invitation accepted");
    await page.getByLabel("Email").fill("kilimo@example.com");
    await page.getByLabel("Password").fill("kilimo-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    // Straight to setting up two-step sign-in, already in Kiswahili.
    await finishSignIn(page, "kilimo@example.com", "main.twoFactorPage");
    await expect(page.locator("html")).toHaveAttribute("lang", "sw");
  } finally {
    // The other spec files expect an English company.
    await forget(page);
    await signIn(page, "james@mechanicpro.test");
    await setCompanyLanguage(page, "en");
  }
});

test("someone who picked a language when joining keeps it", async ({ page }) => {
  // The company works in English, but this person chose Kiswahili on the join page.
  await signIn(page, "james@mechanicpro.test");
  const code = await inviteCustomer(page, "Pwani Foods", "pwani@example.com");

  await forget(page);
  await page.getByLabel("Language").selectOption("sw");
  await page.getByRole("button", { name: "Una nambari ya mwaliko?" }).click();
  await page.getByLabel("Nambari ya mwaliko").fill(code);
  await page.getByLabel("Jina kamili").fill("Pwani Foods");
  await page.getByLabel("Barua pepe").fill("pwani@example.com");
  await page.getByLabel("Nenosiri").fill("pwani-password");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Kubali mwaliko" }).click();
  await expect(page.locator(".success")).toBeVisible();
  // A new browser, signed in fresh: the account remembers Kiswahili.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator("h1")).toHaveText("Welcome back");
  await page.getByLabel("Email").fill("pwani@example.com");
  await page.getByLabel("Password").fill("pwani-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await finishSignIn(page, "pwani@example.com", "main.twoFactorPage");
  await expect(page.locator("html")).toHaveAttribute("lang", "sw");
});

test("layouts mirror for right-to-left languages", async ({ page }) => {
  // No right-to-left language is offered yet; this checks the screens are ready for one.
  await signIn(page, "james@mechanicpro.test");
  // The page's width without any scrollbar.
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  const box = async (selector: string) => (await page.locator(selector).first().boundingBox())!;
  const sidebar = await box(".sidebar");
  const topBar = await box(".topBar");
  expect(sidebar.x).toBeLessThan(5);
  expect(topBar.x + topBar.width).toBeGreaterThan(width / 2);

  await page.evaluate(() => (document.documentElement.dir = "rtl"));
  const mirrored = await box(".sidebar");
  expect(Math.abs(mirrored.x + mirrored.width - width)).toBeLessThan(5);
  const mirroredTop = await box(".topBar");
  expect(mirroredTop.x).toBeLessThan(width / 2);
  // The content moves out from under the sidebar, on the other side.
  const main = await box(".appMain");
  expect(main.x + main.width).toBeLessThanOrEqual(mirrored.x + 5);
  // Arrows in buttons point the other way.
  await forget(page);
  await page.evaluate(() => (document.documentElement.dir = "rtl"));
  const arrow = page.locator(".loginHome .flipInRtl");
  expect(await arrow.evaluate((element) => getComputedStyle(element).scale)).toBe("-1 1");
  await page.evaluate(() => (document.documentElement.dir = "ltr"));
  expect(await arrow.evaluate((element) => getComputedStyle(element).scale)).toBe("none");
});
