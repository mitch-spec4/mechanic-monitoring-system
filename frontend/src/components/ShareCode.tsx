import { useState, type ReactNode } from "react";
import { Check, Copy, Mail } from "lucide-react";
import { formatDateTime } from "../lib/format";
import { t } from "../i18n";

type Props = {
  code: string;
  summary: ReactNode;
  email: string;
  subject: string;
  // Lines of the pre-filled email for the manager's own mail app (until the app sends email itself).
  lines: string[];
  onDone: () => void;
};

export function formatExpiry(expiresAt: string) {
  return formatDateTime(expiresAt);
}

export default function ShareCode({ code, summary, email, subject, lines, onDone }: Props) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setError(t("Copy failed. Select the code and copy it manually."));
    }
  };
  const mailto = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n"))}`;
  return (
    <div className="form form-upgraded">
      <p>{summary}</p>
      <strong className="inviteCode" data-testid="share-code">{code}</strong>
      {error && <div className="error">{error}</div>}
      <div className="row inviteActions">
        <button type="button" className="secondary" onClick={copy}>
          {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? t("Copied") : t("Copy code")}
        </button>
        <a className="secondary inviteEmail" href={mailto}>
          <Mail size={15} /> {t("Email this code")}
        </a>
      </div>
      <button type="button" className="primary" onClick={onDone}>
        {t("Done")}
      </button>
    </div>
  );
}
