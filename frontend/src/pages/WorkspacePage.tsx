import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
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
  type LucideIcon,
} from "lucide-react";
import { company, customers, jobs, machines, mechanics, notifications, reports, requests, reviews, services, updateCustomer, type User } from "../services/api";
import ChecklistManager from "../components/ChecklistManager";
import MachinesByCustomer from "../components/MachinesByCustomer";
import { machineSummary } from "./BossDashboard";
import "./CustomerPage.css";
import { AddMachine, EditForm, EditMachine } from "../components/MachineForms";
import ShiftsView from "../components/ShiftsView";
import TeamMap from "../components/TeamMap";
import InviteForm from "../components/InviteForm";
import VerifyBanner from "../components/VerifyBanner";
import ResetPassword from "../components/ResetPassword";
import SettingsPanel from "../components/SettingsPanel";
import { ROLE_NAMES } from "../components/Sidebar";
import { errorMessage, formatBytes, formatDate } from "../lib/format";
import { mark, t } from "../i18n";
import { EmptyState, Loading } from "../components/States";

type Props = { title: string; user: User; onOpenJob?: (id: number) => void; onOpenCustomer?: (id: number) => void; onUserChanged?: (user: User) => void };
type Icon = LucideIcon;
// Rows differ by page (jobs, customers, reviews...), so they're read loosely.
type Row = Record<string, any>;
type Resource = {
  /** The list's name, shown translated. */
  label: string;
  /** One line under the page title. */
  description: string;
  icon: Icon;
  load?: () => Promise<any>;
  key?: string;
  filter?: (item: Row) => boolean;
  /** What "Add" says on pages where managers can add to the list. */
  addLabel?: string;
};

const isActiveJob = (job: Row) => !["Completed", "Cancelled"].includes(job.status);
const JOB_PAGES = ["My Jobs", "Assigned Jobs", "Jobs / Requests"];

// Keys are the page names the sidebar uses (in English); labels and descriptions are shown translated.
const resources: Record<string, Resource> = {
  "Jobs / Requests": { label: mark("Jobs / requests"), description: mark("Every job across your team."), icon: ClipboardList, load: jobs, key: "jobs" },
  "My Jobs": { label: mark("Jobs"), description: mark("Assigned work, status, priority, and scheduled visits."), icon: ClipboardList, load: jobs, key: "jobs" },
  "Assigned Jobs": {
    label: mark("Assigned jobs"),
    description: mark("Jobs assigned to you that are not finished yet."),
    icon: ClipboardList,
    load: jobs,
    key: "jobs",
    filter: isActiveJob,
  },
  Customers: {
    label: mark("Customers"),
    description: mark("Customers connected to your service company."),
    icon: Users,
    load: customers,
    key: "customers",
    addLabel: mark("Add customer"),
  },
  Technicians: {
    label: mark("Technicians"),
    description: mark("The technicians on your service team."),
    icon: Users,
    load: mechanics,
    key: "mechanics",
    addLabel: mark("Add technician"),
  },
  Equipment: {
    label: mark("Equipment"),
    description: mark("Tracked equipment and current operating status."),
    icon: Wrench,
    load: machines,
    key: "machines",
    addLabel: mark("Add equipment"),
  },
  "Service Records": { label: mark("Service records"), description: mark("A searchable history of completed service work."), icon: FileText, load: services, key: "records" },
  "Service History": { label: mark("Service history"), description: mark("Every service visit recorded on your equipment."), icon: FileText, load: services, key: "records" },
  Reviews: { label: mark("Reviews"), description: mark("Ratings and feedback visible according to your role."), icon: Star, load: reviews, key: "reviews" },
  Notifications: { label: mark("Notifications"), description: mark("Updates about your jobs, requests, and reviews."), icon: Bell, load: notifications, key: "notifications" },
  "My Equipment": { label: mark("My equipment"), description: mark("Equipment registered to your account."), icon: Wrench, load: machines, key: "machines" },
  "Service Requests": { label: mark("Service requests"), description: mark("Service you have requested and its current status."), icon: ClipboardList, load: requests, key: "requests" },
  "My Company": { label: mark("My company"), description: mark("The service company that looks after your equipment."), icon: Users, load: company, key: "company" },
  Reports: { label: mark("Reports"), description: mark("Operational performance for the data you are allowed to see."), icon: BarChart3, load: reports, key: "report" },
  Messages: { label: mark("Messages"), description: mark("Company conversations and job communication."), icon: MessageSquare },
  Settings: { label: mark("Settings"), description: mark("Your language, account and company settings."), icon: Cog },
  Profile: { label: mark("Profile"), description: mark("Your account details and access."), icon: UserRound },
  "Help & Support": { label: mark("Help & support"), description: mark("Support resources for your service workspace."), icon: HelpCircle },
  Checklists: { label: mark("Checklists"), description: mark("Checklists your technicians complete for each type of job."), icon: ListChecks },
  "Team Map": { label: mark("Clocked-in technicians"), description: mark("Where your clocked-in technicians were last seen."), icon: MapIcon },
  Shifts: { label: mark("Shifts"), description: mark("Clock-in and clock-out times and hours for your team."), icon: Clock },
  "My Shifts": { label: mark("My shifts"), description: mark("Your clock-in and clock-out times and hours."), icon: Clock },
};

