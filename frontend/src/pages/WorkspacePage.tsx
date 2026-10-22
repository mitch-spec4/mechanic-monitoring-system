import { useEffect, useState } from "react";
import {
  BarChart3,
  Bell,
  CheckCircle2,
  ClipboardList,
  Clock,
  Cog,
  FileText,
  HelpCircle,
  ListChecks,
  Map as MapIcon,
  MessageSquare,
  Plus,
  Search,
  Star,
  UserRound,
  Users,
  Wrench,
} from "lucide-react";
import {
  changePassword,
  company,
  customers,
  jobs,
  machines,
  mechanics,
  notifications,
  reports,
  requests,
  reviews,
  services,
  updateCustomer,
} from "../services/api";
import ChecklistManager from "../components/ChecklistManager";
import MachinesByCustomer from "../components/MachinesByCustomer";
import { machineSummary } from "./BossDashboard";
import "./CustomerPage.css";
import { AddMachine, EditForm, EditMachine } from "../components/MachineForms";
import ShiftsView from "../components/ShiftsView";
import TeamMap from "../components/TeamMap";
import { LocationSettings } from "../components/Shift";
import InviteForm from "../components/InviteForm";
import ResetPassword from "../components/ResetPassword";
import { errorMessage, formatDate } from "../lib/format";

type Props = { title: string; user: any; onOpenJob?: (id: number) => void; onOpenCustomer?: (id: number) => void };
type Resource = {
  label: string;
  icon: any;
  load?: () => Promise<any>;
  key?: string;
  filter?: (item: any) => boolean;
};
const isActiveJob = (job: any) => !["Completed", "Cancelled"].includes(job.status);
const resources: Record<string, Resource> = {
  "Jobs / Requests": {
    label: "Jobs / requests",
    icon: ClipboardList,
    load: jobs,
    key: "jobs",
  },
  "My Jobs": { label: "Jobs", icon: ClipboardList, load: jobs, key: "jobs" },
  "Assigned Jobs": {
    label: "Assigned jobs",
    icon: ClipboardList,
    load: jobs,
    key: "jobs",
    filter: isActiveJob,
  },
  Customers: {
    label: "Customers",
    icon: Users,
    load: customers,
    key: "customers",
  },
  Mechanics: { label: "Mechanics", icon: Users, load: mechanics, key: "mechanics" },
  Machines: {
    label: "Machines",
    icon: Wrench,
    load: machines,
    key: "machines",
  },
  "Service Records": {
    label: "Service records",
    icon: FileText,
    load: services,
    key: "records",
  },
  "Service History": {
    label: "Service history",
    icon: FileText,
    load: services,
    key: "records",
  },
  Reviews: { label: "Reviews", icon: Star, load: reviews, key: "reviews" },
  Notifications: { label: "Notifications", icon: Bell, load: notifications, key: "notifications" },
  "My Machines": {
    label: "My machines",
    icon: Wrench,
    load: machines,
    key: "machines",
  },
  "Service Requests": { label: "Service requests", icon: ClipboardList, load: requests, key: "requests" },
  "My Company": { label: "My company", icon: Users, load: company, key: "company" },
  Reports: { label: "Reports", icon: BarChart3, load: reports, key: "report" },
  Messages: { label: "Messages", icon: MessageSquare },
  Settings: { label: "Settings", icon: Cog },
  Profile: { label: "Profile", icon: UserRound },
  "Help & Support": { label: "Help & support", icon: HelpCircle },
  Checklists: { label: "Checklists", icon: ListChecks },
  "Team Map": { label: "Clocked-in mechanics", icon: MapIcon },
  Shifts: { label: "Shifts", icon: Clock },
  "My Shifts": { label: "My shifts", icon: Clock },
};

