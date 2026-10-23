import { useEffect, useState } from "react";
import { MailWarning } from "lucide-react";
import { me, resendVerification } from "../services/api";
import { errorMessage } from "../lib/format";
import "./Onboarding.css";

type Props = { user: any; onVerified: (user: any) => void };

/** Until the boss opens the link in the verification email, inviting people is switched off. */
export default function VerifyBanner({ user, onVerified }: Props) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    // The link is usually opened in another tab; check again when this one is used.
    const check = () =>
      me()
        .then(({ user: fresh }) => fresh.email_verified && onVerified({ ...user, ...fresh }))
        .catch(() => {});
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [user.id]);

  const resend = async () => {
    setError("");
    setBusy(true);
    try {
      setSent((await resendVerification()).message);
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="verifyBanner" role="status">
      <MailWarning size={17} />
      <span>
        <b>Confirm your email.</b> {sent || `We sent a link to ${user.email}. Open it to start inviting your team and customers.`}
        {error && <em className="bannerError"> {error}</em>}
      </span>
      <button className="primary" onClick={resend} disabled={busy}>
        {busy ? "Sending…" : "Resend link"}
      </button>
    </div>
  );
}
