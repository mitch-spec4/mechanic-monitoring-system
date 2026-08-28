import {useEffect, useRef, useState} from "react";
import {LogOut, UserRound} from "lucide-react";

type ProfileProps = {user: any; onLogout: () => void};

export default function Profile({user, onLogout}: ProfileProps) {
  const [open, setOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return <>
    <style>{`.profile{position:fixed;top:14px;right:28px;z-index:40;font-family:inherit}.profileTrigger{display:flex;align-items:center;gap:9px;border:1px solid #dce5ef;background:#fff;border-radius:12px;padding:5px 9px 5px 6px;color:#172033;box-shadow:0 4px 14px #1720330d}.profileTrigger:hover{border-color:#9fc5eb;background:#fafdff}.profileAvatar{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:#e6f2ff;color:#1264b9;font-weight:800}.profileIdentity{display:grid;text-align:left;line-height:1.15}.profileIdentity strong{font-size:12px}.profileIdentity small{color:#718096;font-size:10px;text-transform:capitalize;margin-top:3px}.profileChevron{color:#718096;font-size:15px;margin-left:2px}.profileMenu{position:absolute;right:0;top:48px;width:245px;background:#fff;border:1px solid #dce5ef;border-radius:13px;padding:9px;box-shadow:0 18px 45px #17203326;animation:profile-in .16s ease-out}.profileMenuHeading{display:flex;align-items:center;gap:10px;padding:9px 8px 12px;border-bottom:1px solid #edf1f5}.profileMenuHeading>div{display:grid;min-width:0}.profileMenuHeading strong{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.profileMenuHeading small{font-size:10px;color:#718096;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:3px}.profileMenuIcon{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;background:#f0f6fc;color:#1264b9}.profileLogout{display:flex;align-items:center;gap:9px;width:100%;margin-top:7px;padding:10px 8px;border:0;border-radius:8px;background:transparent;color:#ba3434;font-size:12px;font-weight:700;text-align:left}.profileLogout:hover{background:#fff1f1}@keyframes profile-in{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:translateY(0)}}@media(max-width:560px){.profile{right:12px}.profileIdentity{display:none}.profileTrigger{padding-right:7px}.profileMenu{width:220px}}`}</style>
    <div className="profile" id="profile-menu" ref={profileRef} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
    <button className="profileTrigger" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-label="Open profile menu">
      <span className="profileAvatar">{user.name[0].toUpperCase()}</span>
      <span className="profileIdentity"><strong>{user.name}</strong><small>{user.role}</small></span>
      <span className="profileChevron">{open ? "⌃" : "⌄"}</span>
    </button>
    {open && <div className="profileMenu">
      <div className="profileMenuHeading"><span className="profileMenuIcon"><UserRound size={16}/></span><div><strong>{user.name}</strong><small>{user.email}</small></div></div>
      <button className="profileLogout" onClick={onLogout}><LogOut size={16}/> Log out</button>
    </div>}
  </div></>;
}
