import { useState } from "react";
import { Mail, UserPlus, Users } from "lucide-react";
import Modal from "./Modal";
import ShareCode, { formatExpiry } from "./ShareCode";
import { invite } from "../services/api";
import { errorMessage } from "../lib/format";
import { mark, t } from "../i18n";
import { Trans } from "../i18n/Trans";

type Props = { role: "customer" | "mechanic"; onClose: () => void; onDone?: () => void };

const COPY = {
  customer: {
    title: mark("Add New Customer"),
    icon: <Users size={20} />,
    nameLabel: mark("Company/Organization Name"),
    namePlaceholder: mark("Enter customer name"),
    emailPlaceholder: "customer@company.com",
  },
  mechanic: {
    title: mark("Add Technician to Team"),
    icon: <UserPlus size={20} />,
    nameLabel: mark("Technician's Full Name"),
    namePlaceholder: mark("Enter the technician's name"),
    emailPlaceholder: "technician@example.com",
  },
};

export default function InviteForm({ role, onClose, onDone }: Props) {
  const text = COPY[role];
  const [formError, setFormError] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ code: string; name: string; email: string; expires_at: string; emailed: boolean } | null>(null);

  const submit = async (event: any) => {
    event.preventDefault();
    setFormError("");
    setSending(true);
    const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    try {
      const response = await invite({ ...form, role });
      setResult({ ...response, name: form.name.trim(), email: form.email.trim() });
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSending(false);
    }
  };

  const finish = () => (onDone ?? onClose)();

  return (
    <Modal title={t(text.title)} icon={text.icon} onClose={result ? finish : onClose}>
      {result ? (
        <ShareCode
          code={result.code}
          email={result.email}
          onDone={finish}
          summary={
            result.emailed ? (
              <Trans
                text="We emailed an invitation to {email}. You can also send {name} the code yourself, for example on WhatsApp. It works once, only for that address, and expires in 7 days."
                values={{ email: <b>{result.email}</b>, name: <b>{result.name}</b> }}
              />
            ) : (
              <Trans
                text="Invitation created for {name}. Share this code with them. It works once, only for {email}, and expires in 7 days."
                values={{ email: <b>{result.email}</b>, name: <b>{result.name}</b> }}
              />
            )
          }
          subject={t("Your MechanicPro invitation")}
          lines={[
            t("Hi {name},", { name: result.name }),
            "",
            t("You've been invited to join our team on MechanicPro."),
            "",
            t("Accept the invitation: {link}", { link: `${window.location.origin}/#/join?${new URLSearchParams({ code: result.code, email: result.email })}` }),
            "",
            t('Or open {address}, choose "Have an invitation code?" and enter {code} with this email address ({email}).', {
              address: window.location.origin,
              code: result.code,
              email: result.email,
            }),
            "",
            t("The code works once and expires on {date}.", { date: formatExpiry(result.expires_at) }),
          ]}
        />
      ) : (
        <form className="form form-upgraded" onSubmit={submit}>
          {formError && <div className="error">{formError}</div>}
          <div className="formGroup">
            <label htmlFor="field-name">{t(text.nameLabel)}</label>
            <input id="field-name" name="name" placeholder={t(text.namePlaceholder)} required />
          </div>
          <div className="formGroup">
            <label htmlFor="field-email">{t("Email Address")}</label>
            <input id="field-email" name="email" type="email" placeholder={text.emailPlaceholder} required />
          </div>
          <button className="primary" style={{ marginTop: "10px" }} disabled={sending}>
            {role === "customer" ? <Mail size={15} /> : <UserPlus size={15} />} {t("Send invitation")}
          </button>
        </form>
      )}
    </Modal>
  );
}
