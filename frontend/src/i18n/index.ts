/**
 * The app's words in the reader's language. English is the source and the default; the English text
 * is the key, and sw.ts holds its Kiswahili.
 *
 *   t("Create job")                     -> "Unda kazi" in Kiswahili
 *   t("{count} days left", { count })   -> values fill the {placeholders}
 *   mark("Job management")              -> marks text kept in a list, translated later with t(item)
 *
 * `npm run i18n:check` fails the build if any text on screen isn't wrapped, or has no Kiswahili.
 */
import { EN } from "./en";
import { SW } from "./sw";

export type Language = "en" | "sw";

/** Each language's name in itself, and whether it reads right to left (none of these do yet). */
export const LANGUAGES: Record<Language, { name: string; rtl: boolean }> = {
  en: { name: "English", rtl: false },
  sw: { name: "Kiswahili", rtl: false },
};

const CATALOGS: Record<Language, Record<string, string>> = { en: EN, sw: SW };
const STORAGE_KEY = "language";
export const LANGUAGE_CHANGED_EVENT = "mechanicpro:language-changed";

function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && value in LANGUAGES;
}

function stored(): Language {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isLanguage(value) ? value : "en";
  } catch {
    return "en";
  }
}

let current: Language = stored();

function applyToPage(language: Language) {
  document.documentElement.lang = language;
  document.documentElement.dir = LANGUAGES[language].rtl ? "rtl" : "ltr";
}
applyToPage(current);

export function language(): Language {
  return current;
}

/** Switch the whole app. Remembered on this device, so the sign-in page opens in it next time. */
export function setLanguage(next: unknown) {
  const chosen = isLanguage(next) ? next : "en";
  try {
    localStorage.setItem(STORAGE_KEY, chosen);
  } catch {
    // Private browsing: the choice still applies until the page closes.
  }
  if (chosen === current) return;
  current = chosen;
  applyToPage(chosen);
  window.dispatchEvent(new Event(LANGUAGE_CHANGED_EVENT));
}

export function t(text: string, values?: Record<string, string | number>) {
  const translated = CATALOGS[current][text] ?? text;
  return values ? translated.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match)) : translated;
}

/** Text that is defined before it's shown (a list of features, say): returned unchanged, so it can be
 * passed to t() when it's displayed. The checker collects these too. */
export function mark<T extends string>(text: T): T {
  return text;
}
