import { useEffect, useState } from "react";
import { X, Package, Briefcase, CheckCircle2 } from "lucide-react";
import { machines, jobs, services } from "../services/api";

type Props = { customer: any; onClose: () => void };

export default function CustomerProfile({ customer, onClose }: Props) {
  const [machinesData, setMachinesData] = useState<any[]>([]);
  const [jobsData, setJobsData] = useState<any[]>([]);
  const [servicesData, setServicesData] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([machines(), jobs(), services()])
      .then(([m, j, s]) => {
        const customerMachines = m.machines.filter((x: any) => x.customer_id === customer.id);
        const customerJobs = j.jobs.filter((x: any) => x.customer_id === customer.id);
        const customerServices = s.records.filter((x: any) => x.customer_id === customer.id);
        setMachinesData(customerMachines);
        setJobsData(customerJobs);
        setServicesData(customerServices);
      })
      .catch(() => {});
  }, [customer.id]);

  const completed = jobsData.filter((x) => x.status === "Completed").length;

  return (
    <div className="modal" onClick={onClose}>
      <div className="modalContent" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <h2>Customer Profile</h2>
          <button className="closeBtn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="profileView">
          <div className="profileHeader">
            <div className="avatarLarge">{customer.name[0]}</div>
            <div>
              <h3>{customer.name}</h3>
              <p>{customer.email}</p>
            </div>
          </div>

          <div className="profileStats">
            <div className="statCard">
              <Package size={20} />
              <div>
                <strong>{machinesData.length}</strong>
                <span>Machines</span>
              </div>
            </div>
            <div className="statCard">
              <Briefcase size={20} />
              <div>
                <strong>{jobsData.length}</strong>
                <span>Service jobs</span>
              </div>
            </div>
            <div className="statCard">
              <CheckCircle2 size={20} />
              <div>
                <strong>{completed}</strong>
                <span>Completed</span>
              </div>
            </div>
          </div>

          {machinesData.length > 0 && (
            <div className="profileSection">
              <h4>Equipment</h4>
              <div className="machinesList">
                {machinesData.map((m) => (
                  <div key={m.id} className="machineItem">
                    <div>
                      <b>{m.name}</b>
                      <small>{m.model || "Unknown model"}</small>
                    </div>
                    <span className={`status ${m.status.replace(/ /g, "").toLowerCase()}`}>
                      {m.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {servicesData.length > 0 && (
            <div className="profileSection">
              <h4>Service history</h4>
              <div className="servicesList">
                {servicesData.slice(0, 5).map((s) => (
                  <div key={s.id} className="serviceItem">
                    <div>
                      <b>{s.service_type}</b>
                      <small>{s.problem || s.work_done || "Service completed"}</small>
                    </div>
                    <small>{new Date(s.service_date).toLocaleDateString()}</small>
                  </div>
                ))}
              </div>
            </div>
          )}

          {jobsData.length > 0 && (
            <div className="profileSection">
              <h4>Recent jobs</h4>
              <div className="jobsList">
                {jobsData.slice(0, 5).map((j) => (
                  <div key={j.id} className="jobItem">
                    <div>
                      <b>{j.title}</b>
                      <small>{j.location || "No location"}</small>
                    </div>
                    <span className={`status ${j.status.replace(/ /g, "").toLowerCase()}`}>
                      {j.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
