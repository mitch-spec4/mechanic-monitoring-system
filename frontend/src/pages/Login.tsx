import {useState} from "react";
import {acceptInvitation, login, resetPassword, saveSession} from "../services/api";
import {go} from "../lib/route";

type Props = {done: (user: any) => void};
type Mode = "signin" | "invite" | "reset";

const HEADINGS: Record<Mode, [string, string]> = {
  signin: ["Welcome back", "Service operations, without the paperwork."],
  invite: ["Join your company", "Use the invitation code from your company."],
  reset: ["Reset your password", "Enter the reset code from your manager and choose a new password."],
};

export default function Login({done}: Props) {
  const [mode, setMode] = useState<Mode>("signin"), [email, setEmail] = useState(""), [password, setPassword] = useState(""), [name, setName] = useState(""), [code, setCode] = useState(""), [error, setError] = useState(""), [message, setMessage] = useState("");
  const switchTo = (next: Mode) => {setMode(next); setError(""); setMessage(""); setCode(""); setPassword("");};
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(""); setMessage("");
    try {
      if (mode === "invite") {
        await acceptInvitation({code, name, email, password});
        switchTo("signin"); setMessage("Invitation accepted. You can now sign in."); return;
      }
      if (mode === "reset") {
        await resetPassword({code, email, password});
        switchTo("signin"); setMessage("Password updated. You can now sign in."); return;
      }
      const data = await login(email, password);
      saveSession(data.user); done(data.user);
    } catch (value: any) { setError(value.message); }
  };
  const [heading, subheading] = HEADINGS[mode];
  return <main className="login"><form onSubmit={submit}><div className="brand">🔧 <span>MECHANIC</span>PRO</div><h1>{heading}</h1><p>{subheading}</p>{error && <div className="error">{error}</div>}{message && <div className="success">{message}</div>}
    {mode === "invite" && <><label>Invitation code<input value={code} onChange={event => setCode(event.target.value)} placeholder="DK-XXXXXXXXXX" required /></label><label>Full name<input value={name} onChange={event => setName(event.target.value)} required /></label></>}
    {mode === "reset" && <label>Reset code<input value={code} onChange={event => setCode(event.target.value)} placeholder="RS-XXXXXXXXXX" required /></label>}
    <label>Email<input type="email" value={email} onChange={event => setEmail(event.target.value)} required /></label>
    <label>{mode === "signin" ? "Password" : "New password"}<input type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={mode === "signin" ? undefined : 8} required /></label>
    <button className="primary">{mode === "invite" ? "Accept invitation" : mode === "reset" ? "Set new password" : "Sign in"}</button>
    {mode === "signin" ? <>
      <button type="button" className="loginSwitch" onClick={() => switchTo("invite")}>Have an invitation code?</button>
      <button type="button" className="loginSwitch" onClick={() => switchTo("reset")}>Forgot password?</button>
    </> : <button type="button" className="loginSwitch" onClick={() => switchTo("signin")}>Back to sign in</button>}
    <p className="loginNew">New to MechanicPro? <button type="button" className="loginSwitch" onClick={() => go("/signup")}>Start a free trial</button></p>
    <button type="button" className="loginSwitch loginHome" onClick={() => go("/")}>← Back to the homepage</button>
  </form></main>;
}
