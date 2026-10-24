import { useEffect, useRef, useState } from "react";
import { LogOut, UserRound } from "lucide-react";
import { ROLE_NAMES } from "./Sidebar";
import type { User } from "../services/api";
import { t } from "../i18n";
import "./Profile.css";

type ProfileProps = { user: User; onLogout: () => void };

export default function Profile({ user, onLogout }: ProfileProps) {
  const [open, setOpen] = useState(false);
  // Opened by a click or tap: it stays open until a click outside or Escape, not just until the
  // pointer moves away (which browsers can also report when the page changes under it).
  const pinned = useRef(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const shut = () => {
    pinned.current = false;
    setOpen(false);
  };

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) shut();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") shut();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  return (
    <div className="profile" id="profile-menu" ref={profileRef} onMouseEnter={() => setOpen(true)} onMouseLeave={() => pinned.current || setOpen(false)}>
      <button
        className="profileTrigger"
        onClick={() => {
          pinned.current = true;
          setOpen(true);
        }}
        aria-expanded={open}
        aria-label={t("Open profile menu")}
      >
        <span className="profileAvatar">{user.name[0].toUpperCase()}</span>
        <span className="profileIdentity">
          <strong>{user.name}</strong>
          <small>{t(ROLE_NAMES[user.role])}</small>
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
