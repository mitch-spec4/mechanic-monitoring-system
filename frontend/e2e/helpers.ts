import { createHmac } from "node:crypto";
import { expect, test, type Cookie, type Page } from "@playwright/test";

export const DEMO_PASSWORD = "password";
// Every seeded account uses this authenticator key (backend/seed.py, local only).
export const DEMO_TOTP_SECRET = "MECHANICPRODEMO2";

// Two-step sign-in for the tests: the authenticator key of each account, the last 30-second step
// whose code was used (the server takes each code once), and the "remember this device" cookie
// from the first sign-in, so later sign-ins skip the code. Kept for the run, in this worker.
const secrets = new Map<string, string>();
const usedSteps = new Map<string, number>();
const devices = new Map<string, Cookie>();

function base32(text: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of text.replace(/[\s=]/g, "").toUpperCase()) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes = bits.match(/.{8}/g) || [];
  return Buffer.from(bytes.map((byte) => parseInt(byte, 2)));
}

/** The authenticator app's 6-digit code (RFC 6238: SHA-1, 30 seconds). */
export function totp(secret: string, step = Math.floor(Date.now() / 30000)) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hash = createHmac("sha1", base32(secret)).update(counter).digest();
  const offset = hash[hash.length - 1] & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** A 30-second step whose code this account hasn't used yet, waiting for the next one if needed. */
async function freshStep(email: string) {
  const used = usedSteps.get(email) ?? -1;
  let step = Math.floor(Date.now() / 30000);
  if (step <= used) {
    const wait = (used + 1) * 30000 - Date.now() + 250;
    test.info().setTimeout(test.info().timeout + wait);
    await new Promise((resolve) => setTimeout(resolve, wait));
    step = used + 1;
  }
  usedSteps.set(email, step);
  return step;
}

/** The sign-in code step: type the code, keep this browser remembered, and save its cookie. */
async function enterSignInCode(page: Page, email: string, landed: string) {
  const form = page.locator("main.login form");
  const secret = secrets.get(email) ?? DEMO_TOTP_SECRET;
  for (let attempt = 0; ; attempt++) {
    await form.locator(".codeInput").fill(totp(secret, await freshStep(email)));
    await form.locator(".checkRow input").check();
    const answer = page.waitForResponse((response) => response.url().includes("/auth/two-factor/verify"));
    await form.locator("button.primary").click();
    const response = await answer;
    if (response.ok()) break;
    // A code this account already used (in a run that lost track of it): wait for the next one.
    if (attempt) throw new Error(`sign-in code refused for ${email}: ${JSON.stringify(await response.json())}`);
  }
  await expect(page.locator(landed)).toBeVisible();
  const cookie = (await page.context().cookies()).find((item) => item.name === "mp_device");
  if (cookie) devices.set(email, cookie);
}

/** After "Sign in" is pressed: type a code if one is asked for, then wait for the page that comes
 *  next (the app, unless `landed` says otherwise). Works in any language. */
export async function finishSignIn(page: Page, email: string, landed = ".appShell") {
  const codeStep = page.locator("main.login:not(.twoFactorPage) .codeInput");
  await expect(page.locator(landed).or(codeStep)).toBeVisible();
  if (await codeStep.isVisible()) await enterSignInCode(page, email, landed);
  await expect(page.locator(landed)).toBeVisible();
}

/** Sign out of this browser completely: the next visit is a stranger's (a remembered device too). */
export async function forget(page: Page) {
  await page.evaluate(() => localStorage.clear());
  await page.context().clearCookies();
  await page.goto("/#/signin");
  await page.reload();
}

