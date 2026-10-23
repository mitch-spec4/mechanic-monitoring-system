import { useState } from "react";
import { Bell, Check } from "lucide-react";
import { markAllNotificationsRead, markNotificationRead, notifications } from "../services/api";
import { usePolling } from "../lib/usePolling";
import { formatDateTime } from "../lib/format";
import { t } from "../i18n";

type Notice = { id: number; title: string; message: string; is_read: boolean; created_at: string };

export default function Notifications() {
  const [items, setItems] = useState<Notice[]>([]);
  const [open, setOpen] = useState(false);
  const load = () =>
    notifications()
      .then((data) => setItems(data.notifications))
      .catch(() => {});
  usePolling(load, 30000, true);
  const unread = items.filter((item) => !item.is_read).length;
  const markAll = async () => {
    await markAllNotificationsRead().catch(() => {});
    load();
  };
  const markRead = async (id: number) => {
    await markNotificationRead(id).catch(() => {});
    load();
  };
  return (
    <div className="notif">
      <button
        className="iconBtn"
        aria-label={t("Notifications")}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open) load();
        }}
      >
        <Bell size={20} />
        {unread > 0 && <b>{unread}</b>}
      </button>
      {open && (
        <div className="dropdown">
          <div className="dropTitle">
            {t("Notifications")}
            {unread > 0 && (
              <button className="markAll" onClick={markAll}>
                {t("Mark all read")}
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="muted">{t("You're all caught up.")}</p>
          ) : (
            items.map((item) => (
              <div className={item.is_read ? "note read" : "note"} key={item.id}>
                <strong>{item.title}</strong>
                <span>{item.message}</span>
                <small>{formatDateTime(item.created_at)}</small>
                {!item.is_read && (
                  <button aria-label={t("Mark as read")} onClick={() => markRead(item.id)}>
                    <Check size={14} />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
