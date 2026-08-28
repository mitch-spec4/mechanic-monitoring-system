import {useEffect, useState} from "react";
import {BarChart3, CalendarDays, CheckCircle2, ClipboardList, Cog, FileText, HelpCircle, MessageSquare, Package, Star, UserRound, Users, Wrench} from "lucide-react";
import {customers, jobs, machines, reviews, services} from "../services/api";

type Props = {title: string; user: any};
const details: Record<string, {description: string; icon: any}> = {
  "My Jobs": {description: "Review and manage work assigned to you.", icon: ClipboardList},
  Customers: {description: "Your customers and their service relationships.", icon: Users},
  Machines: {description: "Machines currently tracked by your service team.", icon: Wrench},
  "Service Records": {description: "A complete history of work performed.", icon: FileText},
  Reviews: {description: "Customer feedback from recent service visits.", icon: Star},
  Parts: {description: "Parts and consumables used by the workshop.", icon: Package},
  Schedule: {description: "Upcoming visits and planned service work.", icon: CalendarDays},
  Reports: {description: "A quick view of your service performance.", icon: BarChart3},
  Messages: {description: "Keep up with customers and your service team.", icon: MessageSquare},
  Settings: {description: "Manage your workspace preferences.", icon: Cog},
  "Help & Support": {description: "Find help for your service workspace.", icon: HelpCircle},
  Profile: {description: "Your account details and access.", icon: UserRound}
};

export default function NavigationPage({title, user}: Props) {
  const [items, setItems] = useState<any[]>([]);
  const detail = details[title] || details.Dashboard;
  const Icon = detail.icon;
  useEffect(() => {
    const load = title === "My Jobs" ? jobs : title === "Customers" ? customers : title === "Machines" ? machines : title === "Service Records" ? services : title === "Reviews" ? reviews : null;
    if (load) load().then(data => setItems(data.jobs || data.customers || data.machines || data.records || data.reviews || [])).catch(() => {});
  }, [title]);
  const demoItems = title === "My Jobs" ? [{heading: "Service Generator G-102", detail: "ABC Engineering · In Progress"}, {heading: "Inspect Air Compressor C-44", detail: "Kenya Motors · Pending"}] : title === "Customers" ? [{heading: "ABC Engineering", detail: "1 machine · Nairobi"}, {heading: "Kenya Motors", detail: "3 machines · Nairobi"}] : title === "Machines" ? [{heading: "Generator G-102", detail: "CAT XQ200 · Operational"}, {heading: "Hydraulic Pump H-21", detail: "XYZ Factory · Due soon"}] : [{heading: `${title} overview`, detail: "Your demo workspace is ready to use."}];
  return <main className="subPage"><div className="subPageHeading"><div><span className="eyebrow">MECHANIC PRO</span><h1>{title}</h1><p>{detail.description}</p></div><span className="subPageUser">{user.name} · {user.role}</span></div><div className="subPageStats"><div><Icon size={20}/><strong>{items.length || demoItems.length}</strong><span>{title === "My Jobs" ? "Open items" : "Available items"}</span></div><div><CheckCircle2 size={20}/><strong>Active</strong><span>Demo workspace</span></div></div><section className="subPagePanel"><div className="subPagePanelHead"><h2><Icon size={16}/>{title}</h2><button className="primary">+ Add New</button></div><div className="subPageList">{(items.length ? items : demoItems).map((item: any, index: number) => <article key={item.id || index}><span className="listIcon"><Icon size={16}/></span><div><strong>{item.heading || item.name || item.title || item.service_type || "Service item"}</strong><small>{item.detail || item.email || item.work_done || item.description || "Ready for your next action"}</small></div><button className="listAction">View details</button></article>)}</div></section></main>;
}