export default function WorkspacePage({ title, user, onOpenJob, onOpenCustomer, onUserChanged = () => {} }: Props) {
  const resource = resources[title] || resources.Profile;
  const Icon = resource.icon;
  const [items, setItems] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Row | null>(null);
  const [query, setQuery] = useState("");
  const [companyInfo, setCompanyInfo] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [resetting, setResetting] = useState<{ id: number; name: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // The Equipment page groups equipment under its customer.
  const [customerList, setCustomerList] = useState<Row[]>([]);
  const isBoss = user.role === "boss";

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
      .catch((problem) => setError(errorMessage(problem)));
    if (title === "Equipment" && isBoss) {
      customers()
        .then((data) => setCustomerList(data.customers))
        .catch((problem) => setError(errorMessage(problem)));
    }
  }, [title, reloadKey]);

  const filtered = items.filter((item) => JSON.stringify(item).toLowerCase().includes(query.toLowerCase()));
  const canAdd = isBoss && !!resource.addLabel;
  const added = () => {
    setAdding(false);
    setEditing(null);
    setReloadKey((key) => key + 1);
  };
  const rowActions = (item: Row) => {
    if (!isBoss) return null;
    const resetId = title === "Technicians" ? item.id : title === "Customers" ? item.user_id : null;
    return (
      <>
        {(title === "Equipment" || title === "Customers") && (
          <button className="listAction" onClick={() => setEditing(item)}>
            {t("Edit")}
          </button>
        )}
        {resetId && (
          <button className="listAction" onClick={() => setResetting({ id: resetId, name: item.name })}>
            {t("Reset password")}
          </button>
        )}
      </>
    );
  };

  const body = () => {
    if (error) return <EmptyState icon={<AlertTriangle size={26} />} title={t("Unable to load data")} text={error} />;
    switch (title) {
      case "My Company":
        return companyInfo ? <CompanyView company={companyInfo} /> : <Loading label={t("Fetching your company details.")} />;
      case "Help & Support":
        return (
          <EmptyState
            icon={<HelpCircle size={26} />}
            title={t("Need help?")}
            text={t("Contact your company manager for access, invitations, or questions about a job. Use the sidebar to move between your jobs, records, and notifications.")}
          />
        );
      case "Checklists":
        return <ChecklistManager />;
      case "Team Map":
        return <TeamMap onOpenJob={onOpenJob} />;
      case "Shifts":
      case "My Shifts":
        return <ShiftsView user={user} />;
      case "Messages":
        return <EmptyState icon={<MessageSquare size={26} />} title={t("Messaging is not connected")} text={t("Conversation storage and permissions will appear here when the messaging service is enabled.")} />;
      case "Settings":
      case "Profile":
        return <SettingsPanel user={user} onUserChanged={onUserChanged} />;
    }
    if (title === "Equipment" && isBoss && items.length) {
      return <MachinesByCustomer machines={items} customers={customerList} query={query} onOpenJob={onOpenJob} onOpenCustomer={onOpenCustomer} onChanged={added} />;
    }
    if (!filtered.length) {
      return <EmptyState icon={<Icon size={26} />} title={t("Nothing here yet")} text={t("New records will appear here as your team uses the workspace.")} />;
    }
    return (
      <div className="subPageList">
        {(title === "Customers" ? sortByNeedsWork(filtered) : filtered).map((item, index) => (
          <ResourceRow key={item.id || index} item={item} title={title} Icon={Icon} actions={rowActions(item)} onOpenJob={onOpenJob} onOpenCustomer={onOpenCustomer} />
        ))}
      </div>
    );
  };

  return (
    <main className="subPage">
      <div className="subPageHeading">
        <div>
          <span className="eyebrow">MECHANIC PRO / {t(ROLE_NAMES[user.role] ?? user.role).toUpperCase()}</span>
          <h1>{t(title)}</h1>
          <p>{t(resource.description)}</p>
        </div>
        <span className="subPageUser">
          {user.name} · {user.email}
        </span>
      </div>
      {isBoss && user.email_verified === false && (title === "Customers" || title === "Technicians") && <VerifyBanner user={user} onVerified={onUserChanged} />}
      {summary ? (
        <ReportSummary summary={summary} />
      ) : !resource.load || resource.key === "company" ? null : (
        <div className="subPageStats">
          <div>
            <Icon size={20} />
            <strong>{items.length}</strong>
            <span>{t(resource.label)}</span>
          </div>
          <div>
            <CheckCircle2 size={20} />
            <strong>{items.length ? t("Connected") : t("Ready")}</strong>
            <span>{error || t("Live workspace data")}</span>
          </div>
        </div>
      )}
      {/* Reports are the charts above; there is no list under them. */}
      {!summary && (
      <section className="subPagePanel">
        <div className="subPagePanelHead">
          <h2>
            <Icon size={16} />
            {t(resource.label)}
          </h2>
          <div className="subPageTools">
            {items.length > 0 && (
              <label className="searchBox">
                <Search size={14} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Search")} aria-label={t("Search")} />
              </label>
            )}
            {canAdd && (
              <button className="primary" onClick={() => setAdding(true)}>
                <Plus size={14} /> {t(resource.addLabel!)}
              </button>
            )}
          </div>
        </div>
        {body()}
      </section>
      )}
      {adding && title === "Equipment" && <AddMachine onClose={() => setAdding(false)} onAdded={added} />}
      {adding && (title === "Customers" || title === "Technicians") && (
        <InviteForm role={title === "Customers" ? "customer" : "mechanic"} onClose={() => setAdding(false)} onDone={added} />
      )}
      {editing && title === "Equipment" && <EditMachine machine={editing as any} onClose={() => setEditing(null)} onSaved={added} />}
      {editing && title === "Customers" && <EditCustomer customer={editing} onClose={() => setEditing(null)} onSaved={added} />}
      {resetting && <ResetPassword userId={resetting.id} name={resetting.name} onClose={() => setResetting(null)} />}
    </main>
  );
}

