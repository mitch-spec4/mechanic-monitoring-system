import {useState} from "react";
import {acceptInvitation, forgotPassword, login, resetPassword, saveSession} from "../services/api";
import {go} from "../lib/route";

// "link" sets a new password from the link in a reset email; "code" uses a code from a manager.
export type LoginMode = "signin" | "invite" | "forgot" | "code" | "link";
type Props = {done: (user: any) => void; mode?: LoginMode; code?: string; email?: string; token?: string};

const HEADINGS: Record<LoginMode, [string, string]> = {
  signin: ["Welcome back", "Service operations, without the paperwork."],
  invite: ["Join your company", "Use the invitation code from your company."],
  forgot: ["Forgot your password?", "Enter your email and we'll send you a link to choose a new one."],
  code: ["Reset your password", "Enter the reset code from your manager and choose a new password."],
  link: ["Choose a new password", "Pick a new password for your account. The link works once."],
};

/** Leave a page that came from an email link (a spent invitation or reset link) without reloading it. */
const showSignInAddress = () => window.history.replaceState(null, "", "#/signin");

export default function Login({done, mode: startMode = "signin", code: startCode = "", email: startEmail = "", token = ""}: Props) {
  const [mode, setMode] = useState<LoginMode>(startMode), [email, setEmail] = useState(startEmail), [password, setPassword] = useState(""), [name, setName] = useState(""), [code, setCode] = useState(startCode), [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const switchTo = (next: LoginMode) => {setMode(next); setError(""); setMessage(""); setCode(""); setPassword("");};
  const signInWith = (text: string, address = email) => {switchTo("signin"); setEmail(address); setMessage(text); showSignInAddress();};
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(""); setMessage(""); setBusy(true);
    try {
      if (mode === "invite") {
        await acceptInvitation({code, name, email, password});
        signInWith("Invitation accepted. You can now sign in."); return;
      }
      if (mode === "forgot") {
        setMessage((await forgotPassword(email)).message); return;
      }
      if (mode === "code" || mode === "link") {
        const result = await resetPassword(mode === "link" ? {token, password} : {code, email, password});
        signInWith("Password updated. You can now sign in.", result.email || email); return;
      }
      const data = await login(email, password);
      saveSession(data.user); done(data.user);
    } catch (value: any) { setError(value.message); } finally { setBusy(false); }
  };
  const [heading, subheading] = HEADINGS[mode];
  const needsPassword = mode !== "forgot";
  return <main className="login"><form onSubmit={submit}><div className="brand">🔧 <span>MECHANIC</span>PRO</div><h1>{heading}</h1><p>{subheading}</p>{error && <div className="error" role="alert">{error}</div>}{message && <div className="success" role="status">{message}</div>}
    {mode === "invite" && <><label>Invitation code<input value={code} onChange={event => setCode(event.target.value)} placeholder="DK-XXXXXXXXXX" required /></label><label>Full name<input value={name} onChange={event => setName(event.target.value)} autoComplete="name" required /></label></>}
    {mode === "code" && <label>Reset code<input value={code} onChange={event => setCode(event.target.value)} placeholder="RS-XXXXXXXXXX" required /></label>}
    {mode !== "link" && <label>Email<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required /></label>}
    {needsPassword && <label>{mode === "signin" ? "Password" : "New password"}<input type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={mode === "signin" ? undefined : 8} autoComplete={mode === "signin" ? "current-password" : "new-password"} required /></label>}
    <button className="primary" disabled={busy}>{mode === "invite" ? "Accept invitation" : mode === "forgot" ? "Email me a link" : mode === "code" || mode === "link" ? "Set new password" : "Sign in"}</button>
    {mode === "signin" ? <>
      <button type="button" className="loginSwitch" onClick={() => switchTo("invite")}>Have an invitation code?</button>
      <button type="button" className="loginSwitch" onClick={() => switchTo("forgot")}>Forgot password?</button>
    </> : <>
      {mode === "forgot" && <button type="button" className="loginSwitch" onClick={() => switchTo("code")}>Have a reset code from your manager?</button>}
      <button type="button" className="loginSwitch" onClick={() => {switchTo("signin"); showSignInAddress();}}>Back to sign in</button>
    </>}
    <p className="loginNew">New to MechanicPro? <button type="button" className="loginSwitch" onClick={() => go("/signup")}>Start a free trial</button></p>
    <button type="button" className="loginSwitch loginHome" onClick={() => go("/")}>← Back to the homepage</button>
  </form></main>;
}
