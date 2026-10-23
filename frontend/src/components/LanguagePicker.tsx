import { useEffect, useState } from "react";
import { Languages } from "lucide-react";
import { language, LANGUAGE_CHANGED_EVENT, LANGUAGES, setLanguage, t, type Language } from "../i18n";

type Props = {
  /** Saves the choice to the account as well; without it the choice is kept on this device only. */
  onChange?: (next: Language) => Promise<unknown>;
  className?: string;
};

/** A language select. Signed in it lives in Settings; the sign-in and sign-up pages show a small one,
 *  since a visitor can't reach Settings yet. */
export default function LanguagePicker({ onChange, className = "" }: Props) {
  const [value, setValue] = useState(language());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const follow = () => setValue(language());
    window.addEventListener(LANGUAGE_CHANGED_EVENT, follow);
    return () => window.removeEventListener(LANGUAGE_CHANGED_EVENT, follow);
  }, []);
  const choose = async (next: Language) => {
    setBusy(true);
    try {
      await onChange?.(next);
      setLanguage(next);
    } finally {
      setBusy(false);
    }
  };
  return (
    <label className={`languagePicker ${className}`}>
      <Languages size={15} aria-hidden="true" />
      <span>{t("Language")}</span>
      <select value={value} disabled={busy} onChange={(event) => choose(event.target.value as Language)}>
        {(Object.keys(LANGUAGES) as Language[]).map((code) => (
          <option key={code} value={code} lang={code}>
            {LANGUAGES[code].name}
          </option>
        ))}
      </select>
    </label>
  );
}
