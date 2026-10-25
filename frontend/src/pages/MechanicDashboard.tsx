import { useEffect, useState, type ReactNode } from "react";
import { CalendarClock, CheckCircle2, ClipboardList, FileText, MapPin, Navigation, Play, Star, Wrench } from "lucide-react";
import { ApiError, jobs, machines, myRoute, reviews as fetchReviews, services, type User } from "../services/api";
import { ClockCard, changeJobStatus, useShift } from "../components/Shift";
import { InstallCard, Waiting } from "../components/Offline";
import { offlineState } from "../offline";
import SignatureModal, { type SignOff } from "../components/SignatureModal";
import { errorMessage, formatDate, formatDay, formatTime, greeting, toZoneInput } from "../lib/format";
import { usePolling } from "../lib/usePolling";
import { routeLink } from "../lib/directions";
import { t } from "../i18n";
import { EmptyState } from "../components/States";
import type { Job, Machine, Review as CustomerReview, ServiceRecord } from "../services/types";

type Props = { u: User; onOpenJob: (id: number) => void };

const FINISHED = ["Completed", "Cancelled"];
// Today's jobs come first: the one being worked on, then paused ones, then the stops of the route
// the manager planned for today in order, then by due date.
const TODAY_ORDER: Record<string, number> = { "In Progress": 0, Paused: 1 };
const today = () => toZoneInput(new Date()).slice(0, 10);
/** Its stop number on today's planned route, if it has one. */
const stopToday = (job: Job) => (job.route_date === today() && job.route_order != null ? job.route_order : null);

/** Jobs for today: in progress, paused, on today's route, or due today or earlier. */
function todaysJobs(jobs: Job[]) {
  const day = today();
  return jobs
    .filter((job) => job.status in TODAY_ORDER || stopToday(job) != null || (job.due_date && job.due_date <= day))
    .sort(
      (a, b) =>
        (TODAY_ORDER[a.status] ?? 2) - (TODAY_ORDER[b.status] ?? 2) ||
        (stopToday(a) ?? Infinity) - (stopToday(b) ?? Infinity) ||
        String(a.due_date).localeCompare(String(b.due_date)) ||
        // Booked visits by their time; others after them.
        String(a.scheduled_start ?? "~").localeCompare(String(b.scheduled_start ?? "~")),
    );
}