export default function WorkspacePage({ title, user, onOpenJob, onOpenCustomer }: Props) {
  const resource = resources[title] || resources.Profile;
  const Icon = resource.icon;
  const [items, setItems] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [query, setQuery] = useState("");
  const [companyInfo, setCompanyInfo] = useState<any>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [resetting, setResetting] = useState<{ id: number; name: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // The Machines page groups machines under their customer.
  const [customerList, setCustomerList] = useState<any[]>([]);

  useEffect(() => {
    setItems([]);
    setSummary(null);
    setCompanyInfo(null);
    setError("");
    setAdding(false);
    setQuery("");
    if (!resource.load) return;
    resource
      .load()
      .then((data) => {
        if (resource.key === "report") setSummary(data);
        else if (resource.key === "company") setCompanyInfo(data.company);
        else {
          const rows = data[resource.key!] || [];
          setItems(resource.filter ? rows.filter(resource.filter) : rows);
        }
      })
      .catch((errorValue) => setError(errorValue.message));
    if (title === "Machines" && user.role === "boss") {
      customers()
        .then((data) => setCustomerList(data.customers))
        .catch((errorValue) => setError(errorValue.message));
    }
  }, [title, reloadKey]);

  const filtered = items.filter((item) =>
    JSON.stringify(item).toLowerCase().includes(query.toLowerCase()),
  );
  const canAdd =
    user.role === "boss" && ["Customers", "Machines", "Mechanics"].includes(title);
  const added = () => {
    setAdding(false);
    setEditing(null);
    setReloadKey((key) => key + 1);
  };
  const isBoss = user.role === "boss";
  const rowActions = (item: any) => {
    if (!isBoss) return null;
    const resetId = title === "Mechanics" ? item.id : title === "Customers" ? item.user_id : null;
    return (
      <>
        {(title === "Machines" || title === "Customers") && (
          <button className="listAction" onClick={() => setEditing(item)}>
            Edit
          </button>
        )}
        {resetId && (
          <button className="listAction" onClick={() => setResetting({ id: resetId, name: item.name })}>
            Reset password
          </button>
        )}
      </>
    );
  };
  return (
    <main className="subPage">
      <div className="subPageHeading">
        <div>
          <span className="eyebrow">
            MECHANIC PRO / {user.role.toUpperCase()}
          </span>
          <h1>{title}</h1>
          <p>{description(title)}</p>
        </div>
        <span className="subPageUser">
          {user.name} · {user.email}
        </span>
      </div>
      {summary ? (
        <ReportSummary summary={summary} />
      ) : !resource.load || resource.key === "company" ? null : (
        <div className="subPageStats">
          <div>
            <Icon size={20} />
            <strong>{items.length}</strong>
            <span>{resource.label}</span>
          </div>
          <div>
            <CheckCircle2 size={20} />
            <strong>{items.length ? "Connected" : "Ready"}</strong>
            <span>{error || "Live workspace data"}</span>
          </div>
        </div>
      )}
      <section className="subPagePanel">
        <div className="subPagePanelHead">
          <h2>
            <Icon size={16} />
            {resource.label}
          </h2>
          <div className="subPageTools">
            {items.length > 0 && (
              <label className="searchBox">
                <Search size={14} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search"
                />
              </label>
            )}
            {canAdd && (
              <button className="primary" onClick={() => setAdding(true)}>
                <Plus size={14} /> Add {resource.label.slice(0, -1)}
              </button>
            )}
          </div>
        </div>
        {error ? (
          <Empty title="Unable to load data" text={error} />
        ) : title === "My Company" ? (
          companyInfo ? <CompanyView company={companyInfo} /> : <Empty title="Loading" text="Fetching your company details." />
        ) : title === "Help & Support" ? (
          <Empty
            title="Need help?"
            text="Contact your company manager for access, invitations, or questions about a job. Use the sidebar to move between your jobs, records, and notifications."
          />
        ) : title === "Checklists" ? (
          <ChecklistManager />
        ) : title === "Team Map" ? (
          <TeamMap onOpenJob={onOpenJob} />
        ) : title === "Shifts" || title === "My Shifts" ? (
          <ShiftsView user={user} />
        ) : title === "Messages" ? (
          <Empty
            title="Messaging is not connected"
            text="Conversation storage and permissions will appear here when the messaging service is enabled."
          />
        ) : title === "Settings" || title === "Profile" ? (
          <>
            <Settings user={user} />
            {user.role === "mechanic" && <LocationSettings />}
            <ChangePassword />
          </>
        ) : title === "Machines" && isBoss && items.length ? (
          <MachinesByCustomer
            machines={items}
            customers={customerList}
            query={query}
            onOpenJob={onOpenJob}
            onOpenCustomer={onOpenCustomer}
            onChanged={added}
          />
        ) : filtered.length ? (
          <div className="subPageList">
            {(title === "Customers" ? sortByNeedsWork(filtered) : filtered).map((item, index) => (
              <ResourceRow
                key={item.id || index}
                item={item}
                title={title}
                Icon={Icon}
                actions={rowActions(item)}
                onOpenJob={onOpenJob}
                onOpenCustomer={onOpenCustomer}
              />
            ))}
          </div>
        ) : (
          <Empty
            title={`No ${resource.label.toLowerCase()} yet`}
            text="New records will appear here as your team uses the workspace."
          />
        )}
      </section>
      {adding && title === "Machines" && <AddMachine onClose={() => setAdding(false)} onAdded={added} />}
      {adding && (title === "Customers" || title === "Mechanics") && (
        <InviteForm role={title === "Customers" ? "customer" : "mechanic"} onClose={() => setAdding(false)} onDone={added} />
      )}
      {editing && title === "Machines" && <EditMachine machine={editing} onClose={() => setEditing(null)} onSaved={added} />}
      {editing && title === "Customers" && <EditCustomer customer={editing} onClose={() => setEditing(null)} onSaved={added} />}
      {resetting && <ResetPassword userId={resetting.id} name={resetting.name} onClose={() => setResetting(null)} />}
    </main>
  );
}

function EditCustomer({ customer, onClose, onSaved }: any) {
  return (
    <EditForm title="Edit customer" onClose={onClose} save={async (data: any) => { await updateCustomer(customer.id, data); onSaved(); }}>
      <div className="formGroup">
        <label htmlFor="field-name">Company/Organization Name</label>
        <input id="field-name" name="name" defaultValue={customer.name} required />
      </div>
      <div className="formGroup">
        <label htmlFor="field-email">Contact email</label>
        <input id="field-email" name="email" type="email" defaultValue={customer.email} required />
      </div>
      <div className="formGroup">
        <label htmlFor="field-phone">Phone</label>
        <input id="field-phone" name="phone" defaultValue={customer.phone || ""} />
      </div>
    </EditForm>
  );
}

function ChangePassword() {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const submit = async (event: any) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    setError("");
    setMessage("");
    if (data.new_password !== data.confirm_password) {
      setError("The new passwords do not match");
      return;
    }
    try {
      await changePassword({ current_password: data.current_password, new_password: data.new_password });
      form.reset();
      setMessage("Password changed. You've been signed out on your other devices.");
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <form className="form form-upgraded changePassword" onSubmit={submit}>
      <h3>Change password</h3>
      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}
      <div className="formGroup">
        <label htmlFor="field-current_password">Current password</label>
        <input id="field-current_password" name="current_password" type="password" autoComplete="current-password" required />
      </div>
      <div className="formGroup">
        <label htmlFor="field-new_password">New password</label>
        <input id="field-new_password" name="new_password" type="password" autoComplete="new-password" minLength={8} required />
      </div>
      <div className="formGroup">
        <label htmlFor="field-confirm_password">Confirm new password</label>
        <input id="field-confirm_password" name="confirm_password" type="password" autoComplete="new-password" minLength={8} required />
      </div>
      <button className="primary">Update password</button>
    </form>
  );
}

