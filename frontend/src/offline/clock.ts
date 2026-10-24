/**
 * The server's clock, as measured from its replies. A change made offline is dated with it, so a
 * phone whose own clock is wrong still records the right time (as long as its clock isn't changed
 * while it is offline). Kept between visits, for a phone that opens the app with no signal.
 */
const KEY = "mechanicpro:clock-offset";

let offset = (() => {
  try {
    return Number(localStorage.getItem(KEY)) || 0;
  } catch {
    return 0;
  }
})();

/** Learn from a reply's Date header: the server's time, to the second, when it answered. */
export function noteServerClock(date: string | null, sentAt: number, receivedAt: number) {
  const server = date ? Date.parse(date) : NaN;
  if (Number.isNaN(server)) return;
  // The header is rounded down to the second, so on average the server's time was half a second later.
  const measured = server + 500 - (sentAt + receivedAt) / 2;
  offset = Math.abs(measured - offset) > 2000 ? measured : Math.round(offset * 0.8 + measured * 0.2);
  try {
    localStorage.setItem(KEY, String(Math.round(offset)));
  } catch {
    // Private browsing: measured again next visit.
  }
}

let last = 0;

/**
 * Now, on the server's clock. Never earlier than the time it gave before: the correction moves a
 * little with each reply (the header counts whole seconds), and two quick taps must stay in order.
 */
export function serverNow() {
  last = Math.max(Date.now() + offset, last + 1);
  return new Date(last);
}