function EditCustomer({ customer, onClose, onSaved }: { customer: Row; onClose: () => void; onSaved: () => void }) {
  return (
    <EditForm
      title={t("Edit customer")}
      onClose={onClose}
      save={async (data) => {
        await updateCustomer(customer.id, data);
        onSaved();
      }}
    >
      <div className="formGroup">
        <label htmlFor="field-name">{t("Company or organisation name")}</label>
        <input id="field-name" name="name" defaultValue={customer.name} required />
      </div>
      <div className="formGroup">
        <label htmlFor="field-email">{t("Contact email")}</label>
        <input id="field-email" name="email" type="email" defaultValue={customer.email} required />
      </div>
      <div className="formGroup">
        <label htmlFor="field-phone">{t("Phone")}</label>
        <input id="field-phone" name="phone" defaultValue={customer.phone || ""} />
      </div>
    </EditForm>
  );
}

function CompanyView({ company }: { company: Row }) {
  return (
    <div className="settingsView">
      <div>
        <span>{t("Company")}</span>
        <strong>{company.name}</strong>
      </div>
      <div>
        <span>{t("Location")}</span>
        <strong>{company.location || t("Not recorded")}</strong>
      </div>
      {company.contacts.map((contact: { name: string; email: string }) => (
        <div key={contact.email}>
          <span>{t("Manager")}</span>
          <strong>
            {contact.name} · {contact.email}
          </strong>
        </div>
      ))}
    </div>
  );
}

const sortByNeedsWork = (rows: Row[]) => [...rows].sort((a, b) => Number(b.needs_work_count > 0) - Number(a.needs_work_count > 0));

type RowProps = { item: Row; title: string; Icon: Icon; actions: ReactNode; onOpenJob?: (id: number) => void; onOpenCustomer?: (id: number) => void };

