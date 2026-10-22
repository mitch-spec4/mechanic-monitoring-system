import { useEffect, useState } from "react";
import {
  BarChart3,
  Bell,
  CheckCircle2,
  ClipboardList,
  Cog,
  FileText,
  HelpCircle,
  MessageSquare,
  Plus,
  Search,
  Star,
  UserRound,
  Users,
  Wrench,
} from "lucide-react";
import {
  company,
  createMachine,
  customers,
  jobs,
  machines,
  mechanics,
  notifications,
  reports,
  requests,
  reviews,
  services,
} from "../services/api";
import InviteForm from "../components/InviteForm";
import Modal from "../components/Modal";
import { errorMessage, formatDate } from "../lib/format";

type Props = { title: string; user: any };
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
};

export default function WorkspacePage({ title, user }: Props) {
  const resource = resources[title] || resources.Profile;
  const Icon = resource.icon;
  const [items, setItems] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [query, setQuery] = useState("");
  const [companyInfo, setCompanyInfo] = useState<any>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

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
  }, [title, reloadKey]);

  const filtered = items.filter((item) =>
    JSON.stringify(item).toLowerCase().includes(query.toLowerCase()),
  );
  const canAdd =
    user.role === "boss" && ["Customers", "Machines", "Mechanics"].includes(title);
  const added = () => {
    setAdding(false);
    setReloadKey((key) => key + 1);
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
        ) : title === "Messages" ? (
          <Empty
            title="Messaging is not connected"
            text="Conversation storage and permissions will appear here when the messaging service is enabled."
          />
        ) : title === "Settings" || title === "Profile" ? (
          <Settings user={user} />
        ) : filtered.length ? (
          <div className="subPageList">
            {filtered.map((item, index) => (
              <ResourceRow
                key={item.id || index}
                item={item}
                title={title}
                Icon={Icon}
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
    </main>
  );
}

function AddMachine({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [customerList, setCustomerList] = useState<any[]>([]);
  const [formError, setFormError] = useState("");
  useEffect(() => {
    customers().then((data) => setCustomerList(data.customers)).catch((e) => setFormError(errorMessage(e)));
  }, []);
  const submit = async (event: any) => {
    event.preventDefault();
    setFormError("");
    try {
      await createMachine(Object.fromEntries(new FormData(event.currentTarget)));
      onAdded();
    } catch (e) {
      setFormError(errorMessage(e));
    }
  };
  return (
    <Modal title="Add machine" icon={<Wrench size={20} />} onClose={onClose}>
      <form className="form form-upgraded" onSubmit={submit}>
        {formError && <div className="error">{formError}</div>}
        <div className="formGroup">
          <label>Customer</label>
          <select name="customer_id" required>
            <option value="">Select customer</option>
            {customerList.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="formGroup">
          <label>Machine name</label>
          <input name="name" placeholder="e.g. Generator G-102" required />
        </div>
        <div className="formGroup">
          <label>Model</label>
          <input name="model" placeholder="e.g. CAT XQ200" />
        </div>
        <div className="formGroup">
          <label>Serial number</label>
          <input name="serial_no" placeholder="Serial number" required />
        </div>
        <div className="formGroup">
          <label>Status</label>
          <select name="status" defaultValue="Operational">
            {["Operational", "Under Maintenance", "Under Repair", "Retired"].map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </div>
        <button className="primary">
          <Plus size={15} /> Add machine
        </button>
      </form>
    </Modal>
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
function ResourceRow({ item, title, Icon }: any) {
  const isJob = ["My Jobs", "Assigned Jobs", "Jobs / Requests"].includes(title);
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
        <strong>{heading}</strong>
        <small>{detail}</small>
      </div>
      <span
        className={`dataStatus ${String(item.status || "Active")
          .replace(/ /g, "")
          .toLowerCase()}`}
      >
        {item.status ||
          (title === "Reviews" ? `${item.rating}/5` : title === "Notifications" ? (item.is_read ? "Read" : "New") : "Active")}
      </span>
    </article>
  );
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
        {Object.entries({ ...jobSummary, rating: summary.rating == null ? "-" : Number(summary.rating).toFixed(1) }).map(([label, value]) => <div key={label}><strong>{String(value)}</strong><span>{label.replace(/_/g, " ")}</span></div>)}
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
