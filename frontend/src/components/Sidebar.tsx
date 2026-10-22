import {useState} from "react";
import {reports} from "../services/api";
import {usePolling} from "../lib/usePolling";
import {BarChart3, Bell, CalendarDays, ClipboardList, Cog, FileText, Gauge, HelpCircle, MessageSquare, Package, Star, UserRound, Users, Wrench} from "lucide-react";

const commonLinks = [
  [Gauge, "Dashboard"],
  [UserRound, "Profile"]
] as const;
const roleLinks = {
  boss: [[ClipboardList, "Jobs / Requests"], [Users, "Customers"], [Wrench, "Machines"], [UserRound, "Mechanics"], [BarChart3, "Reports"], [BellIcon, "Notifications"]],
  mechanic: [[ClipboardList, "Assigned Jobs"], [ClipboardList, "My Jobs"], [FileText, "Service Records"], [Star, "Reviews"], [BellIcon, "Notifications"]],
  customer: [[Wrench, "My Machines"], [ClipboardList, "Service Requests"], [FileText, "Service History"], [Star, "Reviews"], [BellIcon, "Notifications"], [Users, "My Company"]]
} as const;
const utilityLinks = [[MessageSquare, "Messages"], [Cog, "Settings"], [HelpCircle, "Help & Support"]] as const;
function BellIcon() { return <Bell size={16}/>; }
function sidebarRows(role: string, stats: any): [string, number][] {
  const totals = stats.totals || {};
  if (role === "customer") return [["Services completed", stats.jobs.completed], ["Machines", totals.machines ?? 0], ["Open requests", totals.open_requests ?? 0]];
  if (role === "mechanic") return [["Jobs completed", stats.jobs.completed], ["Customers served", totals.customers ?? 0], ["Machines serviced", totals.machines ?? 0]];
  return [["Jobs completed", stats.jobs.completed], ["Customers", totals.customers ?? 0], ["Machines", totals.machines ?? 0]];
}
type SidebarProps = {user: any; active: string; onNavigate: (label: string) => void};

export default function Sidebar({user, active, onNavigate}: SidebarProps) {
  const [stats, setStats] = useState<any>(null);
  usePolling(() => reports().then(setStats).catch(() => {}), 60000, true);
  const visibleLinks = [...commonLinks, ...(roleLinks[user.role as keyof typeof roleLinks] || roleLinks.customer), ...utilityLinks];
  const select = (label: string) => { if (label === "Profile") document.querySelector<HTMLButtonElement>(".profileTrigger")?.click(); else onNavigate(label); };
  return <aside className="sidebar">
    <div className="sidebarBrand"><span className="brandMark"><Wrench size={17}/></span><strong>MECHANIC <em>PRO</em></strong></div>
    <nav className="sidebarNav">{visibleLinks.map(([Icon, label]) => <button className={`sidebarLink ${active === label ? "active" : ""}`} key={label} onClick={() => select(label)}><Icon size={16}/><span>{label}</span></button>)}</nav>
    <div className="sidebarUser"><span className="sidebarAvatar">{user.name[0].toUpperCase()}</span><div><strong>{user.name}</strong><small>{user.role}</small></div>{stats?.rating != null && <span className="sidebarRating">★ {stats.rating.toFixed(1)}</span>}{stats && <div className="sidebarStats">{sidebarRows(user.role, stats).map(([label, value]) => <span key={label}>{label} <b>{value}</b></span>)}</div>}</div>
  </aside>;
}
