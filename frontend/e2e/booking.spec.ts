import { expect, test, type Page } from "@playwright/test";
import { confirmDialog, failOnPageErrors, forget, goTo, signIn } from "./helpers";

// A customer requests service and books an inspection; the manager answers in the chat; the
// technician sets off; the customer follows it all on the request's page, then cancels.
test.describe.configure({ mode: "serial" });

const SUBJECT = "Generator won't start in the morning";
const TECHNICIANS: Record<string, string> = {
  "Mitch Kamau": "mitch@mechanicpro.test",
  "Amina Otieno": "amina@mechanicpro.test",
  "Brian Kariuki": "brian@mechanicpro.test",
};
// Shared between the tests: who got the visit.
let technician = "";

async function openRequest(page: Page) {
  await goTo(page, "Service Requests");
  await page.locator(".subPageList article", { hasText: SUBJECT }).getByRole("button", { name: SUBJECT }).click();
  await expect(page.locator(".requestPage h1")).toHaveText(SUBJECT);
}

test("a customer requests service and books, then moves, an inspection", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "abc@example.com");
  await page.getByRole("button", { name: "Request service" }).click();
  const form = page.locator("form.form");
  await form.locator("select[name=machine_id]").selectOption({ label: "Generator G-102" });
  await form.locator("input[name=subject]").fill(SUBJECT);
  await form.locator("textarea[name=description]").fill("It cranks but won't fire until it has warmed in the sun.");
  await form.getByRole("button", { name: "Send request" }).click();

  // The request's page opens at the first step, with the free times for the inspection.
  const requestPage = page.locator(".requestPage");
  await expect(requestPage.locator("h1")).toHaveText(SUBJECT);
  await expect(requestPage.locator(".jobHero .jobStatusPill")).toHaveText("Submitted");
  await expect(requestPage.locator('.requestSteps li[aria-current="step"]')).toContainText("Submitted");
  const picker = page.locator(".slotPicker");
  await expect(picker.locator("h2")).toHaveText("Pick a time for the inspection");
  await expect(picker.locator(".jobBadge")).toHaveText("About 2 h");
  const book = picker.locator(".slotBook");
  await expect(book).toBeDisabled();
  await picker.locator(".slotTimes button").first().click();
  await expect(book).toHaveText(/^Book \w{3} \d\d \w{3}, \d\d:\d\d–\d\d:\d\d$/);
  await book.click();

  await expect(requestPage.locator(".jobHero .jobStatusPill")).toHaveText("Inspection booked");
  const visit = requestPage.locator(".visitCard");
  await expect(visit).toHaveCount(1);
  await expect(visit.locator(".visitHead strong")).toHaveText("Inspection");
  technician = ((await visit.locator(".visitLine").first().textContent()) ?? "").replace("Technician: ", "");
  expect(Object.keys(TECHNICIANS)).toContain(technician);

  // Moved to another day: the same visit, at the new time.
  await expect(picker.locator("h2")).toHaveText("Move the visit");
  const firstTime = await visit.locator(".visitHead span").first().textContent();
  await picker.locator(".slotDays button").nth(1).click();
  await picker.locator(".slotTimes button").last().click();
  await picker.locator(".slotBook").click();
  await expect(page.locator(".toast", { hasText: "Visit moved" })).toBeVisible();
  await expect(visit).toHaveCount(1);
  await expect(visit.locator(".visitHead span").first()).not.toHaveText(firstTime ?? "");
  noErrors();
});

test("the customer asks for a quote in the chat, and the manager answers", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, "abc@example.com");
  await openRequest(page);
  await page.locator(".requestPage").getByRole("button", { name: "Send a message" }).click();
  const thread = page.locator(".thread");
  await expect(thread.locator("h2")).toHaveText("Chat with DK Engineering");
  await thread.locator("textarea").fill("How much would a new starter motor be?");
  await thread.getByRole("button", { name: "Send" }).click();
  await expect(thread.locator(".bubble.mine")).toContainText("How much would a new starter motor be?");
  await forget(page);

  await signIn(page, "james@mechanicpro.test");
  // The dashboard's requests open their page; the chat is a click away.
  await page.locator(".request", { hasText: "It cranks but won't fire" }).getByRole("button", { name: SUBJECT }).click();
  await expect(page.locator(".requestPage .visitCard")).toContainText(`Technician: ${technician}`);
  await page.getByRole("button", { name: "Message ABC Engineering" }).click();
  await expect(page.locator(".subPage h1")).toHaveText("Messages");
  await expect(thread.locator("h2")).toHaveText("ABC Engineering");
  await expect(thread.locator(".bubble").last()).toContainText("How much would a new starter motor be?");
  await thread.locator("textarea").fill("About KSh 18,000 fitted. We'll check it at the inspection.");
  await thread.locator("textarea").press("Enter");
  await expect(thread.locator(".bubble.mine").last()).toContainText("About KSh 18,000 fitted.");
  // Read now: nothing unread for ABC.
  await expect(page.locator(".inboxList button", { hasText: "ABC Engineering" }).locator(".inboxMeta b")).toHaveCount(0);
  noErrors();
});

test("the technician taps On my way, and the customer sees it, then cancels", async ({ page }) => {
  const noErrors = failOnPageErrors(page);
  await signIn(page, TECHNICIANS[technician]);
  await goTo(page, "My Jobs");
  await page.locator(".subPageList article", { hasText: SUBJECT }).getByRole("button", { name: SUBJECT }).click();
  const job = page.locator(".jobPage");
  await expect(job.locator(".jobMeta")).toContainText("Booked visit");
  // The race a slow phone (or a Windows runner) hits: a read of the job answered just before the
  // change is saved lands right after it was sent, and the reads after it land later still. The
  // phone's copy must still end up with the change.
  let sentAt = 0;
  await page.route("**/api/jobs/*/on-the-way", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const response = await route.fetch();
    sentAt = Date.now();
    await route.fulfill({ response });
  });
  let reads = 0;
  let landed = 0;
  await page.route(/\/api\/jobs\/\d+$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const first = reads++ === 0;
    const response = await route.fetch();
    if (first) while (!sentAt) await new Promise((resolve) => setTimeout(resolve, 20));
    await new Promise((resolve) => setTimeout(resolve, first ? 150 : 600));
    await route.fulfill({ response });
    landed++;
  });
  await job.getByRole("button", { name: "On my way" }).click();
  await expect.poll(() => landed).toBeGreaterThanOrEqual(3);
  await page.unrouteAll({ behavior: "wait" });
  await expect(job.locator(".jobOnTheWay")).toContainText("On the way since");
  await expect(job.locator(".timeline")).toContainText("set off for the visit");
  await forget(page);

  await signIn(page, "abc@example.com");
  await openRequest(page);
  const requestPage = page.locator(".requestPage");
  await expect(requestPage.locator(".visitOnTheWay")).toContainText("On the way since");
  await requestPage.getByRole("button", { name: "Cancel request" }).click();
  await confirmDialog(page, "Cancel request");
  await expect(requestPage.locator(".jobHero .jobStatusPill")).toHaveText("Cancelled");
  await expect(requestPage.locator(".visitCard .jobStatusPill")).toHaveText("Cancelled");
  await expect(requestPage.locator(".slotPicker")).toHaveCount(0);
  noErrors();
});
