import { useEffect, useRef, useState, type ReactNode } from "react";
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
  History,
  ListChecks,
  Map as MapIcon,
  MessageSquare,
  Plus,
  Route as RouteIcon,
  Search,
  Star,
  UserRound,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  company,
  customers,
  jobs,
  jobsPage,
  machines,
  mechanics,
  notificationsPage,
  PAGE_SIZE,
  reports,
  requestsPage,
  resetTwoFactor,
  reviewsPage,
  servicesPage,
  setPayRate,
  updateCustomer,
  type User,
} from "../services/api";
import type {
  Company,
  CustomerSummary,
  EquipmentSummary,
  Job,
  Machine,
  Mechanic,
  Notification,
  Report,
  Review,
  ServiceRecord,
  ServiceRequest,
} from "../services/types";
import ChecklistManager from "../components/ChecklistManager";
import Messages from "../components/Messages";
import MachinesByCustomer from "../components/MachinesByCustomer";
import { machineSummary } from "./BossDashboard";
import "./CustomerPage.css";
import { AddMachine, EditForm, EditMachine } from "../components/MachineForms";
import ShiftsView from "../components/ShiftsView";
import TeamMap from "../components/TeamMap";
import RoutePlanner from "../components/RoutePlanner";
import Insights from "../components/Insights";
import Pager from "../components/Pager";
import InviteForm from "../components/InviteForm";
import VerifyBanner from "../components/VerifyBanner";
import ResetPassword from "../components/ResetPassword";
import SettingsPanel from "../components/SettingsPanel";
import { ActivityLog } from "../components/CompanyData";
import { confirmAction, toast } from "../components/Feedback";
import { ROLE_NAMES } from "../components/Sidebar";
import { currencyName, errorMessage, formatBytes, formatDate, formatMoney } from "../lib/format";
import { mark, t } from "../i18n";
import { EmptyState, Loading } from "../components/States";
import Field from "../components/Field";

type Props = {
  title: string;
  user: User;
  onOpenJob?: (id: number) => void;
  onOpenCustomer?: (id: number) => void;
  onOpenRequest?: (id: number) => void;
  onOpenMachine?: (id: number) => void;
  /** Messages: the customer whose chat to open (managers). */
  chatCustomerId?: number | null;
  onUserChanged?: (user: User) => void;
};
type Icon = LucideIcon;
/** One row on a list page: each page lists one kind of record. */
type ListItem = Job | CustomerSummary | Mechanic | Machine | ServiceRecord | Review | Notification | ServiceRequest;
type Resource = {
  /** The list's name, shown translated. */
  label: string;
  /** One line under the page title. */
  description: string;
  icon: Icon;
  /** The page's list, loaded whole when it opens (and shown a page at a time). */
  list?: () => Promise<ListItem[]>;
  /** Or, for lists that grow without end, one page at a time from the server, searched there. */
  page?: (page: number, q: string) => Promise<Found>;
  /** What "Add" says on pages where managers can add to the list. */
  addLabel?: string;
};

type Found = { items: ListItem[]; total: number; pages: number };

const isActiveJob = (job: Job) => !["Completed", "Cancelled"].includes(job.status);
// A technician's own jobs come whole: the phone keeps them for when there's no signal.
const jobList = () => jobs().then((data) => data.jobs);

