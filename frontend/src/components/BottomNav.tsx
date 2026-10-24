import { useState } from "react";
import { Bell, CalendarClock, ClipboardList, Clock, Cog, FileText, HelpCircle, LayoutGrid, Star, type LucideIcon } from "lucide-react";
import Modal from "./Modal";
import { mark, t } from "../i18n";

type Props = { active: string; onNavigate: (page: string) => void };
type Item = [page: string, label: string, icon: LucideIcon];

// The page names are the sidebar's (in English); the labels are shorter, to fit five across a phone.
const MAIN: Item[] = [
  ["Dashboard", mark("Today"), CalendarClock],
  ["My Jobs", mark("Jobs"), ClipboardList],
  ["My Shifts", mark("Shifts"), Clock],
  ["Notifications", mark("Alerts"), Bell],
];
const MORE: Item[] = [
  ["Assigned Jobs", mark("Assigned Jobs"), ClipboardList],
  ["Service Records", mark("Service Records"), FileText],
  ["Reviews", mark("Reviews"), Star],
  ["Settings", mark("Settings"), Cog],
  ["Help & Support", mark("Help & Support"), HelpCircle],
];

/** A technician's phone: the main pages along the bottom, in reach of a thumb, instead of the side
 *  strip. Everything else is under More. Computers keep the sidebar. */
export default function BottomNav({ active, onNavigate }: Props) {
  const [more, setMore] = useState(false);
  const inMore = MORE.some(([page]) => page === active);
  const go = (page: string) => {
    setMore(false);
    onNavigate(page);
    window.scrollTo({ top: 0 });
  };
  return (
    <>
      <nav className="bottomNav" aria-label={t("Main")}>
        {MAIN.map(([page, label, Icon]) => (
          <button
            key={page}
            type="button"
            data-page={page}
            className={active === page ? "active" : ""}
            aria-current={active === page ? "page" : undefined}
            onClick={() => go(page)}
          >
            <Icon size={21} aria-hidden="true" />
            <span>{t(label)}</span>
          </button>
        ))}
        <button
          type="button"
          data-page="more"
          className={inMore ? "active" : ""}
          aria-haspopup="dialog"
          aria-expanded={more}
          onClick={() => setMore(true)}
        >
          <LayoutGrid size={21} aria-hidden="true" />
          <span>{t("More")}</span>
        </button>
      </nav>
      {more && (
        <Modal title={t("More")} onClose={() => setMore(false)}>
          <div className="moreLinks">
            {MORE.map(([page, label, Icon]) => (
              <button
                key={page}
                type="button"
                data-page={page}
                className={active === page ? "active" : ""}
                aria-current={active === page ? "page" : undefined}
                onClick={() => go(page)}
              >
                <Icon size={18} aria-hidden="true" />
                {t(label)}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