function ResourceRow({ item, title, Icon, actions, onOpenJob, onOpenCustomer }: RowProps) {
  const isJob = JOB_PAGES.includes(title);
  const isCustomer = title === "Customers" && onOpenCustomer;
  // Jobs, and service records that belong to a job, open the job's worksheet.
  const jobId = isJob ? item.id : item.job_id;
  const heading = item.title || item.name || item.service_type || item.subject || t("Untitled");
  const detail = isJob
    ? [t(item.priority || "Medium"), item.location || t("No site"), item.due_date ? t("Due {date}", { date: formatDate(item.due_date) }) : ""].filter(Boolean).join(" · ")
    : item.email || item.message || item.work_done || item.description || item.comment || item.model || t("No additional details");
  const badge = item.status
    ? t(item.status)
    : title === "Reviews"
      ? `${item.rating}/5`
      : title === "Notifications"
        ? item.is_read
          ? t("Read")
          : t("New")
        : t("Active");
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
      <span className={`dataStatus ${String(item.status || "Active").replace(/ /g, "").toLowerCase()}`}>{badge}</span>
      {actions}
    </article>
  );
}

// The report's numbers, in the order they're shown.
const REPORT_LABELS: Record<string, string> = {
  total: mark("Total jobs"),
  completed: mark("Completed"),
  pending: mark("Pending"),
  in_progress: mark("In progress"),
  cancelled: mark("Cancelled"),
  rating: mark("Average rating"),
  storage_used: mark("Storage used"),
};
const SEGMENT_COLORS = { pending: "#f59e0b", progress: "#3b82f6", completed: "#10b981", rest: "#e5e7eb" };

function ReportSummary({ summary }: { summary: Row }) {
  const jobSummary = summary.jobs || {};
  const pending = jobSummary.pending || 0;
  const inProgress = jobSummary.in_progress || 0;
  const completed = jobSummary.completed || 0;
  const cancelled = jobSummary.cancelled || 0;
  const chartItems = [
    [t("Pending"), pending, "pending"],
    [t("In progress"), inProgress, "progress"],
    [t("Completed"), completed, "completed"],
    [t("Cancelled"), cancelled, "cancelled"],
  ] as const;
  const total = pending + inProgress + completed + cancelled;
  // Where each slice of the workload donut ends, in degrees.
  const share = (count: number) => (total ? (count / total) * 360 : 0);
  const angle1 = share(pending);
  const angle2 = angle1 + share(inProgress);
  const angle3 = angle2 + share(completed);
  const gradient = `conic-gradient(${SEGMENT_COLORS.pending} ${angle1}deg, ${SEGMENT_COLORS.progress} ${angle1}deg ${angle2}deg, ${SEGMENT_COLORS.completed} ${angle2}deg ${angle3}deg, ${SEGMENT_COLORS.rest} ${angle3}deg 360deg)`;
  const numbers: Record<string, string | number> = {
    ...jobSummary,
    rating: summary.rating == null ? "-" : Number(summary.rating).toFixed(1),
    ...(summary.totals?.storage_bytes != null ? { storage_used: formatBytes(summary.totals.storage_bytes) } : {}),
  };

  return (
    <div className="reportArea">
      <div className="reportGrid">
        {Object.entries(numbers).map(([key, value]) => (
          <div key={key}>
            <strong>{String(value)}</strong>
            <span>{t(REPORT_LABELS[key] ?? key)}</span>
          </div>
        ))}
      </div>
      <div className="chartGrid">
        <section className="chartPanel">
          <div className="chartHeading">
            <h2>{t("Jobs by status")}</h2>
            <span>{t("{count} total", { count: total })}</span>
          </div>
          <div className="barChart">
            {chartItems.map(([label, value, tone]) => (
              <div className="barItem" key={tone}>
                <div className="barValue">
                  <span>{label}</span>
                  <b>{value}</b>
                </div>
                <div className="barTrack">
                  <i className={`barFill ${tone}`} style={{ width: `${total ? Math.max((value / total) * 100, value ? 8 : 0) : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="chartPanel completionChart">
          <div className="chartHeading">
            <h2>{t("Workload breakdown")}</h2>
            <span>{t("Pending, in progress, completed")}</span>
          </div>
          <div className="donut" style={{ background: gradient }}>
            <div>
              <strong>{total}</strong>
              <span>{t("total jobs")}</span>
            </div>
          </div>
          <div className="chartLegend">
            <span>
              <i style={{ backgroundColor: SEGMENT_COLORS.pending }} /> {t("Pending ({count})", { count: pending })}
            </span>
            <span>
              <i style={{ backgroundColor: SEGMENT_COLORS.progress }} /> {t("In progress ({count})", { count: inProgress })}
            </span>
            <span>
              <i style={{ backgroundColor: SEGMENT_COLORS.completed }} /> {t("Completed ({count})", { count: completed })}
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
