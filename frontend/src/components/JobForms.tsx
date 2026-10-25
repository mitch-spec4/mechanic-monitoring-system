import { useEffect, useState, type FormEvent } from "react";
import Modal from "./Modal";
import { catalog, checklists, createJob, customers, machines, mechanics } from "../services/api";
import type { CatalogService, Customer, Machine, Mechanic } from "../services/types";
import { errorMessage } from "../lib/format";
import { PRIORITIES } from "../lib/labels";
import { t } from "../i18n";
import Field from "./Field";

type JobTypeProps = { types: string[]; value?: string | null; id?: string; "aria-describedby"?: string };

export function JobTypeSelect({ types, value, ...control }: JobTypeProps) {
  // Keep a job's existing type selectable even if its checklist was since deleted.
  const options = value && !types.includes(value) ? [...types, value] : types;
  return (
    <select name="job_type" defaultValue={value || ""} {...control}>
      <option value="">{t("General job (no checklist)")}</option>
      {options.map((type) => (
        <option key={type} value={type}>
          {type}
        </option>
      ))}
    </select>
  );
}

type Preset = { customer_id?: number; machine_id?: number; title?: string; description?: string };

/** Services that fit a piece of equipment: for its type, or for any equipment. */
export function servicesFor(services: CatalogService[], machine?: Pick<Machine, "equipment_type"> | null) {
  const kind = (machine?.equipment_type || "").trim().toLowerCase();
  return services.filter((service) => service.active && (!service.equipment_type || !machine || service.equipment_type.trim().toLowerCase() === kind));
}

/** The manager's "Create service job" form. A preset fills in the customer and equipment; a
 *  service from the catalog fills in the title, description, checklist and time. */
export function CreateJobModal({ preset = {}, onClose, onCreated }: { preset?: Preset; onClose: () => void; onCreated: () => void }) {
  const [customerList, setCustomerList] = useState<Customer[]>([]);
  const [mechanicList, setMechanicList] = useState<Mechanic[]>([]);
  const [machineList, setMachineList] = useState<Machine[]>([]);
  const [jobTypes, setJobTypes] = useState<string[]>([]);
  const [serviceList, setServiceList] = useState<CatalogService[]>([]);
  const [customerId, setCustomerId] = useState(preset.customer_id ? String(preset.customer_id) : "");
  const [machineId, setMachineId] = useState(preset.machine_id ? String(preset.machine_id) : "");
  const [serviceId, setServiceId] = useState("");
  const [title, setTitle] = useState(preset.title ?? "");
  const [description, setDescription] = useState(preset.description ?? "");
  const [jobType, setJobType] = useState("");
  const [minutes, setMinutes] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([customers(), mechanics(), machines(), checklists(), catalog()])
      .then(([c, m, mc, cl, sv]) => {
        setCustomerList(c.customers);
        setMechanicList(m.mechanics);
        setMachineList(mc.machines);
        setJobTypes(cl.checklists.map((template) => template.job_type));
        setServiceList(sv.services);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const customerMachines = machineList.filter((m) => !customerId || String(m.customer_id) === customerId);
  const offered = servicesFor(serviceList, machineList.find((m) => String(m.id) === machineId));
  const pickService = (id: string) => {
    setServiceId(id);
    const service = serviceList.find((s) => String(s.id) === id);
    if (!service) return;
    setTitle(service.name);
    setDescription(service.description || service.name);
    setJobType(service.checklist?.job_type ?? "");
    setMinutes(String(service.duration_minutes));
  };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
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
    <Modal title={t("Create service job")} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        {error && <div className="error">{error}</div>}
        {offered.length > 0 && (
          <Field label={t("Start from a service")} optional hint={t("Fills in the title, description, checklist and time.")}>
            <select id="field-service" name="service_id" value={serviceId} onChange={(e) => pickService(e.target.value)}>
              <option value="">{t("No service")}</option>
              {offered.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t("Job title")}>
          <input name="title" placeholder={t("Job title")} value={title} onChange={(e) => setTitle(e.target.value)} required />
        </Field>
        <Field label={t("Problem / job description")}>
          <textarea name="description" placeholder={t("Problem / job description")} value={description} onChange={(e) => setDescription(e.target.value)} required />
        </Field>
        <div className="row">
          <Field label={t("Customer")}>
            <select
              name="customer_id"
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                setMachineId("");
              }}
            >
              <option value="">{t("Customer")}</option>
              {customerList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("Technician")}>
            <select name="mechanic_id">
              <option value="">{t("Assign technician")}</option>
              {mechanicList.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="row">
          <Field label={t("Priority")}>
            <select name="priority" defaultValue="Medium">
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {t(priority)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("Site")} optional>
            <input name="location" placeholder={t("Site")} />
          </Field>
        </div>
        <div className="row">
          <Field label={t("Equipment")}>
            <select name="machine_id" value={machineId} onChange={(e) => setMachineId(e.target.value)}>
              <option value="">{t("Equipment (optional)")}</option>
              {customerMachines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.serial_no})
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("Due date")} optional>
            <input name="due_date" type="date" />
          </Field>
        </div>
        <div className="row">
          <Field label={t("Job type")}>
            <JobTypeSelect key={serviceId} types={jobTypes} value={jobType} />
          </Field>
          <Field label={t("Estimated time (minutes)")} optional>
            <input name="estimated_minutes" type="number" min={5} max={1440} step={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </Field>
        </div>
        <button className="primary">{t("Create & notify technician")}</button>
      </form>
    </Modal>
  );
}