export default function MechanicDashboard({ u, onOpenJob }: Props) {
  const [jobList, setJobList] = useState<Job[]>([]);
  const [serviceList, setServiceList] = useState<ServiceRecord[]>([]);
  const [machineList, setMachineList] = useState<Machine[]>([]);
  const [reviewList, setReviewList] = useState<CustomerReview[]>([]);
  const [actionError, setActionError] = useState("");
  const load = () =>
    Promise.all([jobs(), services(), machines(), fetchReviews()])
      .then(([jobData, serviceData, machineData, reviewData]) => {
        setJobList(jobData.jobs);
        setServiceList(serviceData.records);
        setMachineList(machineData.machines);
        setReviewList(reviewData.reviews);
      })
      .catch(() => {});
  usePolling(load, 30000, true);
  // A "clock in first" error is out of date once the technician clocks in or out.
  const shiftId = useShift()?.status?.shift?.id;
  useEffect(() => setActionError(""), [shiftId]);
  const activeJobs = jobList.filter((job) => !FINISHED.includes(job.status));
  // Equipment this technician works on: from their jobs and their own service records.
  const myMachineIds = new Set([...jobList.map((job) => job.machine_id), ...serviceList.map((record) => record.machine_id)]);
  const myMachines = machineList.filter((item) => myMachineIds.has(item.id));
  const focusJob = activeJobs.find((job) => job.machine_id);
  const focusMachineId = focusJob?.machine_id ?? serviceList[0]?.machine_id;
  const machine = machineList.find((item) => item.id === focusMachineId) || null;
  const machineRecords = machine ? serviceList.filter((record) => record.machine_id === machine.id) : [];
  const completed = jobList.filter((job) => job.status === "Completed").length;
  const ratingAverage = reviewList.length
    ? (reviewList.reduce((total, review) => total + review.rating, 0) / reviewList.length).toFixed(1)
    : "—";
  const latestService = serviceList[0] || null;
  // With a route planned for today: one link that opens the stops in order in the map app.
  const routedIds = activeJobs.filter((job) => stopToday(job) != null).map((job) => job.id).join(",");
  const [routeHref, setRouteHref] = useState<string | null>(null);
  useEffect(() => {
    if (!routedIds) {
      setRouteHref(null);
      return;
    }
    myRoute(today())
      .then(({ plan }) => {
        const where = new Map(plan.stops.map((stop) => [stop.job_id, stop]));
        const stops = plan.current.job_ids.flatMap((id) => {
          const stop = where.get(id);
          return stop?.latitude != null && stop.longitude != null ? [{ latitude: stop.latitude, longitude: stop.longitude }] : [];
        });
        setRouteHref(routeLink(stops));
      })
      .catch(() => setRouteHref(null));
  }, [routedIds]);
  // Start, Resume and Complete wait for a GPS fix, so the job's buttons are disabled meanwhile.
  const [changing, setChanging] = useState<number | null>(null);
  // When the customer's sign-off is all that's missing, the server says so and we ask for it.
  const [signing, setSigning] = useState<Job | null>(null);
  const change = async (id: number, status: string) => {
    const job = jobList.find((candidate) => candidate.id === id);
    if (!job) return;
    // Offline the server can't say what's missing: completing asks for the customer's sign-off at once.
    if (status === "Completed" && offlineState().active && !offlineState().online) {
      setSigning(job);
      return;
    }
    setActionError("");
    setChanging(id);
    try {
      await changeJobStatus(job, status, "mechanic");
    } catch (error) {
      if (error instanceof ApiError && error.data?.needs_signature) setSigning(job);
      else setActionError(errorMessage(error));
    } finally {
      setChanging(null);
    }
    load();
  };
  return (
    <div className="mechanicDashboard" id="dashboard-top">
      <div className="dashHeading">
        <div>
          <span className="eyebrow">{t("SERVICE MANAGEMENT SYSTEM")}</span>
          <h1>{t("{greeting}, {name}", { greeting: greeting(), name: u.name.split(" ")[0] })}</h1>
          <p className="dashSubhead">{t("Here is the work that still needs your attention.")}</p>
        </div>
      </div>
      <ClockCard />
      <InstallCard />
      <TodaysJobs jobs={todaysJobs(activeJobs)} routeHref={routeHref} changing={changing} onChange={change} onOpenJob={onOpenJob} />
      <div className="kpiGrid">
        <Kpi icon={<FileText />} color="blue" number={activeJobs.length} label={t("Pending work")} detail={t("Needs attention")} />
        <Kpi icon={<CheckCircle2 />} color="green" number={completed} label={t("Completed")} detail={t("Total all time")} />
        <Kpi icon={<Wrench />} color="amber" number={myMachines.length} label={t("Equipment")} detail={t("Assigned to you")} />
        <Kpi
          icon={<Star />}
          color="violet"
          number={ratingAverage}
          label={t("Rating")}
          detail={reviewList.length === 1 ? t("From 1 review") : t("From {count} reviews", { count: reviewList.length })}
        />
      </div>
      <section id="my-jobs" className="pendingPanel">
        <div className="dashPanelTitle">
          <h2>
            <FileText size={14} /> {t("My pending work")}
          </h2>
          <span className="pendingCount">{t("{count} open", { count: activeJobs.length })}</span>
        </div>
        {actionError && <div className="error">{actionError}</div>}
        {activeJobs.length === 0 ? (
          <div className="emptyPending">
            <CheckCircle2 size={24} />
            <strong>{t("All caught up")}</strong>
            <span>{t("No pending jobs right now.")}</span>
          </div>
        ) : (
          activeJobs.map((job) => (
            <article className="pendingJob" key={job.id}>
              <div>
                <div className="jobTitle">
                  <button className="titleLink" onClick={() => onOpenJob(job.id)}>
                    <strong>{job.title}</strong>
                  </button>
                  <span className={`jobStatus ${String(job.status).replace(/ /g, "").toLowerCase()}`}>{t(job.status)}</span>
                  {job.pending_status && <Waiting />}
                </div>
                <p>{job.description}</p>
                <small>
                  <MapPin size={11} /> {job.location || t("No site")} · {t("Due {date}", { date: formatDate(job.due_date) || t("Not set") })}
                </small>
              </div>
              <fieldset className="pendingActions" disabled={changing === job.id} aria-busy={changing === job.id}>
                <button className="secondary" onClick={() => onOpenJob(job.id)}>
                  <ClipboardList size={14} /> {t("Worksheet")}
                </button>
                {job.status === "Assigned" && (
                  <button className="secondary" onClick={() => change(job.id, "Accepted")}>
                    {t("Accept")}
                  </button>
                )}
                {(job.status === "Assigned" || job.status === "Accepted") && (
                  <button className="primary" onClick={() => change(job.id, "In Progress")}>
                    {t("Start work")}
                  </button>
                )}
                {job.status === "Paused" && (
                  <button className="primary" onClick={() => change(job.id, "In Progress")}>
                    {t("Resume")}
                  </button>
                )}
                {job.status === "In Progress" && (
                  <>
                    <button className="secondary" onClick={() => change(job.id, "Paused")}>
                      {t("Pause")}
                    </button>
                    <button className="primary" onClick={() => change(job.id, "Completed")}>
                      {t("Complete")}
                    </button>
                  </>
                )}
              </fieldset>
            </article>
          ))
        )}
      </section>
      <section className="dashboardGrid">
        {signing && (
          <SignatureModal
            jobTitle={signing.title}
            facts={[machineList.find((item) => item.id === signing.machine_id)?.name, signing.location].filter((fact): fact is string => Boolean(fact))}
            onSubmit={(signOff: SignOff) => changeJobStatus(signing, "Completed", "mechanic", signOff)}
            onDone={() => {
              setSigning(null);
              load();
            }}
            onClose={() => setSigning(null)}
          />
        )}
        <Panel title={t("Today's schedule")} icon={<MapPin />} className="schedulePanel">
          <Schedule jobs={jobList} machines={machineList} />
        </Panel>
        <Panel title={t("Recent work")} icon={<FileText />} className="recentPanel">
          <RecentWork jobs={jobList} />
        </Panel>
        <Panel
          title={t("Equipment history")}
          icon={<Wrench />}
          className="historyPanel"
          action={machine && <span className="operational">{t(machine.status)}</span>}
        >
          <MachineHistory machine={machine} records={machineRecords} />
          {focusJob && focusJob.machine_id === machine?.id && (
            <button className="blueAction" onClick={() => onOpenJob(focusJob.id)}>
              <ClipboardList size={14} /> {t("Open worksheet")}
            </button>
          )}
        </Panel>
        <Panel id="customer-review" title={t("Latest customer feedback")} icon={<Star />} className="reviewPanel">
          <Review reviews={reviewList} />
        </Panel>
        <Panel title={t("Advice & follow-up")} icon={<Wrench />} className="advicePanel">
          <Advice service={latestService} />
        </Panel>
        <Panel title={t("Documents")} icon={<FileText />} className="documentsPanel">
          <EmptyState icon={<FileText size={26} />} title={t("No documents yet")} text={t("Service reports and inspection files will appear here.")} />
        </Panel>
      </section>
    </div>
  );
}

