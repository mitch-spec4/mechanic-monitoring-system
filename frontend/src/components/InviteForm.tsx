import { useState } from "react";
import { Mail, UserPlus, Users } from "lucide-react";
import Modal from "./Modal";
import ShareCode, { formatExpiry } from "./ShareCode";
import { invite } from "../services/api";
import { errorMessage } from "../lib/format";

type Props = { role: "customer" | "mechanic"; onClose: () => void; onDone?: () => void };

const COPY = {
  customer: {
    title: "Add New Customer",
    icon: <Users size={20} />,
    nameLabel: "Company/Organization Name",
    namePlaceholder: "Enter customer name",
    emailPlaceholder: "customer@company.com",
  },
  mechanic: {
    title: "Add Mechanic to Team",
    icon: <UserPlus size={20} />,
    nameLabel: "Mechanic Full Name",
    namePlaceholder: "Enter mechanic's name",
    emailPlaceholder: "mechanic@example.com",
  },
};

export default function InviteForm({ role, onClose, onDone }: Props) {
  const text = COPY[role];
  const [formError, setFormError] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ code: string; name: string; email: string; expires_at: string } | null>(null);

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
    <Modal title={text.title} icon={text.icon} onClose={result ? finish : onClose}>
      {result ? (
        <ShareCode
          code={result.code}
          email={result.email}
          onDone={finish}
          summary={
            <>
              Invitation created for <b>{result.name}</b>. Share this code with them. It works once, only for{" "}
              <b>{result.email}</b>, and expires in 7 days.
            </>
          }
          subject="Your MechanicPro invitation"
          lines={[
            `Hi ${result.name},`,
            "",
            "You've been invited to join our team on MechanicPro.",
            "",
            `Your invitation code: ${result.code}`,
            "",
            `1. Open ${window.location.origin}`,
            '2. Choose "Have an invitation code?"',
            `3. Enter the code, your name, this email address (${result.email}) and a password.`,
            "",
            `The code works once and expires on ${formatExpiry(result.expires_at)}.`,
          ]}
        />
      ) : (
        <form className="form form-upgraded" onSubmit={submit}>
          {formError && <div className="error">{formError}</div>}
          <div className="formGroup">
            <label htmlFor="field-name">{text.nameLabel}</label>
            <input id="field-name" name="name" placeholder={text.namePlaceholder} required />
          </div>
          <div className="formGroup">
            <label htmlFor="field-email">Email Address</label>
            <input id="field-email" name="email" type="email" placeholder={text.emailPlaceholder} required />
          </div>
          <button className="primary" style={{ marginTop: "10px" }} disabled={sending}>
            {role === "customer" ? <Mail size={15} /> : <UserPlus size={15} />} Generate Invitation Code
          </button>
        </form>
      )}
    </Modal>
  );
}
