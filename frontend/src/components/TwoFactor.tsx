import { useEffect, useRef, useState, type FormEvent } from "react";
import { Copy, Download, KeyRound, ShieldCheck, Smartphone } from "lucide-react";
import Modal from "./Modal";
import { toast } from "./Feedback";
import { Loading } from "./States";
import { enableTwoFactor, renewBackupCodes, startTwoFactorSetup, twoFactorStatus, type User } from "../services/api";
import { errorMessage } from "../lib/format";
import { t } from "../i18n";
import Field from "./Field";

type SetupDetails = { setup_token: string; secret_grouped: string; otpauth_uri: string; qr_svg: string };

/** Hand a file made in the browser to the person, as a download. */
export function saveFile(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The backup codes, shown once: each works one time, in place of a code from the phone. */
export function BackupCodes({ codes }: { codes: string[] }) {
  const text = codes.join("\n");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast(t("Backup codes copied"));
    } catch {
      toast(t("Copy failed. Select the codes and copy them manually."), "error");
    }
  };
  return (
    <div className="backupCodes">
      <p>{t("Keep these somewhere safe, away from your phone. Each one works once, if you can't use your authenticator app.")}</p>
      <ol className="backupCodeGrid" data-testid="backup-codes">
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ol>
      <div className="row backupCodeActions">
        <button type="button" className="secondary" onClick={copy}>
          <Copy size={15} /> {t("Copy")}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => saveFile("mechanicpro-backup-codes.txt", new Blob([`MechanicPro\n\n${text}\n`], { type: "text/plain" }))}
        >
          <Download size={15} /> {t("Download")}
        </button>
      </div>
    </div>
  );
}

/** Scan the QR code, type the code the app shows, then save the backup codes. Nothing changes
 *  until the code is confirmed; setting it up again (a new phone) replaces the old app and codes. */
export function TwoFactorSetupSteps({ onEnabled }: { onEnabled: (user: User) => void }) {
  const [details, setDetails] = useState<SetupDetails | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ user: User; codes: string[] } | null>(null);

  // Each request makes a new key: only the newest one's answer is shown, so the key never changes
  // under someone scanning it (an older answer arriving last, or one after the screen closed).
  const latest = useRef(0);
  const start = () => {
    const request = ++latest.current;
    setError("");
    setDetails(null);
    setCode("");
    startTwoFactorSetup()
      .then((answer) => request === latest.current && setDetails(answer))
      .catch((problem) => request === latest.current && setError(errorMessage(problem)));
  };
  useEffect(() => {
    start();
    return () => {
      latest.current += 1;
    };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!details) return;
    setError("");
    setBusy(true);
    try {
      const data = await enableTwoFactor(details.setup_token, code);
      setDone({ user: data.user, codes: data.backup_codes });
    } catch (problem) {
      setError(errorMessage(problem));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="twoFactorSteps">
        <div className="success" role="status">
          {t("Two-step sign-in is on.")}
        </div>
        <h2>{t("Save your backup codes")}</h2>
        <BackupCodes codes={done.codes} />
        <button type="button" className="primary" onClick={() => onEnabled(done.user)}>
          {t("I've saved my backup codes")}
        </button>
      </div>
    );
  }

  return (
    <form className="twoFactorSteps" onSubmit={submit}>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <ol className="twoFactorStepList">
        <li>
          <strong>{t("Install an authenticator app")}</strong>
          <span>{t("Google Authenticator, Microsoft Authenticator, or any app that shows 6-digit codes.")}</span>
        </li>
        <li>
          <strong>{t("Scan this QR code with the app")}</strong>
          {details ? (
            <>
              <img className="qrCode" src={details.qr_svg} alt={t("QR code for your authenticator app")} width={180} height={180} />
              <a className="secondary onPhones" href={details.otpauth_uri}>
                <Smartphone size={15} /> {t("Open in the authenticator app on this phone")}
              </a>
              <span>{t("Can't scan it? Type this key into the app instead:")}</span>
              <code className="setupKey" data-testid="setup-key">
                {details.secret_grouped}
              </code>
            </>
          ) : (
            !error && <Loading />
          )}
        </li>
        <li>
          <Field wrap label={<strong>{t("Type the 6-digit code the app shows")}</strong>}>
            <input
              className="codeInput"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,7}"
              maxLength={7}
              required
            />
          </Field>
        </li>
      </ol>
      <button className="primary" disabled={busy || !details}>
        <ShieldCheck size={15} /> {t("Turn on two-step sign-in")}
      </button>
      {error && !details && (
        <button type="button" className="secondary" onClick={start}>
          {t("Try again")}
        </button>
      )}
    </form>
  );
}

