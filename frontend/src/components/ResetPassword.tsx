import { useState } from "react";
import { KeyRound } from "lucide-react";
import Modal from "./Modal";
import ShareCode, { formatExpiry } from "./ShareCode";
import { issueResetCode } from "../services/api";
import { errorMessage } from "../lib/format";
import { t } from "../i18n";
import { Trans } from "../i18n/Trans";

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
    <Modal title={t("Reset password")} icon={<KeyRound size={20} />} onClose={onClose}>
      {result ? (
        <ShareCode
          code={result.code}
          email={result.email}
          onDone={onClose}
          summary={
            <Trans
              text='Share this code with {name}. They enter it on the sign-in page under "Forgot password?" and "Have a reset code from your manager?". It works once and expires {date}.'
              values={{ name: <b>{result.name}</b>, date: formatExpiry(result.expires_at) }}
            />
          }
          subject={t("Reset your MechanicPro password")}
          lines={[
            t("Hi {name},", { name: result.name }),
            "",
            t("Your password reset code: {code}", { code: result.code }),
            "",
            t("1. Open {address}", { address: window.location.origin }),
            t('2. Choose "Forgot password?", then "Have a reset code from your manager?"'),
            t("3. Enter this email address ({email}), the code, and your new password.", { email: result.email }),
            "",
            t("The code works once and expires {date}.", { date: formatExpiry(result.expires_at) }),
          ]}
        />
      ) : (
        <div className="form form-upgraded">
          {error && <div className="error">{error}</div>}
          <p>
            <Trans
              text="Create a one-time code so {name} can choose a new password. Their current password and any earlier reset code stop working once they use it."
              values={{ name: <b>{name}</b> }}
            />
          </p>
          <button type="button" className="primary" onClick={issue} disabled={busy}>
            <KeyRound size={15} /> {t("Create reset code")}
          </button>
        </div>
      )}
    </Modal>
  );
}
