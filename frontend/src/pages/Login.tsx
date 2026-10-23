import { useState, type FormEvent } from "react";
import { acceptInvitation, forgotPassword, login, resetPassword, saveSession, type User } from "../services/api";
import { go } from "../lib/route";
import { errorMessage } from "../lib/format";
import LanguagePicker from "../components/LanguagePicker";
import { mark, t } from "../i18n";

// "link" sets a new password from the link in a reset email; "code" uses a code from a manager.
export type LoginMode = "signin" | "invite" | "forgot" | "code" | "link";
type Props = { done: (user: User) => void; mode?: LoginMode; code?: string; email?: string; token?: string };

const HEADINGS: Record<LoginMode, [string, string]> = {
  signin: [mark("Welcome back"), mark("Service operations, without the paperwork.")],
  invite: [mark("Join your company"), mark("Use the invitation code from your company.")],
  forgot: [mark("Forgot your password?"), mark("Enter your email and we'll send you a link to choose a new one.")],
  code: [mark("Reset your password"), mark("Enter the reset code from your manager and choose a new password.")],
  link: [mark("Choose a new password"), mark("Pick a new password for your account. The link works once.")],
};
const SUBMIT: Record<LoginMode, string> = {
  signin: mark("Sign in"),
  invite: mark("Accept invitation"),
  forgot: mark("Email me a link"),
  code: mark("Set new password"),
  link: mark("Set new password"),
};

/** Leave a page that came from an email link (a spent invitation or reset link) without reloading it. */
const showSignInAddress = () => window.history.replaceState(null, "", "#/signin");

export default function Login({ done, mode: startMode = "signin", code: startCode = "", email: startEmail = "", token = "" }: Props) {
  const [mode, setMode] = useState<LoginMode>(startMode);
  const [email, setEmail] = useState(startEmail);
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState(startCode);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const switchTo = (next: LoginMode) => {
    setMode(next);
    setError("");
    setMessage("");
    setCode("");
    setPassword("");
  };
  const signInWith = (text: string, address = email) => {
    switchTo("signin");
    setEmail(address);
    setMessage(text);
    showSignInAddress();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    try {
      if (mode === "invite") {
        await acceptInvitation({ code, name, email, password });
        signInWith(t("Invitation accepted. You can now sign in."));
      } else if (mode === "forgot") {
        setMessage((await forgotPassword(email)).message);
      } else if (mode === "code" || mode === "link") {
        const result = await resetPassword(mode === "link" ? { token, password } : { code, email, password });
        signInWith(t("Password updated. You can now sign in."), result.email || email);
      } else {
        const data = await login(email, password);
        saveSession(data.user);
        done(data.user);
      }
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  };

  const [heading, subheading] = HEADINGS[mode];
  const signingIn = mode === "signin";
  return (
    <main className="login">
      <form onSubmit={submit}>
        <div className="brand">
          🔧 <span>MECHANIC</span>PRO
        </div>
        <h1>{t(heading)}</h1>
        <p>{t(subheading)}</p>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {message && (
          <div className="success" role="status">
            {message}
          </div>
        )}
        {mode === "invite" && (
          <>
            <label>
              {t("Invitation code")}
              <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="DK-XXXXXXXXXX" required />
            </label>
            <label>
              {t("Full name")}
              <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />
            </label>
          </>
        )}
        {mode === "code" && (
          <label>
            {t("Reset code")}
            <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="RS-XXXXXXXXXX" required />
          </label>
        )}
        {mode !== "link" && (
          <label>
            {t("Email")}
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
          </label>
        )}
        {mode !== "forgot" && (
          <label>
            {signingIn ? t("Password") : t("New password")}
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={signingIn ? undefined : 8}
              autoComplete={signingIn ? "current-password" : "new-password"}
              required
            />
          </label>
        )}
        <button className="primary" disabled={busy}>
          {t(SUBMIT[mode])}
        </button>
        {signingIn ? (
          <>
            <button type="button" className="loginSwitch" onClick={() => switchTo("invite")}>
              {t("Have an invitation code?")}
            </button>
            <button type="button" className="loginSwitch" onClick={() => switchTo("forgot")}>
              {t("Forgot password?")}
            </button>
          </>
        ) : (
          <>
            {mode === "forgot" && (
              <button type="button" className="loginSwitch" onClick={() => switchTo("code")}>
                {t("Have a reset code from your manager?")}
              </button>
            )}
            <button
              type="button"
              className="loginSwitch"
              onClick={() => {
                switchTo("signin");
                showSignInAddress();
              }}
            >
              {t("Back to sign in")}
            </button>
          </>
        )}
        <p className="loginNew">
          {t("New to MechanicPro?")}{" "}
          <button type="button" className="loginSwitch" onClick={() => go("/signup")}>
            {t("Start a free trial")}
          </button>
        </p>
        <button type="button" className="loginSwitch loginHome" onClick={() => go("/")}>
          ← {t("Back to the homepage")}
        </button>
        <LanguagePicker className="loginLanguage" />
      </form>
    </main>
  );
}
