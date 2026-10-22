import { useEffect, useState } from "react";
import Modal from "./Modal";
import { checklists, createJob, customers, machines, mechanics } from "../services/api";
import { errorMessage } from "../lib/format";

export function JobTypeSelect({ types, value }: { types: string[]; value?: string | null }) {
  // Keep a job's existing type selectable even if its checklist was since deleted.
  const options = value && !types.includes(value) ? [...types, value] : types;
  return (
    <select name="job_type" defaultValue={value || ""} aria-label="Job type">
      <option value="">General job (no checklist)</option>
      {options.map((type) => (
        <option key={type} value={type}>
          {type}
        </option>
      ))}
    </select>
  );
}

type Preset = { customer_id?: number; machine_id?: number; title?: string; description?: string };

/** The manager's "Create service job" form. A preset fills in the customer and machine. */
export function CreateJobModal({ preset = {}, onClose, onCreated }: { preset?: Preset; onClose: () => void; onCreated: () => void }) {
  const [customerList, setCustomerList] = useState<any[]>([]);
  const [mechanicList, setMechanicList] = useState<any[]>([]);
  const [machineList, setMachineList] = useState<any[]>([]);
  const [jobTypes, setJobTypes] = useState<string[]>([]);
  const [customerId, setCustomerId] = useState(preset.customer_id ? String(preset.customer_id) : "");
  const [machineId, setMachineId] = useState(preset.machine_id ? String(preset.machine_id) : "");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([customers(), mechanics(), machines(), checklists()])
      .then(([c, m, mc, cl]) => {
        setCustomerList(c.customers);
        setMechanicList(m.mechanics);
        setMachineList(mc.machines);
        setJobTypes(cl.checklists.map((template: any) => template.job_type));
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const customerMachines = machineList.filter((m) => !customerId || String(m.customer_id) === customerId);
  const submit = async (e: any) => {
    e.preventDefault();
    setError("");
    try {
      await createJob(Object.fromEntries(new FormData(e.currentTarget)));
      onCreated();
    } catch (problem) {
      setError(errorMessage(problem));
    }
  };

  return (
    <Modal title="Create service job" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        {error && <div className="error">{error}</div>}
        <input name="title" placeholder="Job title" defaultValue={preset.title} required />
        <textarea name="description" placeholder="Problem / job description" defaultValue={preset.description} required />
        <div className="row">
          <select
            name="customer_id"
            value={customerId}
            onChange={(e) => {
              setCustomerId(e.target.value);
              setMachineId("");
            }}
          >
            <option value="">Customer</option>
            {customerList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select name="mechanic_id">
            <option value="">Assign mechanic</option>
            {mechanicList.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <select name="priority" defaultValue="Medium">
            <option>Low</option>
            <option>Medium</option>
            <option>High</option>
            <option>Urgent</option>
          </select>
          <input name="location" placeholder="Job site" />
        </div>
        <div className="row">
          <select name="machine_id" value={machineId} onChange={(e) => setMachineId(e.target.value)}>
            <option value="">Machine (optional)</option>
            {customerMachines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.serial_no})
              </option>
            ))}
          </select>
          <input name="due_date" type="date" aria-label="Due date" title="Due date" />
        </div>
        <JobTypeSelect types={jobTypes} />
        <button className="primary">Create & notify mechanic</button>
      </form>
    </Modal>
  );
}
