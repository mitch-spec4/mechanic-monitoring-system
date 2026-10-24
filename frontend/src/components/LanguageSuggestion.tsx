import { useState } from "react";
import { Languages, X } from "lucide-react";
import { explicitLanguage, inLanguage, language, mark, setLanguage, t } from "../i18n";

// Time zones of countries where Kiswahili is an official language. Read from the device's own clock
// settings: no location is looked up or sent anywhere.
const KISWAHILI_ZONES = new Set(["Africa/Nairobi", "Africa/Dar_es_Salaam", "Africa/Kampala", "Africa/Kigali"]);
const DISMISSED_KEY = "languageOffer";
const OFFER = mark("Would you like MechanicPro in Kiswahili?");
const ACCEPT = mark("Use Kiswahili");

function shouldOffer() {
  try {
    if (explicitLanguage() || language() !== "en" || localStorage.getItem(DISMISSED_KEY)) return false;
    return KISWAHILI_ZONES.has(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return false;
  }
}

/** On a first visit from East Africa, offer Kiswahili. English stays the default until someone
 *  says otherwise, and the offer isn't repeated on this device. */
export default function LanguageSuggestion() {
  const [visible, setVisible] = useState(shouldOffer);
  if (!visible) return null;
  const close = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Private browsing: it simply comes back next visit.
    }
    setVisible(false);
  };
  return (
    <div className="languageSuggestion" role="dialog" aria-labelledby="language-offer" lang="sw">
      <Languages size={20} aria-hidden="true" />
      <div>
        <strong id="language-offer">{inLanguage("sw", OFFER)}</strong>
        <small lang="en">{t(OFFER)}</small>
      </div>
      <div className="languageSuggestionActions">
        <button
          type="button"
          className="primary"
          onClick={() => {
            setLanguage("sw");
            close();
          }}
        >
          {inLanguage("sw", ACCEPT)}
        </button>
        <button
          type="button"
          className="secondary"
          lang="en"
          onClick={() => {
            setLanguage("en");
            close();
          }}
        >
          {t("Keep English")}
        </button>
      </div>
      <button type="button" className="languageSuggestionClose" onClick={close} aria-label={t("Close")}>
        <X size={16} />
      </button>
    </div>
  );
}
