import { mark } from "../i18n";

/** Light, dark, or whatever the phone or computer is set to. Kept on this device; light by default,
 *  so the app looks the same as before until someone picks another. */
export type Theme = "light" | "dark" | "system";

export const THEMES: Record<Theme, string> = { light: mark("Light"), dark: mark("Dark"), system: mark("Same as this device") };
const STORAGE_KEY = "theme";

function stored(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "dark" || value === "system" ? value : "light";
  } catch {
    return "light";
  }
}

let current = stored();
// The colours switch through `color-scheme`; scripts/dark-colors.mjs gives every colour its dark partner.
const apply = (theme: Theme) => {
  document.documentElement.dataset.theme = theme;
};
apply(current);

export function theme() {
  return current;
}

export function setTheme(next: Theme) {
  current = next;
  apply(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private browsing: the choice lasts until the page closes.
  }
}