// Keys are the page names the sidebar uses (in English); labels and descriptions are shown translated.
const resources: Record<string, Resource> = {
  "Jobs / Requests": {
    label: mark("Jobs / requests"),
    description: mark("Every job across your team."),
    icon: ClipboardList,
    page: (page, q) => jobsPage(page, q).then((data) => ({ items: data.jobs, total: data.total, pages: data.pages })),
  },
  "My Jobs": {
    label: mark("Jobs"),
    description: mark("Assigned work, status, priority, and scheduled visits."),
    icon: ClipboardList,
    list: jobList,
  },
  "Assigned Jobs": {
    label: mark("Assigned jobs"),
    description: mark("Jobs assigned to you that are not finished yet."),
    icon: ClipboardList,
    list: () => jobList().then((rows) => rows.filter(isActiveJob)),
  },
  Customers: {
    label: mark("Customers"),
    description: mark("Customers connected to your service company."),
    icon: Users,
    list: () => customers().then((data) => data.customers),
    addLabel: mark("Add customer"),
  },
  Technicians: {
    label: mark("Technicians"),
    description: mark("The technicians on your service team."),
    icon: Users,
    list: () => mechanics().then((data) => data.mechanics),
    addLabel: mark("Add technician"),
  },
  Equipment: {
    label: mark("Equipment"),
    description: mark("Tracked equipment and current operating status."),
    icon: Wrench,
    list: () => machines().then((data) => data.machines),
    addLabel: mark("Add equipment"),
  },
  "Service Records": {
    label: mark("Service records"),
    description: mark("A searchable history of completed service work."),
    icon: FileText,
    page: (page, q) => servicesPage(page, q).then((data) => ({ items: data.records, total: data.total, pages: data.pages })),
  },
  "Service History": {
    label: mark("Service history"),
    description: mark("Every service visit recorded on your equipment."),
    icon: FileText,
    page: (page, q) => servicesPage(page, q).then((data) => ({ items: data.records, total: data.total, pages: data.pages })),
  },
  Reviews: {
    label: mark("Reviews"),
    description: mark("Ratings and feedback visible according to your role."),
    icon: Star,
    page: (page, q) => reviewsPage(page, q).then((data) => ({ items: data.reviews, total: data.total, pages: data.pages })),
  },
  Notifications: {
    label: mark("Notifications"),
    description: mark("Updates about your jobs, requests, and reviews."),
    icon: Bell,
    page: (page, q) => notificationsPage(page, q).then((data) => ({ items: data.notifications, total: data.total, pages: data.pages })),
  },
  "My Equipment": {
    label: mark("My equipment"),
    description: mark("Equipment registered to your account."),
    icon: Wrench,
    list: () => machines().then((data) => data.machines),
  },
  "Service Requests": {
    label: mark("Service requests"),
    description: mark("Each request, where it is, and its booked visits."),
    icon: ClipboardList,
    page: (page, q) => requestsPage(page, q).then((data) => ({ items: data.requests, total: data.total, pages: data.pages })),
  },
  "My Company": { label: mark("My company"), description: mark("The service company that looks after your equipment."), icon: Users },
  Reports: { label: mark("Reports"), description: mark("Operational performance for the data you are allowed to see."), icon: BarChart3 },
  Messages: { label: mark("Messages"), description: mark("Company conversations and job communication."), icon: MessageSquare },
  Settings: { label: mark("Settings"), description: mark("Your language, account and company settings."), icon: Cog },
  Profile: { label: mark("Profile"), description: mark("Your account details and access."), icon: UserRound },
  "Help & Support": { label: mark("Help & support"), description: mark("Support resources for your service workspace."), icon: HelpCircle },
  Checklists: { label: mark("Checklists"), description: mark("Checklists your technicians complete for each type of job."), icon: ListChecks },
  "Team Map": { label: mark("Clocked-in technicians"), description: mark("Where your clocked-in technicians were last seen."), icon: MapIcon },
  Routes: { label: mark("Route planner"), description: mark("The shortest order to visit a technician's jobs on a day."), icon: RouteIcon },
  Shifts: { label: mark("Shifts"), description: mark("Clock-in and clock-out times and hours for your team."), icon: Clock },
  "My Shifts": { label: mark("My shifts"), description: mark("Your clock-in and clock-out times and hours."), icon: Clock },
  Activity: {
    label: mark("Activity"),
    description: mark("Sign-ins, security changes, deletions and exports in your company, kept for 12 months."),
    icon: History,
  },
};

