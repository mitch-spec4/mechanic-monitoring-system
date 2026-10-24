import { useState } from "react";
import { reports, type User } from "../services/api";
import type { Report, Role } from "../services/types";
import { usePolling } from "../lib/usePolling";
import { mark, t } from "../i18n";
import {
  BarChart3,
  Bell,
  CalendarClock,
  ClipboardList,
  Clock,
  Cog,
  CreditCard,
  FileText,
  Gauge,
  HelpCircle,
  History,
  ListChecks,
  Map as MapIcon,
  MessageSquare,
  Star,
  UserRound,
  Users,
  Wrench,
} from "lucide-react";

function BellIcon() {
  return <Bell size={16} />;
}

// Each page's English name is also its address in the app; the sidebar shows it translated.
const commonLinks = [
  [Gauge, mark("Dashboard")],
  [UserRound, mark("Profile")],
] as const;
const roleLinks = {
  boss: [
    [ClipboardList, mark("Jobs / Requests")],
    [CalendarClock, mark("Service Requests")],
    [Users, mark("Customers")],
    [Wrench, mark("Equipment")],
    [ListChecks, mark("Checklists")],
    [UserRound, mark("Technicians")],
    [MapIcon, mark("Team Map")],
    [Clock, mark("Shifts")],
    [BarChart3, mark("Reports")],
    [CreditCard, mark("Billing")],
    [BellIcon, mark("Notifications")],
    [History, mark("Activity")],
  ],
  mechanic: [
    [ClipboardList, mark("Assigned Jobs")],
    [ClipboardList, mark("My Jobs")],
    [Clock, mark("My Shifts")],
    [FileText, mark("Service Records")],
    [Star, mark("Reviews")],
    [BellIcon, mark("Notifications")],
  ],
  customer: [
    [Wrench, mark("My Equipment")],
    [ClipboardList, mark("Service Requests")],
    [FileText, mark("Service History")],
    [Star, mark("Reviews")],
    [BellIcon, mark("Notifications")],
    [Users, mark("My Company")],
  ],
} as const;
const utilityLinks = [
  [MessageSquare, mark("Messages")],
  [Cog, mark("Settings")],
  [HelpCircle, mark("Help & Support")],
] as const;
export const ROLE_NAMES: Record<Role, string> = { boss: mark("Boss"), mechanic: mark("Technician"), customer: mark("Customer") };

function sidebarRows(role: Role, stats: Report): [string, number][] {
  const { totals } = stats;
  if (role === "customer") {
    return [
      [t("Services completed"), stats.jobs.completed],
      [t("Equipment"), totals.machines ?? 0],
      [t("Open requests"), totals.open_requests ?? 0],
    ];
  }
  if (role === "mechanic") {
    return [
      [t("Jobs completed"), stats.jobs.completed],
      [t("Customers served"), totals.customers ?? 0],
      [t("Equipment serviced"), totals.machines ?? 0],
    ];
  }
  return [
    [t("Jobs completed"), stats.jobs.completed],
    [t("Customers"), totals.customers ?? 0],
    [t("Equipment"), totals.machines ?? 0],
  ];
}

type SidebarProps = { user: User; active: string; onNavigate: (label: string) => void };

export default function Sidebar({ user, active, onNavigate }: SidebarProps) {
  const [stats, setStats] = useState<Report | null>(null);
  usePolling(() => reports().then(setStats).catch(() => {}), 60000, true);
  // The chat is between customers and managers.
  const visibleLinks = [...commonLinks, ...roleLinks[user.role], ...utilityLinks.filter(([, label]) => user.role !== "mechanic" || label !== "Messages")];
  const select = (label: string) => {
    if (label === "Profile") document.querySelector<HTMLButtonElement>(".profileTrigger")?.click();
    else onNavigate(label);
  };
  return (
    <aside className="sidebar">
      <div className="sidebarBrand">
        <span className="brandMark">
          <Wrench size={17} />
        </span>
        <strong>
          MECHANIC <em>PRO</em>
        </strong>
      </div>
      <nav className="sidebarNav" aria-label={t("Main")}>
        {visibleLinks.map(([Icon, label]) => (
          <button
            className={`sidebarLink ${active === label ? "active" : ""}`}
            key={label}
            data-page={label}
            onClick={() => select(label)}
            aria-current={active === label ? "page" : undefined}
            title={t(label)}
          >
            <Icon size={16} />
            <span>{t(label)}</span>
          </button>
        ))}
      </nav>
      <div className="sidebarUser">
        <span className="sidebarAvatar">{user.name[0].toUpperCase()}</span>
        <div>
          <strong>{user.name}</strong>
          <small>{t(ROLE_NAMES[user.role])}</small>
        </div>
        {stats?.rating != null && <span className="sidebarRating">★ {stats.rating.toFixed(1)}</span>}
        {stats && (
          <div className="sidebarStats">
            {sidebarRows(user.role, stats).map(([label, value]) => (
              <span key={label}>
                {label} <b>{value}</b>
              </span>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