export async function signIn(page: Page, email: string, password = DEMO_PASSWORD) {
  const device = devices.get(email);
  if (device) await page.context().addCookies([device]);
  await page.goto("/#/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await finishSignIn(page, email);
}

/** The required setup after joining or signing up: scan (read the key), confirm a code, keep the
 *  backup codes. Returns the backup codes. */
export async function setUpTwoFactor(page: Page, email: string) {
  await expect(page.getByRole("heading", { name: "Set up two-step sign-in" })).toBeVisible();
  const key = page.getByTestId("setup-key");
  await expect(key).toBeVisible();
  const secret = ((await key.textContent()) || "").replace(/\s/g, "");
  secrets.set(email, secret);
  usedSteps.delete(email);
  devices.delete(email);
  await page.locator(".twoFactorSteps .codeInput").fill(totp(secret, await freshStep(email)));
  await page.getByRole("button", { name: "Turn on two-step sign-in" }).click();
  await expect(page.getByTestId("backup-codes")).toBeVisible();
  const codes = await page.getByTestId("backup-codes").locator("code").allTextContents();
  expect(codes).toHaveLength(10);
  await page.getByRole("button", { name: "I've saved my backup codes" }).click();
  return codes;
}

/** Settings → Set up on a new phone, in its dialog: the new key replaces the old one, and the
 *  password is asked for too. A wrong password is refused first when `wrongPassword` is given. */
export async function setUpOnNewPhone(page: Page, email: string, password: string, wrongPassword?: string) {
  const dialog = page.getByRole("dialog", { name: "Set up two-step sign-in" });
  const key = dialog.getByTestId("setup-key");
  await expect(key).toBeVisible();
  const secret = ((await key.textContent()) || "").replace(/\s/g, "");
  if (wrongPassword) {
    await dialog.locator(".codeInput").fill(totp(secret, await freshStep(email)));
    await dialog.getByLabel("Your password").fill(wrongPassword);
    await dialog.getByRole("button", { name: "Turn on two-step sign-in" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Your current password is incorrect");
  }
  await dialog.locator(".codeInput").fill(totp(secret, await freshStep(email)));
  await dialog.getByLabel("Your password").fill(password);
  await dialog.getByRole("button", { name: "Turn on two-step sign-in" }).click();
  await expect(dialog.getByTestId("backup-codes")).toBeVisible();
  secrets.set(email, secret);
  devices.delete(email);
  await dialog.getByRole("button", { name: "I've saved my backup codes" }).click();
  await expect(dialog).toHaveCount(0);
}

/** Go to a page by its English name, in any language: from the sidebar on computers, or on a
 *  technician's phone from the bottom bar (or its More sheet). */
export async function goTo(page: Page, name: string) {
  const shown = page.locator(`.sidebarLink[data-page="${name}"]:visible, .bottomNav [data-page="${name}"]:visible`);
  if (await shown.count()) {
    await shown.first().click();
  } else {
    await page.locator('.bottomNav [data-page="more"]').click();
    await page.locator(`.moreLinks [data-page="${name}"]`).click();
  }
}

export async function openPage(page: Page, label: string) {
  await goTo(page, label);
  await expect(page.locator(".subPage h1")).toHaveText(label);
}

/** Answers the app's own confirm dialog (it replaced the browser's confirm()). */
export async function confirmDialog(page: Page, button: string | RegExp) {
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: button }).click();
  await expect(dialog).toHaveCount(0);
}

/** Fail the test on uncaught page errors. */
export function failOnPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return () => expect(errors, "uncaught page errors").toEqual([]);
}

/** The customer signs on the open sign-off pad, then the job is completed. */
export async function signAndComplete(page: Page, name = "Grace Wanjiru") {
  const dialog = page.getByRole("dialog", { name: "Customer sign-off" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name of the person signing").fill(name);
  const pad = dialog.locator("canvas");
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + box.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 12; step++) {
    await page.mouse.move(box.x + 30 + step * 18, box.y + box.height / 2 + (step % 2 ? -25 : 25));
  }
  await page.mouse.up();
  await dialog.getByRole("button", { name: "Complete job" }).click();
  await expect(dialog.getByRole("status")).toContainText(`Signed by ${name}`);
  await expect(dialog).toHaveCount(0);
}