export default function WorkspacePage({ title, user, onOpenJob, onOpenCustomer, onOpenRequest, onOpenMachine, chatCustomerId, onUserChanged = () => {} }: Props) {
  const resource = resources[title] || resources.Profile;
  const Icon = resource.icon;
  const [items, setItems] = useState<ListItem[]>([]);
  const [summary, setSummary] = useState<Report | null>(null);
  const [query, setQuery] = useState("");
  const [companyInfo, setCompanyInfo] = useState<Company | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ListItem | null>(null);
  const [resetting, setResetting] = useState<{ id: number; name: string } | null>(null);
  const [paying, setPaying] = useState<Mechanic | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [found, setFound] = useState({ total: 0, pages: 1 });
  // The search, a moment after typing stops (server-paged lists search on the server).
  const [search, setSearch] = useState("");
  const asked = useRef(0);
  // The Equipment page groups equipment under its customer.
  const [customerList, setCustomerList] = useState<CustomerSummary[]>([]);
  const isBoss = user.role === "boss";

  useEffect(() => {
    setItems([]);
    setSummary(null);
    setCompanyInfo(null);
    setError("");
    setAdding(false);
    setQuery("");
    setSearch("");
    setPageNumber(1);
    const failed = (problem: unknown) => setError(errorMessage(problem));
    resource.list?.().then(setItems).catch(failed);
    if (title === "Reports") reports().then(setSummary).catch(failed);
    if (title === "My Company") {
      company()
        .then((data) => setCompanyInfo(data.company))
        .catch(failed);
    }
    if (title === "Equipment" && isBoss) {
      customers()
        .then((data) => setCustomerList(data.customers))
        .catch(failed);
    }
  }, [title, reloadKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query), 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => setPageNumber(1), [search]);
  useEffect(() => {
    if (!resource.page) return;
    // Only the newest answer counts: pages can come back out of order.
    const ask = ++asked.current;
    resource
      .page(pageNumber, search)
      .then((result) => {
        if (ask !== asked.current) return;
        setItems(result.items);
        setFound({ total: result.total, pages: result.pages });
      })
      .catch((problem) => ask === asked.current && setError(errorMessage(problem)));
  }, [title, reloadKey, pageNumber, search]);

  const serverPaged = Boolean(resource.page);
  const filtered = serverPaged ? items : items.filter((item) => JSON.stringify(item).toLowerCase().includes(query.toLowerCase()));
  const total = serverPaged ? found.total : filtered.length;
  const pages = serverPaged ? found.pages : Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(pageNumber, pages);
  const onPage = (rows: ListItem[]) => (serverPaged ? rows : rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE));
  const turnPage = (next: number) => {
    setPageNumber(next);
    document.querySelector(".subPagePanel")?.scrollIntoView({ block: "start" });
  };
  // Managers see each piece of equipment with what makes it need work.
  const equipment = items.filter((item): item is EquipmentSummary => "serial_no" in item && item.work !== undefined);
  const canAdd = isBoss && !!resource.addLabel;
  const added = () => {
    setAdding(false);
    setEditing(null);
    setReloadKey((key) => key + 1);
  };
  // For someone who lost their phone and their backup codes.
  const resetSecondStep = async (userId: number, name: string) => {
    const ok = await confirmAction({
      title: t("Reset two-step sign-in"),
      message: t("{name} is signed out, and sets up two-step sign-in again with their phone the next time they sign in.", { name }),
      confirmLabel: t("Reset"),
    });
    if (!ok) return;
    try {
      await resetTwoFactor(userId);
      toast(t("Two-step sign-in reset for {name}", { name }));
      setReloadKey((key) => key + 1);
    } catch (problem) {
      toast(errorMessage(problem), "error");
    }
  };
  const rowActions = (item: ListItem) => {
    if (!isBoss) return null;
    // Customers and technicians can be helped back in: a customer through their sign-in account.
    const person = "machine_count" in item ? { ...item, id: item.user_id } : "two_factor_enabled" in item ? item : null;
    const resetId = person?.id;
    return (
      <>
        {("serial_no" in item || "machine_count" in item) && (
          <button className="listAction" onClick={() => setEditing(item)}>
            {t("Edit")}
          </button>
        )}
        {person && resetId && (
          <button className="listAction" onClick={() => setResetting({ id: resetId, name: person.name })}>
            {t("Reset password")}
          </button>
        )}
        {person && resetId && person.two_factor_enabled && (
          <button className="listAction" onClick={() => resetSecondStep(resetId, person.name)}>
            {t("Reset two-step sign-in")}
          </button>
        )}
        {"pay_rate_cents" in item && (
          <button className="listAction" onClick={() => setPaying(item)}>
            {t("Pay rate")}
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
      case "Routes":
        return <RoutePlanner onOpenJob={onOpenJob} />;
      case "Shifts":
      case "My Shifts":
        return <ShiftsView user={user} />;
      case "Messages":
        return <Messages user={user} customerId={chatCustomerId} />;
      case "Activity":
        return <ActivityLog />;
      case "Settings":
      case "Profile":
        return <SettingsPanel user={user} onUserChanged={onUserChanged} />;
    }
    if (title === "Equipment" && isBoss && equipment.length) {
      return (
        <MachinesByCustomer
          machines={equipment}
          customers={customerList}
          query={query}
          onOpenJob={onOpenJob}
          onOpenCustomer={onOpenCustomer}
          onOpenMachine={onOpenMachine}
          onChanged={added}
        />
      );
    }
    if (!filtered.length) {
      return query ? (
        <EmptyState icon={<Search size={26} />} title={t("No matches")} text={t("Try a different search.")} />
      ) : (
        <EmptyState icon={<Icon size={26} />} title={t("Nothing here yet")} text={t("New records will appear here as your team uses the workspace.")} />
      );
    }
    return (
      <>
      <div className="subPageList">
        {onPage(title === "Customers" ? sortByNeedsWork(filtered) : filtered).map((item) => (
          <ResourceRow
            key={item.id}
            item={item}
            Icon={Icon}
            actions={rowActions(item)}
            onOpenJob={onOpenJob}
            onOpenCustomer={onOpenCustomer}
            onOpenRequest={onOpenRequest}
            onOpenMachine={onOpenMachine}
          />
        ))}
      </div>
      <Pager page={currentPage} pages={pages} total={total} size={PAGE_SIZE} onPage={turnPage} />
      </>
    );
  };

  return (
    <main className="subPage">
      <div className="subPageHeading">
        <div>
          <span className="eyebrow">MECHANIC PRO / {t(ROLE_NAMES[user.role]).toUpperCase()}</span>
          <h1>{t(title)}</h1>
          <p>{t(resource.description)}</p>
        </div>
        <span className="subPageUser">
          {user.name} · {user.email}
        </span>
      </div>
      {isBoss && user.email_verified === false && (title === "Customers" || title === "Technicians") && <VerifyBanner user={user} onVerified={onUserChanged} />}
      {summary ? (
        <>
          <ReportSummary summary={summary} />
          {isBoss && <Insights onOpenMachine={onOpenMachine} />}
        </>
      ) : !(resource.list || resource.page) ? null : (
        <div className="subPageStats">
          <div>
            <Icon size={20} />
            <strong>{serverPaged ? found.total : items.length}</strong>
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
            {(items.length > 0 || query) && (
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
      {editing && "serial_no" in editing && <EditMachine machine={editing} onClose={() => setEditing(null)} onSaved={added} />}
      {editing && "machine_count" in editing && <EditCustomer customer={editing} onClose={() => setEditing(null)} onSaved={added} />}
      {resetting && <ResetPassword userId={resetting.id} name={resetting.name} onClose={() => setResetting(null)} />}
      {paying && <PayRate mechanic={paying} onClose={() => setPaying(null)} onSaved={added} />}
    </main>
  );
}

/** What an hour of a technician's time costs the company: job costing multiplies their worksheet hours by it. */
function PayRate({ mechanic, onClose, onSaved }: { mechanic: Mechanic; onClose: () => void; onSaved: () => void }) {
  return (
    <EditForm
      title={t("Pay rate: {name}", { name: mechanic.name })}
      onClose={onClose}
      save={async (data) => {
        await setPayRate(mechanic.id, String(data.pay_rate ?? "").trim() || null);
        toast(t("Pay rate saved"));
        onClose();
        onSaved();
      }}
    >
      <Field label={t("Pay rate per hour ({currency})", { currency: currencyName() })} hint={t("What an hour of their time costs you, used to work out what each job cost. Leave empty to clear it.")} optional>
        <input
          id="field-pay_rate"
          name="pay_rate"
          inputMode="decimal"
          defaultValue={mechanic.pay_rate_cents != null ? String(mechanic.pay_rate_cents / 100) : ""}
          placeholder="600"
        />
      </Field>
    </EditForm>
  );
}

function EditCustomer({ customer, onClose, onSaved }: { customer: CustomerSummary; onClose: () => void; onSaved: () => void }) {
  return (
    <EditForm
      title={t("Edit customer")}
      onClose={onClose}
      save={async (data) => {
        await updateCustomer(customer.id, data);
        onSaved();
      }}
    >
      <Field label={t("Company or organisation name")}>
        <input id="field-name" name="name" defaultValue={customer.name} required />
      </Field>
      <Field label={t("Contact email")}>
        <input id="field-email" name="email" type="email" defaultValue={customer.email} required />
      </Field>
      <Field label={t("Phone")}>
        <input id="field-phone" name="phone" defaultValue={customer.phone || ""} />
      </Field>
    </EditForm>
  );
}

function CompanyView({ company }: { company: Company }) {
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
      {company.contacts.map((contact) => (
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

const needsWork = (row: ListItem) => "needs_work_count" in row && row.needs_work_count > 0;
const sortByNeedsWork = (rows: ListItem[]) => [...rows].sort((a, b) => Number(needsWork(b)) - Number(needsWork(a)));

/** What a row says: a heading, a line under it, and a status or badge. Jobs, and service
 *  records that belong to a job, open the job's worksheet. */
type Description = { heading: string; detail: string; status?: string; badge?: string; jobId?: number | null };

function describe(item: ListItem): Description {
  if ("is_read" in item) return { heading: item.title, detail: item.message, badge: item.is_read ? t("Read") : t("New") };
  if ("rating" in item) return { heading: item.comment || t("No written comment was provided."), detail: formatDate(item.created_at), badge: `${item.rating}/5` };
  if ("service_type" in item) return { heading: item.service_type, detail: item.work_done || t("No additional details"), jobId: item.job_id };
  if ("subject" in item) return { heading: item.subject, detail: item.description, status: item.status };
  if ("serial_no" in item) return { heading: item.name, detail: [item.equipment_type, item.model].filter(Boolean).join(" · ") || t("No additional details"), status: item.status };
  if ("priority" in item) {
    const due = item.due_date ? t("Due {date}", { date: formatDate(item.due_date) }) : "";
    const detail = [t(item.priority || "Medium"), item.location || t("No site"), due].filter(Boolean).join(" · ");
    return { heading: item.title, detail, status: item.status, jobId: item.id };
  }
  // Customers and technicians (with what an hour of their time costs, for job costing).
  if ("pay_rate_cents" in item && item.pay_rate_cents != null) {
    return { heading: item.name, detail: `${item.email} · ${t("{amount} an hour", { amount: formatMoney(item.pay_rate_cents) })}` };
  }
  return { heading: item.name, detail: item.email };
}

type RowProps = {
  item: ListItem;
  Icon: Icon;
  actions: ReactNode;
  onOpenJob?: (id: number) => void;
  onOpenCustomer?: (id: number) => void;
  onOpenRequest?: (id: number) => void;
  onOpenMachine?: (id: number) => void;
};

function ResourceRow({ item, Icon, actions, onOpenJob, onOpenCustomer, onOpenRequest, onOpenMachine }: RowProps) {
  const { heading, detail, status, badge, jobId } = describe(item);
  const customer = onOpenCustomer && "machine_count" in item ? item : null;
  const request = onOpenRequest && "subject" in item ? item : null;
  const machine = onOpenMachine && "serial_no" in item ? item : null;
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
        ) : customer && onOpenCustomer ? (
          <button className="titleLink" onClick={() => onOpenCustomer(customer.id)}>
            <strong>{heading}</strong>
          </button>
        ) : request && onOpenRequest ? (
          <button className="titleLink" onClick={() => onOpenRequest(request.id)}>
            <strong>{heading}</strong>
          </button>
        ) : machine && onOpenMachine ? (
          <button className="titleLink" onClick={() => onOpenMachine(machine.id)}>
            <strong>{heading}</strong>
          </button>
        ) : (
          <strong>{heading}</strong>
        )}
        <small>
          {detail}
          {customer && (
            <>
              {" · "}
              <span className={customer.needs_work_count ? "needsWorkText" : ""}>{machineSummary(customer)}</span>
            </>
          )}
        </small>
      </div>
      <span className={`dataStatus ${String(status || "Active").replace(/ /g, "").toLowerCase()}`}>{status ? t(status) : (badge ?? t("Active"))}</span>
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

function ReportSummary({ summary }: { summary: Report }) {
  const jobSummary = summary.jobs;
  const { pending, in_progress: inProgress, completed, cancelled } = jobSummary;
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
  const slices = [
    `${SEGMENT_COLORS.pending} ${angle1}deg`,
    `${SEGMENT_COLORS.progress} ${angle1}deg ${angle2}deg`,
    `${SEGMENT_COLORS.completed} ${angle2}deg ${angle3}deg`,
    `${SEGMENT_COLORS.rest} ${angle3}deg 360deg`,
  ];
  const gradient = `conic-gradient(${slices.join(", ")})`;
  const numbers: Record<string, string | number> = {
    ...jobSummary,
    rating: summary.rating == null ? "-" : summary.rating.toFixed(1),
    ...(summary.totals.storage_bytes != null ? { storage_used: formatBytes(summary.totals.storage_bytes) } : {}),
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
