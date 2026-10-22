import { useState } from "react";
import {
  CheckCircle2,
  FileText,
  MapPin,
  Plus,
  Star,
  Wrench,
} from "lucide-react";
import {
  createService,
  jobs,
  machines,
  services,
  reviews as fetchReviews,
  updateJob,
} from "../services/api";
import Modal from "../components/Modal";
import { errorMessage, formatDate, greeting } from "../lib/format";
import { usePolling } from "../lib/usePolling";

type Props = { u: any };

export default function MechanicDashboard({ u }: Props) {
  const [jobList, setJobList] = useState<any[]>([]),
    [serviceList, setServiceList] = useState<any[]>([]),
    [machineList, setMachineList] = useState<any[]>([]),
    [reviewList, setReviewList] = useState<any[]>([]),
    [modal, setModal] = useState<any>(null),
    [actionError, setActionError] = useState(""),
    [formError, setFormError] = useState("");
  const load = () =>
    Promise.all([jobs(), services(), machines(), fetchReviews()])
      .then(([jobData, serviceData, machineData, reviewData]) => {
        setJobList(jobData.jobs || []);
        setServiceList(serviceData.records || []);
        setMachineList(machineData.machines || []);
        setReviewList(reviewData.reviews || []);
      })
      .catch(() => {});
  usePolling(load, 30000);
  const activeJobs = jobList.filter((job) => !["Completed", "Cancelled"].includes(job.status));
  // Machines this mechanic works on: from their jobs and their own service records.
  const myMachineIds = new Set<number>([
    ...jobList.map((job) => job.machine_id),
    ...serviceList.map((record) => record.machine_id),
  ].filter(Boolean));
  const myMachines = machineList.filter((item) => myMachineIds.has(item.id));
  // Service records can only be added for machines on the mechanic's own (non-cancelled) jobs.
  const jobMachineIds = new Set(jobList.filter((job) => job.status !== "Cancelled").map((job) => job.machine_id));
  const recordMachines = machineList.filter((item) => jobMachineIds.has(item.id));
  const focusMachineId = activeJobs.find((job) => job.machine_id)?.machine_id ?? serviceList[0]?.machine_id;
  const machine = machineList.find((item) => item.id === focusMachineId) || null;
  const machineRecords = machine ? serviceList.filter((record) => record.machine_id === machine.id) : [];
  const completed = jobList.filter((job) => job.status === "Completed").length;
  const ratingAverage = reviewList.length
    ? (reviewList.reduce((total, review) => total + Number(review.rating || 0), 0) / reviewList.length).toFixed(1)
    : "—";
  const latestService = serviceList[0] || null;
  const pendingJobs = activeJobs;
  const change = async (id: number, status: string) => {
    setActionError("");
    try {
      await updateJob(id, { status });
    } catch (error) {
      setActionError(errorMessage(error));
    }
    load();
  };
  const openRecord = (job: any) => {
    setFormError("");
    setModal(job);
  };
  const submit = async (event: any) => {
    event.preventDefault();
    setFormError("");
    try {
      await createService(Object.fromEntries(new FormData(event.currentTarget)));
      setModal(null);
      load();
    } catch (error) {
      setFormError(errorMessage(error));
    }
  };
  return (
    <div className="mechanicDashboard" id="dashboard-top">
      <div className="dashHeading">
        <div>
          <span className="eyebrow">SERVICE MANAGEMENT SYSTEM</span>
          <h1>{greeting()}, {u.name.split(" ")[0]}</h1>
          <p className="dashSubhead">
            Here is the work that still needs your attention.
          </p>
        </div>
      </div>
      <div className="kpiGrid">
        <Kpi
          icon={<FileText />}
          color="blue"
          number={pendingJobs.length}
          label="Pending Work"
          detail="Needs attention"
        />
        <Kpi
          icon={<CheckCircle2 />}
          color="green"
          number={completed}
          label="Completed"
          detail="Total all time"
        />
        <Kpi
          icon={<Wrench />}
          color="amber"
          number={myMachines.length}
          label="Machines"
          detail="Assigned to you"
        />
        <Kpi
          icon={<Star />}
          color="violet"
          number={ratingAverage}
          label="Rating"
          detail={`From ${reviewList.length} reviews`}
        />
      </div>
      <section id="my-jobs" className="pendingPanel">
        <div className="dashPanelTitle">
          <h2>
            <FileText size={14} /> My Pending Work
          </h2>
          <span className="pendingCount">{pendingJobs.length} open</span>
        </div>
        {actionError && <div className="error">{actionError}</div>}
        {pendingJobs.length === 0 ? (
          <div className="emptyPending">
            <CheckCircle2 size={24} />
            <strong>All caught up</strong>
            <span>No pending jobs right now.</span>
          </div>
        ) : (
          pendingJobs.map((job) => (
            <article className="pendingJob" key={job.id}>
              <div>
                <div className="jobTitle">
                  <strong>{job.title}</strong>
                  <span
                    className={`jobStatus ${String(job.status).replace(/ /g, "").toLowerCase()}`}
                  >
                    {job.status}
                  </span>
                </div>
                <p>{job.description}</p>
                <small>
                  <MapPin size={11} /> {job.location || "No location"} · Due{" "}
                  {formatDate(job.due_date) || "Not set"}
                </small>
              </div>
              <div className="pendingActions">
                {job.status === "Assigned" && (
                  <>
                    <button className="secondary" onClick={() => change(job.id, "Accepted")}>
                      Accept
                    </button>
                    <button className="primary" onClick={() => change(job.id, "In Progress")}>
                      Start work
                    </button>
                  </>
                )}
                {job.status === "Paused" && (
                  <button className="primary" onClick={() => change(job.id, "In Progress")}>
                    Resume
                  </button>
                )}
                {job.status === "Accepted" && (
                  <button
                    className="primary"
                    onClick={() => change(job.id, "In Progress")}
                  >
                    Start work
                  </button>
                )}
                {job.status === "In Progress" && (
                  <>
                    <button className="secondary" onClick={() => openRecord(job)}>
                      Add record
                    </button>
                    <button className="secondary" onClick={() => change(job.id, "Paused")}>
                      Pause
                    </button>
                    <button
                      className="primary"
                      onClick={() => change(job.id, "Completed")}
                    >
                      Complete
                    </button>
                  </>
                )}
              </div>
            </article>
          ))
        )}
      </section>
      <section className="dashboardGrid">
        <Panel title="Today's Schedule" icon={<MapPin />} className="schedulePanel">
          <Schedule jobs={jobList} machines={machineList} />
        </Panel>
        <Panel title="Recent Work" icon={<FileText />} className="recentPanel">
          <RecentWork jobs={jobList} />
        </Panel>
        <Panel title="Machine History" icon={<Wrench />} className="historyPanel" action={machine && <span className="operational">{machine.status}</span>}>
          <MachineHistory machine={machine} records={machineRecords} />
          <button className="blueAction" onClick={() => openRecord({})}><Plus size={14} /> New Service Record</button>
        </Panel>
        <Panel id="customer-review" title="Latest Customer Feedback" icon={<Star />} className="reviewPanel">
          <Review reviews={reviewList} />
        </Panel>
        <Panel title="Advice & Follow-up" icon={<Wrench />} className="advicePanel">
          <Advice service={latestService} />
        </Panel>
        <Panel title="Documents" icon={<FileText />} className="documentsPanel">
          <div className="documentEmpty"><FileText size={20} /><strong>No documents yet</strong><span>Service reports and inspection files will appear here.</span></div>
        </Panel>
      </section>
      {modal && (
        <Modal title="New service record" onClose={() => setModal(null)}>
          <form onSubmit={submit} className="modalForm">
            {formError && <div className="error">{formError}</div>}
            <select name="machine_id" defaultValue={modal?.machine_id || ""} required>
              <option value="">Select machine</option>
              {recordMachines.map((item) => (
                <option key={item.id} value={item.id}>{item.name} ({item.serial_no})</option>
              ))}
            </select>
            <input name="service_type" placeholder="Service type" required />
            <input name="problem" placeholder="Problem found" />
            <input name="work_done" placeholder="Work performed" required />
            <input name="parts_replaced" placeholder="Parts replaced" />
            <input name="solution" placeholder="Solution" />
            <input name="advice" placeholder="Advice / follow-up" />
            <button className="primary" disabled={recordMachines.length === 0}>Save Service</button>
            {recordMachines.length === 0 && <p className="muted">None of your jobs has a machine yet. Ask your manager to link a machine to your job.</p>}
          </form>
        </Modal>
      )}
    </div>
  );
}
function Kpi({ icon, color, number, label, detail }: any) {
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
function Panel({ id, title, icon, children, className = "", action }: any) {
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
function Schedule({ jobs, machines }: any) {
  const scheduled = jobs.filter((job: any) => !["Completed", "Cancelled"].includes(job.status)).slice(0, 4);
  if (!scheduled.length) return <p className="muted">No active jobs are scheduled yet.</p>;
  return (
    <div className="schedule">
      {scheduled.map((job: any) => {
        const machine = machines.find((item: any) => item.id === job.machine_id);
        return (
          <div className="scheduleRow" key={job.id}>
            <b>{formatDate(job.due_date) || "Date not set"}</b>
            <div>
              <strong>{job.title}</strong>
              <span>{machine ? machine.name : job.description}</span>
              <i>{job.status}</i>
              <small><MapPin size={10} /> {job.location || "Location not set"}</small>
            </div>
          </div>
        );
      })}
    </div>
  );
}
function RecentWork({ jobs }: any) {
  const items = jobs.filter((job: any) => job.status === "Completed").slice(0, 4);
  if (!items.length) return <p className="muted">Completed jobs will appear here.</p>;
  return (
    <div className="recentWork">
      {items.map((job: any) => (
        <div key={job.id}>
          <div>
            <strong>{job.title}</strong>
            <span>{job.description || "Completed service"}</span>
          </div>
          <small>{formatDate(job.due_date) || "Date not recorded"}</small>
          <em>● Completed</em>
        </div>
      ))}
    </div>
  );
}
function MachineHistory({ machine, records }: any) {
  const items = records.slice(0, 4);
  return (
    <>
      {!machine ? (
        <p className="muted">Machine details will appear once you have a job or service record on a machine.</p>
      ) : (
        <div className="machineSummary">
          <div className="machineImage"><Wrench size={34} /></div>
          <div>
            <strong>{machine.name}</strong>
            <span>Model &nbsp; {machine.model || "Not recorded"}</span>
            <span>Serial No. &nbsp; {machine.serial_no}</span>
            <span>Status &nbsp; {machine.status}</span>
            <span>Service records &nbsp; {records.length}</span>
          </div>
          <aside>
            <b>Latest service</b>
            <span>{items[0]?.service_type || "No service yet"}</span>
            <span>{items[0]?.service_date ? new Date(items[0].service_date).toLocaleDateString() : "Date not recorded"}</span>
            <span>Parts replaced <strong>{items.filter((record: any) => record.parts_replaced).length}</strong></span>
          </aside>
        </div>
      )}
      {items.length ? (
        <div className="historyRows">
          <b>Date</b><b>Service Type</b><b>Problem / Work Summary</b><b>Parts Replaced</b>
          {items.map((record: any) => (
            <div key={record.id}>
              <span>{record.service_date ? new Date(record.service_date).toLocaleDateString() : "Not recorded"}</span>
              <span>{record.service_type}</span>
              <span>{record.work_done || record.problem || "No summary recorded"}</span>
              <span>{record.parts_replaced || "None recorded"}</span>
            </div>
          ))}
        </div>
      ) : <p className="muted">No service records have been saved yet.</p>}
    </>
  );
}
function Review({ reviews }: any) {
  const review = reviews[0];
  if (!review) return <p className="muted">Customer feedback will appear here after a review is submitted.</p>;
  return (
    <div className="reviewContent">
      <div className="stars">{"★".repeat(Number(review.rating) || 0)}{"☆".repeat(5 - (Number(review.rating) || 0))} <b>{review.rating}/5</b></div>
      <small>{review.created_at ? new Date(review.created_at).toLocaleDateString() : "Date not recorded"}</small>
      <blockquote>{review.comment || "No written comment was provided."}</blockquote>
      {review.advice && <><label>Advice / Request for Next Visit</label><p>{review.advice}</p></>}
    </div>
  );
}
function Advice({ service }: any) {
  if (!service || (!service.advice && !service.solution)) {
    return <p className="muted">Advice and follow-up notes will appear after a service record is saved.</p>;
  }
  return (
    <div className="adviceContent">
      <small>{service.service_date ? new Date(service.service_date).toLocaleDateString() : "Latest service"}</small>
      <h3>{service.advice || "No follow-up advice recorded"}</h3>
      {service.solution && <p>{service.solution}</p>}
      {service.parts_replaced && <div className="tip"><Wrench size={15} /> Parts recorded: {service.parts_replaced}</div>}
    </div>
  );
}
