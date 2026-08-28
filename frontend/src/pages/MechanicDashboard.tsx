import { useEffect, useState } from "react";
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
  updateJob,
} from "../services/api";
import Modal from "../components/Modal";

type Props = { u: any };
const fallbackMachine = {
  name: "Generator G-102",
  model: "CAT XQ200",
  serial_no: "G102-88421",
  status: "Operational",
};

export default function MechanicDashboard({ u }: Props) {
  const [jobList, setJobList] = useState<any[]>([]),
    [serviceList, setServiceList] = useState<any[]>([]),
    [machineList, setMachineList] = useState<any[]>([]),
    [modal, setModal] = useState<any>(null);
  const load = () =>
    Promise.all([jobs(), services(), machines()])
      .then(([jobData, serviceData, machineData]) => {
        setJobList(jobData.jobs || []);
        setServiceList(serviceData.records || []);
        setMachineList(machineData.machines || []);
      })
      .catch(() => {});
  useEffect(() => {
    load();
  }, []);
  const machine = machineList[0] || fallbackMachine;
  const completed = jobList.filter((job) => job.status === "Completed").length;
  const pendingJobs = jobList.filter((job) => job.status !== "Completed");
  const change = async (id: number, status: string) => {
    await updateJob(id, { status });
    load();
  };
  const submit = async (event: any) => {
    event.preventDefault();
    await createService(Object.fromEntries(new FormData(event.currentTarget)));
    setModal(null);
    load();
  };
  return (
    <div className="mechanicDashboard" id="dashboard-top">
      <div className="dashHeading">
        <div>
          <span className="eyebrow">SERVICE MANAGEMENT SYSTEM</span>
          <h1>Good morning, {u.name.split(" ")[0]}</h1>
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
          number={machineList.length}
          label="Machines"
          detail="Assigned to you"
        />
        <Kpi
          icon={<Star />}
          color="violet"
          number="4.8"
          label="Rating"
          detail="From 96 reviews"
        />
      </div>
      <section id="my-jobs" className="pendingPanel">
        <div className="dashPanelTitle">
          <h2>
            <FileText size={14} /> My Pending Work
          </h2>
          <span className="pendingCount">{pendingJobs.length} open</span>
        </div>
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
                  {job.due_date || "Not set"}
                </small>
              </div>
              <div className="pendingActions">
                {job.status === "Pending" && (
                  <button
                    className="primary"
                    onClick={() => change(job.id, "Accepted")}
                  >
                    Accept
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
                    <button className="secondary" onClick={() => setModal(job)}>
                      Add record
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
          <Schedule />
        </Panel>
        <Panel title="Recent Work" icon={<FileText />} className="recentPanel">
          <RecentWork jobs={jobList} />
        </Panel>
        <Panel title="Machine History" icon={<Wrench />} className="historyPanel" action={<span className="operational">Operational</span>}>
          <MachineHistory machine={machine} records={serviceList} />
          <button className="blueAction" onClick={() => setModal({})}><Plus size={14} /> New Service Record</button>
        </Panel>
        <Panel id="customer-review" title="Latest Customer Feedback" icon={<Star />} className="reviewPanel">
          <Review />
        </Panel>
        <Panel title="Advice & Follow-up" icon={<Wrench />} className="advicePanel">
          <Advice />
        </Panel>
        <Panel title="Documents" icon={<FileText />} className="documentsPanel">
          <div className="documentEmpty"><FileText size={20} /><strong>No documents yet</strong><span>Service reports and inspection files will appear here.</span></div>
        </Panel>
      </section>
      {modal && (
        <Modal title="New service record" onClose={() => setModal(null)}>
          <form onSubmit={submit} className="modalForm">
            <input name="service_type" placeholder="Service type" required />
            <input name="work_done" placeholder="Work performed" required />
            <input name="parts_replaced" placeholder="Parts replaced" />
            <input name="solution" placeholder="Solution or advice" />
            <button className="primary">Save Service</button>
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
function Schedule() {
  return (
    <div className="schedule">
      <ScheduleRow
        time="09:00 AM"
        customer="ABC Engineering"
        machine="Generator G-102"
        city="Nairobi"
      />
      <ScheduleRow
        time="02:00 PM"
        customer="Kenya Motors"
        machine="Air Compressor C-44"
        city="Nairobi"
      />
      <ScheduleRow
        time="06:00 PM"
        customer="XYZ Factory"
        machine="Hydraulic Pump H-21"
        city="Kiambu"
      />
    </div>
  );
}
function ScheduleRow({ time, customer, machine, city }: any) {
  return (
    <div className="scheduleRow">
      <b>{time}</b>
      <div>
        <strong>{customer}</strong>
        <span>{machine}</span>
        <i>CONFIRMED</i>
        <small>
          <MapPin size={10} /> {city}
        </small>
      </div>
    </div>
  );
}
function RecentWork({ jobs }: any) {
  const items = jobs.length
    ? jobs.slice(0, 4)
    : [
        { title: "ABC Engineering", description: "Generator G-102" },
        { title: "Kenya Motors", description: "Air Compressor C-44" },
        { title: "XYZ Factory", description: "Hydraulic Pump H-21" },
      ];
  return (
    <div className="recentWork">
      {items.map((job: any, i: number) => (
        <div key={job.id || i}>
          <div>
            <strong>{job.title || "Service visit"}</strong>
            <span>{job.description || "Completed service"}</span>
          </div>
          <small>{25 - i * 7} Aug 2026</small>
          <em>● Completed</em>
        </div>
      ))}
      <button className="textAction">View All Work History</button>
    </div>
  );
}
function MachineHistory({ machine, records }: any) {
  const items = records.length
    ? records.slice(0, 4)
    : [
        { service_type: "Repair", work_done: "Overheating after 2 hours." },
        { service_type: "Repair", work_done: "Leaking radiator hose." },
        { service_type: "Maintenance", work_done: "Routine service done." },
      ];
  return (
    <>
      <div className="machineSummary">
        <div className="machineImage">
          <Wrench size={34} />
        </div>
        <div>
          <strong>{machine.name}</strong>
          <span>Customer &nbsp; ABC Engineering</span>
          <span>Model &nbsp; {machine.model}</span>
          <span>Serial No. &nbsp; {machine.serial_no}</span>
          <span>Total Services &nbsp; {records.length || 8}</span>
          <span>Last Service &nbsp; 25 Aug 2026</span>
        </div>
        <aside>
          <b>Quick Stats</b>
          <span>
            Repairs <strong>4</strong>
          </span>
          <span>
            Parts Replaced <strong>12</strong>
          </span>
          <span>
            First Service <strong>18 Nov 2025</strong>
          </span>
        </aside>
      </div>
      <div className="historyRows">
        <b>Date</b>
        <b>Service Type</b>
        <b>Problem / Work Summary</b>
        <b>Parts Replaced</b>
        {items.map((record: any, index: number) => (
          <div key={record.id || index}>
            <span>{25 - index * 11} Aug 2026</span>
            <span>{record.service_type}</span>
            <span>{record.work_done}</span>
            <span>
              Thermostat x1 <strong>★★★★★</strong>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
function Review() {
  return (
    <div className="reviewContent">
      <div className="stars">
        ★★★★★ <b>5.0</b>
      </div>
      <small>25 Aug 2026</small>
      <blockquote>
        “Mitch explained the problem clearly and fixed it quickly. Very
        professional and friendly.”
      </blockquote>
      <label>Advice / Request for Next Visit</label>
      <p>Please check the radiator again during the next service.</p>
    </div>
  );
}
function Advice() {
  return (
    <div className="adviceContent">
      <small>25 Aug 2026</small>
      <h3>Check coolant level weekly.</h3>
      <p>
        Inspect radiator every 3 months.
        <br />
        Monitor operating temperature.
      </p>
      <div className="tip">
        <Wrench size={15} /> Preventive care keeps every visit shorter.
      </div>
    </div>
  );
}