function CompanyView({ company }: any) {
  return (
    <div className="settingsView">
      <div>
        <span>Company</span>
        <strong>{company.name}</strong>
      </div>
      <div>
        <span>Location</span>
        <strong>{company.location || "Not recorded"}</strong>
      </div>
      {company.contacts.map((contact: any) => (
        <div key={contact.email}>
          <span>Manager</span>
          <strong>
            {contact.name} · {contact.email}
          </strong>
        </div>
      ))}
    </div>
  );
}

function description(title: string) {
  return (
    (
      {
        "My Jobs": "Assigned work, status, priority, and scheduled visits.",
        Customers: "Customers connected to your service company.",
        Machines: "Tracked equipment and current operating status.",
        "Service Records": "A searchable history of completed service work.",
        Reviews: "Ratings and feedback visible according to your role.",
        Reports: "Operational performance for the data you are allowed to see.",
        Mechanics: "The mechanics on your service team.",
        Checklists: "Checklists your mechanics complete for each type of job.",
        "Team Map": "Where your clocked-in mechanics were last seen.",
        Shifts: "Clock-in and clock-out times and hours for your team.",
        "My Shifts": "Your clock-in and clock-out times and hours.",
        Notifications: "Updates about your jobs, requests, and reviews.",
        "Service Requests": "Service you have requested and its current status.",
        "Service History": "Every service visit recorded on your machines.",
        "My Machines": "Machines registered to your account.",
        "My Company": "The service company that looks after your machines.",
        "Assigned Jobs": "Jobs assigned to you that are not finished yet.",
        Messages: "Company conversations and job communication.",
        Settings: "Workspace preferences and account controls.",
        Profile: "Your account details and access.",
        "Help & Support": "Support resources for your service workspace.",
      } as Record<string, string>
    )[title] || "Service operations workspace."
  );
}
const sortByNeedsWork = (rows: any[]) => [...rows].sort((a, b) => Number(b.needs_work_count > 0) - Number(a.needs_work_count > 0));

