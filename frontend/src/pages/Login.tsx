import { useState, type FormEvent } from "react";
import { acceptInvitation, ApiError, forgotPassword, login, resetPassword, saveSession, verifyTwoFactor, type User } from "../services/api";
import { TermsAgreement } from "../components/Legal";
import { go } from "../lib/route";
import { errorMessage } from "../lib/format";
import LanguagePicker from "../components/LanguagePicker";
import LanguageSuggestion from "../components/LanguageSuggestion";
import { explicitLanguage, mark, t } from "../i18n";
import Field from "../components/Field";
import { BackArrow } from "../components/Arrows";

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
  // After a right password, people with two-step sign-in send a code with this ticket.
  const [ticket, setTicket] = useState("");
  const [otp, setOtp] = useState("");
  const [remember, setRemember] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const switchTo = (next: LoginMode) => {
    setMode(next);
    setError("");
    setMessage("");
    setCode("");
    setPassword("");
    setTicket("");
    setOtp("");
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
        // A language picked on this page wins; otherwise the company's language is used.
        await acceptInvitation({ code, name, email, password, accept_terms: agreed, language: explicitLanguage() });
        signInWith(t("Invitation accepted. You can now sign in."));
      } else if (mode === "forgot") {
        setMessage((await forgotPassword(email)).message);
      } else if (mode === "code" || mode === "link") {
        const result = await resetPassword(mode === "link" ? { token, password } : { code, email, password });
        signInWith(t("Password updated. You can now sign in."), result.email || email);
      } else {
        const data = await login(email, password);
        if ("ticket" in data) {
          setTicket(data.ticket);
          setPassword("");
          return;
        }
        saveSession(data.user);
        done(data.user);
      }
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data = await verifyTwoFactor(ticket, otp, remember);
      saveSession(data.user);
      done(data.user);
    } catch (problem) {
      // A ticket that ran out (or a password changed meanwhile) means starting again.
      if (problem instanceof ApiError && problem.data?.restart) switchTo("signin");
      setError(errorMessage(problem));
      setOtp("");
    } finally {
      setBusy(false);
    }
  };

  if (ticket) {
    return (
      <main className="login">
        <form onSubmit={submitCode}>
          <div className="brand">
            🔧 <span>MECHANIC</span>PRO
          </div>
          <h1>{t("Enter your sign-in code")}</h1>
          <p>{t("Open your authenticator app and type the 6-digit code for MechanicPro. Lost your phone? Type one of your backup codes instead.")}</p>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <Field wrap label={t("Sign-in code")}>
            <input
              className="codeInput"
              value={otp}
              onChange={(event) => setOtp(event.target.value)}
              inputMode="text"
              autoComplete="one-time-code"
              autoFocus
              maxLength={12}
              required
            />
          </Field>
          <label className="checkRow">
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
            {t("Remember this device for 30 days")}
          </label>
          <button className="primary" disabled={busy}>
            {t("Verify")}
          </button>
          <button type="button" className="loginSwitch" onClick={() => switchTo("signin")}>
            {t("Back to sign in")}
          </button>
        </form>
      </main>
    );
  }

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
            <Field wrap label={t("Invitation code")}>
              <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="DK-XXXXXXXXXX" required />
            </Field>
            <Field wrap label={t("Full name")}>
              <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />
            </Field>
          </>
        )}
        {mode === "code" && (
          <Field wrap label={t("Reset code")}>
            <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="RS-XXXXXXXXXX" required />
          </Field>
        )}
        {mode !== "link" && (
          <Field wrap label={t("Email")}>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
          </Field>
        )}
        {mode !== "forgot" && (
          <Field wrap label={signingIn ? t("Password") : t("New password")}>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={signingIn ? undefined : 8}
              autoComplete={signingIn ? "current-password" : "new-password"}
              required
            />
          </Field>
        )}
        {mode === "invite" && <TermsAgreement checked={agreed} onChange={setAgreed} />}
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
          <BackArrow /> {t("Back to the homepage")}
        </button>
        <LanguagePicker className="loginLanguage" />
      </form>
      <LanguageSuggestion />
    </main>
  );
}
