import { useEffect, useRef, useState } from "react";
import { LogOut, UserRound } from "lucide-react";
import { ROLE_NAMES } from "./Sidebar";
import { t } from "../i18n";
import "./Profile.css";

type ProfileProps = { user: any; onLogout: () => void };

export default function Profile({ user, onLogout }: ProfileProps) {
  const [open, setOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  return (
    <div className="profile" id="profile-menu" ref={profileRef} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button className="profileTrigger" onClick={() => setOpen(true)} aria-expanded={open} aria-label={t("Open profile menu")}>
        <span className="profileAvatar">{user.name[0].toUpperCase()}</span>
        <span className="profileIdentity">
          <strong>{user.name}</strong>
          <small>{t(ROLE_NAMES[user.role] ?? user.role)}</small>
        </span>
        <span className="profileChevron" aria-hidden="true">
          {open ? "⌃" : "⌄"}
        </span>
      </button>
      {open && (
        <div className="profileMenu">
          <div className="profileMenuHeading">
            <span className="profileMenuIcon">
              <UserRound size={16} />
            </span>
            <div>
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </div>
          </div>
          <button className="profileLogout" onClick={onLogout}>
            <LogOut size={16} /> {t("Log out")}
          </button>
        </div>
      )}
    </div>
  );
}