type TodayProps = {
  jobs: Job[];
  routeHref: string | null;
  changing: number | null;
  onChange: (id: number, status: string) => void;
  onOpenJob: (id: number) => void;
};

/** The day's work, one big button each: Open the job being worked on, Resume a paused one, or Start. */
function TodaysJobs({ jobs, routeHref, changing, onChange, onOpenJob }: TodayProps) {
  const day = today();
  return (
    <section className="todayPanel" aria-labelledby="todays-jobs">
      <div className="dashPanelTitle">
        <h2 id="todays-jobs">
          <CalendarClock size={14} /> {t("Today's jobs")}
        </h2>
        {routeHref && (
          <a className="listAction todayRoute" href={routeHref} target="_blank" rel="noreferrer">
            <Navigation size={12} /> {t("Today's route in Maps")}
          </a>
        )}
        <span className="pendingCount">{jobs.length}</span>
      </div>
      {jobs.length === 0 ? (
        <p className="todayEmpty">{t("Nothing due today. Your other jobs are below.")}</p>
      ) : (
        <ol className="todayList">
          {jobs.map((job) => {
            const stop = stopToday(job);
            return (
              <li key={job.id} className="todayJob">
                <div>
                  <strong>{job.title}</strong>
                  <small>
                    {stop != null && <b className="todayStop">{t("Stop {number}", { number: stop })}</b>}
                    <span className={`jobStatus ${String(job.status).replace(/ /g, "").toLowerCase()}`}>{t(job.status)}</span>
                    {job.pending_status && <Waiting />}
                    {job.location || t("No site")}
                    {job.due_date && job.due_date < day && <em className="overdue">{t("Overdue since {date}", { date: formatDate(job.due_date) })}</em>}
                    {job.due_date === day &&
                      (job.scheduled_start ? (
                        <em>{t("Visit at {time}", { time: formatTime(job.scheduled_start) })}</em>
                      ) : (
                        <em>{t("Due today")}</em>
                      ))}
                    {job.on_the_way_at && <em>{t("On the way")}</em>}
                  </small>
                </div>
                {job.status === "In Progress" ? (
                  <button className="primary todayAction" onClick={() => onOpenJob(job.id)}>
                    <ClipboardList size={16} /> {t("Open")}
                  </button>
                ) : (
                  <button className="primary todayAction" disabled={changing === job.id} onClick={() => onChange(job.id, "In Progress")}>
                    <Play size={16} /> {job.status === "Paused" ? t("Resume") : t("Start work")}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function Kpi({ icon, color, number, label, detail }: { icon: ReactNode; color: string; number: ReactNode; label: string; detail: string }) {
  return (
    <div className={`kpi ${color}`}>
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{number}</strong>
        <em>{detail}</em>
      </div>
    </div>
  );
}

type PanelProps = { id?: string; title: string; icon: ReactNode; children: ReactNode; className?: string; action?: ReactNode };

function Panel({ id, title, icon, children, className = "", action }: PanelProps) {
  return (
    <section id={id} className={`dashPanel ${className}`}>
      <div className="dashPanelTitle">
        <h2>
          {icon}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Schedule({ jobs, machines }: { jobs: Job[]; machines: Machine[] }) {
  const scheduled = jobs.filter((job) => !FINISHED.includes(job.status)).slice(0, 4);
  if (!scheduled.length) return <p className="muted">{t("No active jobs are scheduled yet.")}</p>;
  return (
    <div className="schedule">
      {scheduled.map((job) => {
        const machine = machines.find((item) => item.id === job.machine_id);
        return (
          <div className="scheduleRow" key={job.id}>
            <b>{formatDate(job.due_date) || t("Date not set")}</b>
            <div>
              <strong>{job.title}</strong>
              <span>{machine ? machine.name : job.description}</span>
              <i>{t(job.status)}</i>
              <small>
                <MapPin size={10} /> {job.location || t("Site not set")}
              </small>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RecentWork({ jobs }: { jobs: Job[] }) {
  const items = jobs.filter((job) => job.status === "Completed").slice(0, 4);
  if (!items.length) return <p className="muted">{t("Completed jobs will appear here.")}</p>;
  return (
    <div className="recentWork">
      {items.map((job) => (
        <div key={job.id}>
          <div>
            <strong>{job.title}</strong>
            <span>{job.description || t("Completed service")}</span>
          </div>
          <small>{formatDate(job.due_date) || t("Date not recorded")}</small>
          <em>● {t("Completed")}</em>
        </div>
      ))}
    </div>
  );
}

function MachineHistory({ machine, records }: { machine: Machine | null; records: ServiceRecord[] }) {
  const items = records.slice(0, 4);
  return (
    <>
      {!machine ? (
        <p className="muted">{t("Equipment details will appear once you have a job or service record on a piece of equipment.")}</p>
      ) : (
        <div className="machineSummary">
          <div className="machineImage">
            <Wrench size={34} />
          </div>
          <div>
            <strong>{machine.name}</strong>
            <span>
              {t("Model")} &nbsp; {machine.model || t("Not recorded")}
            </span>
            <span>
              {t("Serial number")} &nbsp; {machine.serial_no}
            </span>
            <span>
              {t("Status")} &nbsp; {t(machine.status)}
            </span>
            <span>
              {t("Service records")} &nbsp; {records.length}
            </span>
          </div>
          <aside>
            <b>{t("Latest service")}</b>
            <span>{items[0]?.service_type || t("No service yet")}</span>
            <span>{formatDate(items[0]?.service_date) || t("Date not recorded")}</span>
            <span>
              {t("Parts replaced")} <strong>{items.filter((record) => record.parts_replaced).length}</strong>
            </span>
          </aside>
        </div>
      )}
      {items.length ? (
        <div className="historyRows">
          <b>{t("Date")}</b>
          <b>{t("Service type")}</b>
          <b>{t("Problem / work summary")}</b>
          <b>{t("Parts replaced")}</b>
          {items.map((record) => (
            <div key={record.id}>
              <span>{formatDate(record.service_date) || t("Not recorded")}</span>
              <span>{record.service_type}</span>
              <span>{record.work_done || record.problem || t("No summary recorded")}</span>
              <span>{record.parts_replaced || t("None recorded")}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">{t("No service records have been saved yet.")}</p>
      )}
    </>
  );
}

function Review({ reviews }: { reviews: CustomerReview[] }) {
  const review = reviews[0];
  if (!review) return <p className="muted">{t("Customer feedback will appear here after a review is submitted.")}</p>;
  const stars = review.rating;
  return (
    <div className="reviewContent">
      <div className="stars">
        {"★".repeat(stars)}
        {"☆".repeat(5 - stars)} <b>{review.rating}/5</b>
      </div>
      <small>{formatDay(review.created_at) || t("Date not recorded")}</small>
      <blockquote>{review.comment || t("No written comment was provided.")}</blockquote>
      {review.advice && (
        <>
          <strong className="reviewAdviceLabel">{t("Advice or request for the next visit")}</strong>
          <p>{review.advice}</p>
        </>
      )}
    </div>
  );
}

function Advice({ service }: { service: ServiceRecord | null }) {
  if (!service || (!service.advice && !service.solution)) {
    return <p className="muted">{t("Advice and follow-up notes will appear after a service record is saved.")}</p>;
  }
  return (
    <div className="adviceContent">
      <small>{formatDate(service.service_date) || t("Latest service")}</small>
      <h3>{service.advice || t("No follow-up advice recorded")}</h3>
      {service.solution && <p>{service.solution}</p>}
      {service.parts_replaced && (
        <div className="tip">
          <Wrench size={15} /> {t("Parts recorded: {parts}", { parts: service.parts_replaced })}
        </div>
      )}
    </div>
  );
}
