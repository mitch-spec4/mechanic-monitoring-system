import { useState } from "react";
import { KeyRound } from "lucide-react";
import Modal from "./Modal";
import ShareCode, { formatExpiry } from "./ShareCode";
import { issueResetCode } from "../services/api";
import { errorMessage } from "../lib/format";

type Props = { userId: number; name: string; onClose: () => void };

/** Manager-issued password reset: a one-time code the person enters on the sign-in page. */
export default function ResetPassword({ userId, name, onClose }: Props) {
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const issue = async () => {
    setError("");
    setBusy(true);
    try {
      setResult(await issueResetCode(userId));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Reset password" icon={<KeyRound size={20} />} onClose={onClose}>
      {result ? (
        <ShareCode
          code={result.code}
          email={result.email}
          onDone={onClose}
          summary={
            <>
              Share this code with <b>{result.name}</b>. They choose a new password on the sign-in page under
              "Forgot password?". It works once and expires {formatExpiry(result.expires_at)}.
            </>
          }
          subject="Reset your MechanicPro password"
          lines={[
            `Hi ${result.name},`,
            "",
            `Your password reset code: ${result.code}`,
            "",
            `1. Open ${window.location.origin}`,
            '2. Choose "Forgot password?"',
            `3. Enter this email address (${result.email}), the code, and your new password.`,
            "",
            `The code works once and expires ${formatExpiry(result.expires_at)}.`,
          ]}
        />
      ) : (
        <div className="form form-upgraded">
          {error && <div className="error">{error}</div>}
          <p>
            Create a one-time code so <b>{name}</b> can choose a new password. Their current password and any
            earlier reset code stop working once they use it.
          </p>
          <button type="button" className="primary" onClick={issue} disabled={busy}>
            <KeyRound size={15} /> Create reset code
          </button>
        </div>
      )}
    </Modal>
  );
}