function ResourceRow({ item, title, Icon, actions, onOpenJob, onOpenCustomer }: any) {
  const isJob = ["My Jobs", "Assigned Jobs", "Jobs / Requests"].includes(title);
  const isCustomer = title === "Customers" && onOpenCustomer;
  // Jobs, and service records that belong to a job, open the job's worksheet.
  const jobId = isJob ? item.id : item.job_id;
  const heading =
    item.title ||
    item.name ||
    item.service_type ||
    item.subject ||
    `${title} item`;
  const detail = isJob
    ? [item.priority || "Medium", item.location || "No location", item.due_date ? `Due ${formatDate(item.due_date)}` : ""]
        .filter(Boolean)
        .join(" · ")
    : item.email ||
      item.message ||
      item.work_done ||
      item.description ||
      item.comment ||
      item.model ||
      "No additional details";
  return (
    <article>
      <span className="listIcon">
        <Icon size={16} />
      </span>
      <div>
        {jobId && onOpenJob ? (
          <button className="titleLink" onClick={() => onOpenJob(jobId)}>
            <strong>{heading}</strong>
          </button>
        ) : isCustomer ? (
          <button className="titleLink" onClick={() => onOpenCustomer(item.id)}>
            <strong>{heading}</strong>
          </button>
        ) : (
          <strong>{heading}</strong>
        )}
        <small>
          {detail}
          {isCustomer && (
            <>
              {" · "}
              <span className={item.needs_work_count ? "needsWorkText" : ""}>{machineSummary(item)}</span>
            </>
          )}
        </small>
      </div>
      <span
        className={`dataStatus ${String(item.status || "Active")
          .replace(/ /g, "")
          .toLowerCase()}`}
      >
        {item.status ||
          (title === "Reviews" ? `${item.rating}/5` : title === "Notifications" ? (item.is_read ? "Read" : "New") : "Active")}
      </span>
      {actions}
    </article>
  );
}
/** "0 B", "350 KB", "1.2 GB": photo and video storage used. */
function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
function ReportSummary({ summary }: any) {
  const jobSummary = summary.jobs || {};
  const chartItems = [
    ["Pending", jobSummary.pending || 0, "pending"],
    ["In progress", jobSummary.in_progress || 0, "progress"],
    ["Completed", jobSummary.completed || 0, "completed"],
    ["Cancelled", jobSummary.cancelled || 0, "cancelled"],
  ] as const;
  const total = chartItems.reduce((sum, item) => sum + item[1], 0);
  const pending = jobSummary.pending || 0;
  const inProgress = jobSummary.in_progress || 0;
  const completed = jobSummary.completed || 0;
  
  // Calculate angles for conic gradient
  const pendingPercent = total ? (pending / total) * 100 : 0;
  const progressPercent = total ? (inProgress / total) * 100 : 0;
  const completedPercent = total ? (completed / total) * 100 : 0;
  
  const angle1 = (pendingPercent / 100) * 360;
  const angle2 = angle1 + (progressPercent / 100) * 360;
  const angle3 = angle2 + (completedPercent / 100) * 360;
  
  const gradient = `conic-gradient(
    #f59e0b ${angle1}deg,
    #3b82f6 ${angle1}deg ${angle2}deg,
    #10b981 ${angle2}deg ${angle3}deg,
    #e5e7eb ${angle3}deg 360deg
  )`;

  return (
    <div className="reportArea">
      <div className="reportGrid">
        {Object.entries({
          ...jobSummary,
          rating: summary.rating == null ? "-" : Number(summary.rating).toFixed(1),
          ...(summary.totals?.storage_bytes != null ? { storage_used: formatBytes(summary.totals.storage_bytes) } : {}),
        }).map(([label, value]) => <div key={label}><strong>{String(value)}</strong><span>{label.replace(/_/g, " ")}</span></div>)}
      </div>
      <div className="chartGrid">
        <section className="chartPanel"><div className="chartHeading"><h2>Jobs by status</h2><span>{total} total</span></div><div className="barChart">{chartItems.map(([label, value, tone]) => <div className="barItem" key={label}><div className="barValue"><span>{label}</span><b>{value}</b></div><div className="barTrack"><i className={`barFill ${tone}`} style={{ width: `${total ? Math.max((value / total) * 100, value ? 8 : 0) : 0}%` }} /></div></div>)}</div></section>
        <section className="chartPanel completionChart"><div className="chartHeading"><h2>Workload breakdown</h2><span>Pending, in progress, completed</span></div><div className="donut" style={{ background: gradient }}><div><strong>{total}</strong><span>total jobs</span></div></div><div className="chartLegend"><span><i className="legendPending" style={{backgroundColor: "#f59e0b"}} /> Pending ({pending})</span><span><i className="legendProgress" style={{backgroundColor: "#3b82f6"}} /> In Progress ({inProgress})</span><span><i className="legendCompleted" style={{backgroundColor: "#10b981"}} /> Completed ({completed})</span></div></section>
      </div>
    </div>
  );
}
function Settings({ user }: any) {
  return (
    <div className="settingsView">
      <div>
        <span>Full name</span>
        <strong>{user.name}</strong>
      </div>
      <div>
        <span>Email</span>
        <strong>{user.email}</strong>
      </div>
      <div>
        <span>Role</span>
        <strong>{user.role}</strong>
      </div>
      <div>
        <span>Company</span>
        <strong>Company workspace #{user.company_id}</strong>
      </div>
    </div>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="subEmpty">
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}
