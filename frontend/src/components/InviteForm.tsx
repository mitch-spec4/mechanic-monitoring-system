import { useState } from "react";
import { Check, Copy, Mail, UserPlus, Users } from "lucide-react";
import Modal from "./Modal";
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

// Builds a pre-filled email for the manager's own mail app until the app sends email itself.
function inviteEmail(name: string, email: string, code: string, expiresAt: string) {
  const expires = new Date(expiresAt + "Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const body = [
    `Hi ${name},`,
    "",
    "You've been invited to join our team on MechanicPro.",
    "",
    `Your invitation code: ${code}`,
    "",
    `1. Open ${window.location.origin}`,
    '2. Choose "Have an invitation code?"',
    `3. Enter the code, your name, this email address (${email}) and a password.`,
    "",
    `The code works once and expires on ${expires}.`,
  ].join("\n");
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Your MechanicPro invitation")}&body=${encodeURIComponent(body)}`;
}

export default function InviteForm({ role, onClose, onDone }: Props) {
  const text = COPY[role];
  const [formError, setFormError] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ code: string; name: string; email: string; expires_at: string } | null>(null);
  const [copied, setCopied] = useState(false);

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

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result!.code);
      setCopied(true);
    } catch {
      setFormError("Copy failed. Select the code and copy it manually.");
    }
  };

  const finish = () => (onDone ?? onClose)();

  return (
    <Modal title={text.title} icon={text.icon} onClose={result ? finish : onClose}>
      {result ? (
        <div className="form form-upgraded">
          <p>
            Invitation created for <b>{result.name}</b>. Share this code with them. It works once, only for{" "}
            <b>{result.email}</b>, and expires in 7 days.
          </p>
          <strong className="inviteCode" data-testid="invite-code">{result.code}</strong>
          {formError && <div className="error">{formError}</div>}
          <div className="row inviteActions">
            <button type="button" className="secondary" onClick={copy}>
              {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy code"}
            </button>
            <a className="secondary inviteEmail" href={inviteEmail(result.name, result.email, result.code, result.expires_at)}>
              <Mail size={15} /> Email this code
            </a>
          </div>
          <button type="button" className="primary" onClick={finish}>
            Done
          </button>
        </div>
      ) : (
        <form className="form form-upgraded" onSubmit={submit}>
          {formError && <div className="error">{formError}</div>}
          <div className="formGroup">
            <label>{text.nameLabel}</label>
            <input name="name" placeholder={text.namePlaceholder} required />
          </div>
          <div className="formGroup">
            <label>Email Address</label>
            <input name="email" type="email" placeholder={text.emailPlaceholder} required />
          </div>
          <button className="primary" style={{ marginTop: "10px" }} disabled={sending}>
            {role === "customer" ? <Mail size={15} /> : <UserPlus size={15} />} Generate Invitation Code
          </button>
        </form>
      )}
    </Modal>
  );
}
