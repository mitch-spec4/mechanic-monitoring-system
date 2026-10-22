import { expect, test } from "@playwright/test";
import { failOnPageErrors, openPage, signIn } from "./helpers";

test.describe.configure({ mode: "serial" });

test("boss creates and assigns a job with a real due date", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "james@mechanicpro.test");
  await page.getByRole("button", { name: "Create Job" }).click();
  const form = page.locator("form.form");
  await form.locator("input[name=title]").fill("E2E boiler check");
  await form.locator("textarea[name=description]").fill("Annual check");
  await form.locator("select[name=customer_id]").selectOption({ label: "Kenya Motors" });
  await expect(form.locator("select[name=machine_id] option")).toHaveText([
    "Machine (optional)",
    "Compressor C-55 (C55-77890)",
    "Hydraulic Pump H-21 (H21-44012)",
  ]);
  await form.locator("select[name=machine_id]").selectOption({ label: "Compressor C-55 (C55-77890)" });
  await form.locator("select[name=mechanic_id]").selectOption({ label: "Amina Otieno" });
  await form.locator("select[name=priority]").selectOption("Low");
  await form.locator("input[name=due_date]").fill("2026-11-05");
  await form.getByRole("button", { name: "Create & notify mechanic" }).click();

  const created = page.locator(".job", { hasText: "E2E boiler check" });
  await expect(created).toContainText("Due 05 Nov 2026");
  await expect(created).toContainText("Assigned");
  noErrors();
});

test("deleting a started job is refused with an inline message", async ({ page }) => {
  await signIn(page, "james@mechanicpro.test");
  page.once("dialog", (dialog) => dialog.accept());
  const started = page.locator(".job", { hasText: "Service Generator G-102" });
  await started.getByTitle("Delete job").click();
  await expect(page.getByRole("alert")).toContainText("Cancel this job instead");
  await expect(started).toBeVisible();
});

test("customer profile opens as an overlay", async ({ page }) => {
  await signIn(page, "james@mechanicpro.test");
  await page.locator(".customer-card", { hasText: "ABC Engineering" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Customer Profile");
  await expect(dialog).toContainText("Generator G-102");
  await page.mouse.click(5, 500);
  await expect(dialog).toBeHidden();
});

test("boss adds a machine and duplicate serials are rejected", async ({ page }) => {
  await signIn(page, "james@mechanicpro.test");
  await openPage(page, "Machines");
  await page.getByRole("button", { name: /Add Machine/ }).click();
  const form = page.locator("form.form-upgraded");
  await form.locator("select[name=customer_id]").selectOption({ label: "XYZ Factory" });
  await form.locator("input[name=name]").fill("Boiler B-7");
  await form.locator("input[name=serial_no]").fill("C55-77890");
  await form.getByRole("button", { name: "Add machine" }).click();
  await expect(form.locator(".error")).toContainText("serial number already exists");
  await form.locator("input[name=serial_no]").fill("B7-0001");
  await form.getByRole("button", { name: "Add machine" }).click();
  await expect(page.locator(".subPageList")).toContainText("Boiler B-7");
});

test("invited customer joins with the code and signs in", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, "james@mechanicpro.test");
  await page.getByRole("button", { name: "Add customer" }).click();
  const form = page.locator("form.form-upgraded");
  await form.locator("input[name=name]").fill("Delta Industries");
  await form.locator("input[name=email]").fill("delta@example.com");
  await form.getByRole("button", { name: "Generate Invitation Code" }).click();

  const code = (await page.getByTestId("invite-code").textContent()) ?? "";
  expect(code).toMatch(/^DK-[0-9A-F]{10}$/);
  const email = page.getByRole("link", { name: "Email this code" });
  await expect(email).toHaveAttribute("href", /^mailto:delta%40example\.com\?subject=/);
  expect(decodeURIComponent((await email.getAttribute("href")) ?? "")).toContain(code);
  await page.getByRole("button", { name: "Copy code" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
  await page.getByRole("button", { name: "Done" }).click();

  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await page.getByRole("button", { name: "Have an invitation code?" }).click();
  await page.getByLabel("Invitation code").fill(code);
  await page.getByLabel("Full name").fill("Delta Industries");
  await page.getByLabel("Email").fill("delta@example.com");
  await page.getByLabel("Password").fill("delta-password");
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.locator(".success")).toContainText("Invitation accepted");

  await page.getByLabel("Email").fill("delta@example.com");
  await page.getByLabel("Password").fill("delta-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Welcome, Delta/ })).toBeVisible();
});

test("boss workspace pages load real data", async ({ page }) => {
  await signIn(page, "james@mechanicpro.test");
  for (const [label, expected] of [
    ["Mechanics", "Amina Otieno"],
    ["Notifications", "New service request"],
    ["Reports", "Jobs by status"],
  ]) {
    await openPage(page, label);
    await expect(page.locator(".subPage")).toContainText(expected);
  }
  await expect(page.locator(".sidebarStats")).toContainText("Customers");
  await expect(page.locator(".sidebarStats")).not.toContainText("147");
});
