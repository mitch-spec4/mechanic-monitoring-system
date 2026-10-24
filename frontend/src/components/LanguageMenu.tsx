import { useEffect, useRef, useState } from "react";
import { Check, Languages } from "lucide-react";
import { saveLanguage, type User } from "../services/api";
import { errorMessage } from "../lib/format";
import { toast } from "./Feedback";
import { language, LANGUAGES, setLanguage, t, type Language } from "../i18n";

type Props = { user: User; onUserChanged: (user: User) => void };

/** The language button in the top bar of every signed-in screen. The choice belongs to the account,
 *  like the one in Settings, so emails and notifications follow it too. */
export default function LanguageMenu({ user, onUserChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const current = language();

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const choose = async (next: Language) => {
    setOpen(false);
    if (next === current) return;
    setBusy(true);
    try {
      const data = await saveLanguage(next);
      setLanguage(next);
      onUserChanged({ ...user, ...data.user });
    } catch (problem) {
      toast(errorMessage(problem), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="languageMenu" ref={box}>
      <button
        type="button"
        className="languageTrigger"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t("Language: {name}", { name: LANGUAGES[current].name })}
        disabled={busy}
      >
        <Languages size={17} aria-hidden="true" />
        <span aria-hidden="true">{current.toUpperCase()}</span>
      </button>
      {open && (
        <div className="languageOptions" role="menu" aria-label={t("Language")}>
          {(Object.keys(LANGUAGES) as Language[]).map((code) => (
            <button
              key={code}
              type="button"
              role="menuitemradio"
              aria-checked={code === current}
              lang={code}
              onClick={() => choose(code)}
            >
              <span>{LANGUAGES[code].name}</span>
              {code === current && <Check size={15} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
