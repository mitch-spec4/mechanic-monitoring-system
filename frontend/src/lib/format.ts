import { mark, t } from "../i18n";

const MONTHS = [mark("Jan"), mark("Feb"), mark("Mar"), mark("Apr"), mark("May"), mark("Jun"), mark("Jul"), mark("Aug"), mark("Sep"), mark("Oct"), mark("Nov"), mark("Dec")];

// Times are shown in the company's time zone, so everyone on a team sees the same times.
let zone = "Africa/Nairobi";

export function setTimeZone(next?: string | null) {
  if (!next) return;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: next });
    zone = next;
  } catch {
    // An unknown zone keeps the previous one.
  }
}

// Distances follow the company's units setting.
let imperial = false;

export function setUnits(next?: string | null) {
  imperial = next === "imperial";
}

/** A short distance such as a location's accuracy: "12 m", or "39 ft" for imperial companies. */
export function formatDistance(metres: number) {
  if (imperial) {
    const feet = metres * 3.28084;
    return feet < 1000 ? `${Math.round(feet)} ft` : `${(metres / 1609.344).toFixed(1)} mi`;
  }
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
}

/** The server sends times in UTC without a zone marker ("2026-10-23T09:30:00"). */
export function asDate(value: string) {
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
}

function parts(value: string) {
  const found = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "numeric", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(asDate(value))
      .map((part) => [part.type, part.value]),
  );
  return { day: found.day, month: Number(found.month), year: found.year, time: `${found.hour}:${found.minute}` };
}

/** A calendar date ("2026-08-29", a due date) as "29 Aug 2026". */
export function formatDate(value?: string | null) {
  if (!value) return "";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return value;
  return `${String(day).padStart(2, "0")} ${t(MONTHS[month - 1] ?? String(month))} ${year}`;
}

/** The day of a moment in time, in the company's time zone: "29 Aug 2026". */
export function formatDay(value?: string | null) {
  if (!value) return "";
  const { day, month, year } = parts(value);
  return `${day} ${t(MONTHS[month - 1])} ${year}`;
}

/** A moment in time: "29 Aug 2026 14:30". */
export function formatDateTime(value?: string | null) {
  if (!value) return "";
  return `${formatDay(value)} ${parts(value).time}`;
}

/** The clock time of a moment: "14:30". */
export function formatTime(value?: string | null) {
  return value ? parts(value).time : "";
}

/** How long ago a moment was: "just now", "5 min ago", "2 h 10 min ago". */
export function ago(value: string, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - asDate(value).getTime()) / 60000));
  if (minutes < 1) return t("just now");
  if (minutes < 60) return t("{minutes} min ago", { minutes });
  return t("{hours} h {minutes} min ago", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

// How far the company's zone is ahead of UTC at a moment, in milliseconds.
function zoneOffset(moment: number) {
  const found = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" })
      .formatToParts(new Date(moment))
      .map((part) => [part.type, Number(part.value)]),
  );
  return Date.UTC(found.year, found.month - 1, found.day, found.hour, found.minute, found.second) - Math.floor(moment / 1000) * 1000;
}

/** A moment as "YYYY-MM-DDTHH:MM" on the company's clock, for a datetime-local input. */
export function toZoneInput(date: Date) {
  return new Date(date.getTime() + zoneOffset(date.getTime())).toISOString().slice(0, 16);
}

/** The moment a datetime-local value ("2026-10-23T17:30") names on the company's clock. */
export function fromZoneInput(value: string) {
  const [day, clock = "00:00"] = value.split("T");
  const [year, month, date] = day.split("-").map(Number);
  const [hour, minute] = clock.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, date, hour, minute);
  // The offset at the wall time itself is close; one more pass settles daylight-saving edges.
  const first = wall - zoneOffset(wall);
  return new Date(wall - zoneOffset(first));
}

export function greeting(date = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", hourCycle: "h23" }).format(date));
  if (hour < 12) return t("Good morning");
  if (hour < 17) return t("Good afternoon");
  return t("Good evening");
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : t("Something went wrong. Please try again.");
}

/** "0 B", "350 KB", "1.2 GB": photo and video storage used. */
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