type PageProps = { onDone: (user: User) => void; onLogout: () => void };

/** Shown instead of the app to anyone who hasn't set up two-step sign-in yet. */
export default function TwoFactorSetupPage({ onDone, onLogout }: PageProps) {
  return (
    <main className="login twoFactorPage">
      <div className="loginCard">
        <div className="brand">
          🔧 <span>MECHANIC</span>PRO
        </div>
        <h1>{t("Set up two-step sign-in")}</h1>
        <p>{t("To keep your company's data safe, MechanicPro asks for a code from your phone as well as your password when you sign in.")}</p>
        <TwoFactorSetupSteps onEnabled={onDone} />
        <button type="button" className="loginSwitch" onClick={onLogout}>
          {t("Sign out")}
        </button>
      </div>
    </main>
  );
}

type SettingsProps = { user: User; onUserChanged: (user: User) => void };
type Status = { enabled: boolean; required: boolean; backup_codes_left: number };

/** Settings: whether two-step sign-in is on, backup codes left, a new phone, new backup codes. */
export function TwoFactorSettings({ user, onUserChanged }: SettingsProps) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [settingUp, setSettingUp] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const load = () =>
    twoFactorStatus()
      .then(setStatus)
      .catch((problem) => setError(errorMessage(problem)));
  useEffect(() => {
    load();
  }, []);

  return (
    <section className="settingsSection" aria-labelledby="settings-two-factor">
      <h3 id="settings-two-factor">
        <ShieldCheck size={16} /> {t("Two-step sign-in")}
      </h3>
      <p className="muted">{t("When you sign in, MechanicPro asks for a code from the authenticator app on your phone as well as your password.")}</p>
      {error && <div className="error">{error}</div>}
      {!status ? (
        !error && <Loading />
      ) : (
        <>
          <div className="settingsView">
            <div>
              <span>{t("Status")}</span>
              <strong className={status.enabled ? "statusOn" : "statusOff"}>{status.enabled ? t("On") : t("Off")}</strong>
            </div>
            {status.enabled && (
              <div>
                <span>{t("Backup codes left")}</span>
                <strong className={status.backup_codes_left <= 3 ? "statusLow" : ""}>{status.backup_codes_left}</strong>
              </div>
            )}
          </div>
          {status.enabled && status.backup_codes_left <= 3 && <p className="muted">{t("You're running out of backup codes. Make new ones so you can always get in.")}</p>}
          <div className="row settingsActions">
            <button type="button" className="secondary" onClick={() => setSettingUp(true)}>
              <Smartphone size={15} /> {status.enabled ? t("Set up on a new phone") : t("Turn on two-step sign-in")}
            </button>
            {status.enabled && (
              <button type="button" className="secondary" onClick={() => setRenewing(true)}>
                <KeyRound size={15} /> {t("New backup codes")}
              </button>
            )}
          </div>
        </>
      )}
      {settingUp && (
        <Modal title={t("Set up two-step sign-in")} icon={<ShieldCheck size={20} />} onClose={() => setSettingUp(false)}>
          <TwoFactorSetupSteps
            onEnabled={(changed) => {
              setSettingUp(false);
              onUserChanged({ ...user, ...changed });
              load();
            }}
          />
        </Modal>
      )}
      {renewing && (
        <RenewBackupCodes
          onClose={() => {
            setRenewing(false);
            load();
          }}
        />
      )}
    </section>
  );
}

function RenewBackupCodes({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      setCodes((await renewBackupCodes(password)).backup_codes);
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={t("New backup codes")} icon={<KeyRound size={20} />} onClose={onClose}>
      {codes ? (
        <div className="form form-upgraded">
          <BackupCodes codes={codes} />
          <button type="button" className="primary" onClick={onClose}>
            {t("I've saved my backup codes")}
          </button>
        </div>
      ) : (
        <form className="form form-upgraded" onSubmit={submit}>
          <p>{t("Your old backup codes stop working once you make new ones.")}</p>
          {error && <div className="error">{error}</div>}
          <Field label={t("Current password")}>
            <input
              id="field-backup-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>
          <button className="primary" disabled={busy}>
            {t("Make new backup codes")}
          </button>
        </form>
      )}
    </Modal>
  );
}
