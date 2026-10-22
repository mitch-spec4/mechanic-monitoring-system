import {useState} from "react";
import {acceptInvitation, login, saveSession} from "../services/api";

type Props = {done: (user: any) => void};

export default function Login({done}: Props) {
  const [inviteMode, setInviteMode] = useState(false), [email, setEmail] = useState(""), [password, setPassword] = useState(""), [name, setName] = useState(""), [code, setCode] = useState(""), [error, setError] = useState(""), [message, setMessage] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(""); setMessage("");
    try {
      const data = inviteMode ? await acceptInvitation({code, name, email, password}) : await login(email, password);
      if (inviteMode) { setMessage("Invitation accepted. You can now sign in."); setInviteMode(false); setCode(""); setPassword(""); return; }
      saveSession(data); done(data.user);
    } catch (value: any) { setError(value.message); }
  };
  return <main className="login"><form onSubmit={submit}><div className="brand">🔧 <span>MECHANIC</span>PRO</div><h1>{inviteMode ? "Join your company" : "Welcome back"}</h1><p>{inviteMode ? "Use the invitation code from your company." : "Service operations, without the paperwork."}</p>{error && <div className="error">{error}</div>}{message && <div className="success">{message}</div>}{inviteMode && <><label>Invitation code<input value={code} onChange={event => setCode(event.target.value)} placeholder="DK-XXXXXXXXXX" required /></label><label>Full name<input value={name} onChange={event => setName(event.target.value)} required /></label></>}<label>Email<input type="email" value={email} onChange={event => setEmail(event.target.value)} required /></label><label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} required /></label><button className="primary">{inviteMode ? "Accept invitation" : "Sign in"}</button><button type="button" className="loginSwitch" onClick={() => {setInviteMode(value => !value); setError(""); setMessage("");}}>{inviteMode ? "Back to sign in" : "Have an invitation code?"}</button></form></main>;
}
