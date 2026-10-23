import { Fragment, useEffect, useState, type ReactNode } from "react";
import { legalDocument } from "../services/api";
import { go } from "../lib/route";
import { errorMessage } from "../lib/format";
import { SiteNav } from "../pages/Home";
import { Trans } from "../i18n/Trans";
import { t } from "../i18n";
import "../pages/Home.css";

/** The required "I agree" box at signup and when joining a company. The links open in a new tab,
 *  so a half-filled form isn't lost. */
export function TermsAgreement({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="checkRow termsAgreement">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} required />
      <span>
        <Trans
          text="I agree to the {privacy} and the {terms}."
          values={{
            privacy: (
              <a href="#/privacy" target="_blank" rel="noreferrer">
                {t("privacy policy")}
              </a>
            ),
            terms: (
              <a href="#/terms" target="_blank" rel="noreferrer">
                {t("terms of service")}
              </a>
            ),
          }}
        />
      </span>
    </label>
  );
}

// **bold** inside a line of text.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : <Fragment key={index}>{part}</Fragment>,
  );
}

/** Just enough Markdown for policy text: headings, paragraphs, bullet lists and bold. Text only:
 *  no HTML from the file is ever rendered as HTML. */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      const items = list;
      blocks.push(
        <ul key={blocks.length}>
          {items.map((item, index) => (
            <li key={index}>{inline(item)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  for (const paragraph of text.split(/\n{2,}/)) {
    for (const line of paragraph.split("\n")) {
      const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
      if (bullet) {
        list.push(bullet[1]);
        continue;
      }
      flush();
      const heading = /^(#{1,3})\s+(.*)$/.exec(line);
      if (heading) {
        const Tag = (["h1", "h2", "h3"] as const)[heading[1].length - 1];
        blocks.push(<Tag key={blocks.length}>{inline(heading[2])}</Tag>);
      } else if (line.trim()) {
        blocks.push(<p key={blocks.length}>{inline(line)}</p>);
      }
    }
    flush();
  }
  return <>{blocks}</>;
}

/** The public privacy policy or terms page. */
export function LegalPage({ name }: { name: "privacy" | "terms" }) {
  const [doc, setDoc] = useState<{ version: string; text: string } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    legalDocument(name)
      .then(setDoc)
      .catch((problem) => setError(errorMessage(problem)));
  }, [name]);
  return (
    <div className="site legalPage">
      <SiteNav>
        <div className="navActions">
          <button className="btn outline" onClick={() => go("/")}>
            ← {t("Back to the homepage")}
          </button>
        </div>
      </SiteNav>
      <main className="container legalBody">
        {error && <div className="error">{error}</div>}
        {doc && (
          <>
            <Markdown text={doc.text} />
            <p className="legalVersion">{t("Version: {version}", { version: doc.version })}</p>
          </>
        )}
      </main>
    </div>
  );
}
