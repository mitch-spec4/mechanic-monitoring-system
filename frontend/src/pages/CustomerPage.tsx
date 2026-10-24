import { useState, type FormEvent } from "react";
import { AlertTriangle, ArrowLeft, CalendarClock, CheckCircle2, ClipboardList, FileText, Mail, MapPin, Pencil, Phone, Plus, Repeat, Trash2, Wrench } from "lucide-react";
import { createSite, customerDetail, deleteSite, updateSite } from "../services/api";
import type { CustomerDetail, EquipmentSummary, Machine, Position, Site } from "../services/types";
import { CreateJobModal } from "../components/JobForms";
import { AddMachine, EditMachine } from "../components/MachineForms";
import Modal from "../components/Modal";
import Field from "../components/Field";
import MapPicker from "../components/MapPicker";
import { confirmAction, toast } from "../components/Feedback";
import { errorMessage, formatDate } from "../lib/format";
import { usePolling } from "../lib/usePolling";
import { mark, t } from "../i18n";
import "./JobPage.css";
import "./CustomerPage.css";
import { Loading } from "../components/States";

type Props = { customerId: number; onBack: () => void; onOpenJob: (id: number) => void; onOpenMachine: (id: number) => void };

/** A customer with their sites, all their equipment (the pieces needing work first), and their service history. */
export default function CustomerPage({ customerId, onBack, onOpenJob, onOpenMachine }: Props) {
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState("");
  const [creatingFor, setCreatingFor] = useState<Machine | null>(null);
  const [addingMachine, setAddingMachine] = useState(false);
  const [editing, setEditing] = useState<Machine | null>(null);
  const [site, setSite] = useState<Site | "new" | null>(null);
  const load = () =>
    customerDetail(customerId)
      .then((data) => {
        setCustomer(data.customer);
        setError("");
      })
      .catch((e) => setError(errorMessage(e)));
  usePolling(load, 30000, true);

  if (!customer) {
    return (
      <main className="jobPage customerPage">
        <BackButton onBack={onBack} />
        {error ? <div className="error">{error}</div> : <Loading label={t("Loading customer…")} />}
      </main>
    );
  }

  const machines = customer.machines;
  const needing = customer.needs_work_count;
  return (
    <main className="jobPage customerPage">
      <BackButton onBack={onBack} />
      <section className="jobHero" aria-label={t("Customer summary")}>
        <div className="jobHeroTop">
          <span className="eyebrow">{t("Customer")}</span>
          {needing > 0 ? (
            <span className="jobStatusPill needsWorkPill">
              <AlertTriangle size={12} /> {needing === 1 ? t("1 piece of equipment needs work") : t("{count} pieces of equipment need work", { count: needing })}
            </span>
          ) : (
            <span className="jobStatusPill completed">{t("All equipment OK")}</span>
          )}
        </div>
        <h1>{customer.name}</h1>
        <dl className="jobMeta">
          <div>
            <dt>{t("Email")}</dt>
            <dd>
              <Mail size={13} /> {customer.email}
            </dd>
          </div>
          <div>
            <dt>{t("Phone")}</dt>
            <dd>
              <Phone size={13} /> {customer.phone || t("Not recorded")}
            </dd>
          </div>
          <div>
            <dt>{t("Equipment")}</dt>
            <dd>{machines.length}</dd>
          </div>
          <div>
            <dt>{t("Jobs")}</dt>
            <dd>{t("{count} ({completed} completed)", { count: customer.job_count, completed: customer.completed_job_count })}</dd>
          </div>
        </dl>
      </section>

      <div className="jobGrid">
        <section className="jobCard wide">
          <div className="jobCardHead">
            <h2>
              <Wrench size={16} /> {t("Equipment")}
            </h2>
            <button className="primary-sm" onClick={() => setAddingMachine(true)}>
              <Plus size={14} /> {t("Add equipment")}
            </button>
          </div>
          {machines.length === 0 ? (
            <p className="muted jobEmpty">{t("No equipment yet. Add the first piece for this customer.")}</p>
          ) : (
            <ul className="machineCards">
              {machines.map((machine) => (
                <MachineCard
                  key={machine.id}
                  machine={machine}
                  siteName={customer.sites.find((s) => s.id === machine.site_id)?.name}
                  onOpenJob={onOpenJob}
                  onOpenMachine={onOpenMachine}
                  onCreateJob={() => setCreatingFor(machine)}
                  onEdit={() => setEditing(machine)}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="jobCard wide">
          <div className="jobCardHead">
            <h2>
              <MapPin size={16} /> {t("Sites")}
            </h2>
            <button className="primary-sm" onClick={() => setSite("new")}>
              <Plus size={14} /> {t("Add site")}
            </button>
          </div>
          {customer.sites.length === 0 ? (
            <p className="muted jobEmpty">{t("No sites yet. Add the places this customer has equipment, so technicians know where to go.")}</p>
          ) : (
            <ul className="siteList">
              {customer.sites.map((row) => (
                <li key={row.id}>
                  <div>
                    <strong>
                      {row.name}
                      {!row.position && <small className="noPin"> · {t("No pin on the map")}</small>}
                    </strong>
                    {row.address && <span className="siteAddress">{row.address}</span>}
                    {row.notes && <small className="muted">{row.notes}</small>}
                  </div>
                  <span className="jobBadge">{row.machine_count === 1 ? t("1 piece of equipment") : t("{count} pieces of equipment", { count: row.machine_count ?? 0 })}</span>
                  <button className="listAction" onClick={() => setSite(row)} aria-label={t("Edit {name}", { name: row.name })}>
                    <Pencil size={12} /> {t("Edit")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="jobCard wide">
          <div className="jobCardHead">
            <h2>
              <FileText size={16} /> {t("Service history")}
            </h2>
            <span className="jobBadge">{customer.records.length}</span>
          </div>
          {customer.records.length === 0 ? (
            <p className="muted jobEmpty">{t("No service records yet.")}</p>
          ) : (
            <ul className="historyList">
              {customer.records.map((record) => {
                const machine = machines.find((m) => m.id === record.machine_id);
                const jobId = record.job_id;
                return (
                  <li key={record.id}>
                    <span className="historyDate">{formatDate(record.service_date)}</span>
                    <div>
                      {jobId ? (
                        <button className="titleLink" onClick={() => onOpenJob(jobId)}>
                          <strong>{record.service_type}</strong>
                        </button>
                      ) : (
                        <strong>{record.service_type}</strong>
                      )}
                      <span>
                        {machine ? `${machine.name} · ` : ""}
                        {record.work_done || record.problem || t("No summary recorded")}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {creatingFor && (
        <CreateJobModal
          preset={{ customer_id: customer.id, machine_id: creatingFor.id, title: t("Service {name}", { name: creatingFor.name }) }}
          onClose={() => setCreatingFor(null)}
          onCreated={() => {
            setCreatingFor(null);
            load();
          }}
        />
      )}
      {addingMachine && (
        <AddMachine
          customerId={customer.id}
          onClose={() => setAddingMachine(false)}
          onAdded={() => {
            setAddingMachine(false);
            load();
          }}
        />
      )}
      {editing && (
        <EditMachine
          machine={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {site && (
        <SiteForm
          customerId={customer.id}
          site={site === "new" ? null : site}
          onClose={() => setSite(null)}
          onSaved={() => {
            setSite(null);
            load();
          }}
        />
      )}
    </main>
  );
}

/** Add or change one of the customer's sites; a site in use can still be removed (its equipment keeps no site). */
function SiteForm({ customerId, site, onClose, onSaved }: { customerId: number; site: Site | null; onClose: () => void; onSaved: () => void }) {
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState<Position | null>(site?.position ?? null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = { ...Object.fromEntries(new FormData(event.currentTarget)), position };
    setBusy(true);
    setFormError("");
    try {
      if (site) await updateSite(site.id, data);
      else await createSite({ ...data, customer_id: customerId });
      toast(site ? t("Site saved") : t("Site added"));
      onSaved();
    } catch (problem) {
      setFormError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!site) return;
    const ok = await confirmAction({
      title: t("Remove {name}?", { name: site.name }),
      message: site.machine_count ? t("Its equipment stays with the customer, without a site.") : t("Nothing else changes."),
      confirmLabel: t("Remove site"),
      cancelLabel: t("Keep it"),
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteSite(site.id);
      toast(t("Site removed"));
      onSaved();
    } catch (problem) {
      setFormError(errorMessage(problem));
    }
  };
  return (
    <Modal title={site ? t("Edit site") : t("Add site")} icon={<MapPin size={20} />} onClose={onClose}>
      <form className="form form-upgraded" onSubmit={submit}>
        {formError && <div className="error">{formError}</div>}
        <Field label={t("Site name")}>
          <input id="field-site-name" name="name" defaultValue={site?.name ?? ""} placeholder={t("e.g. {example}", { example: t("Head office") })} maxLength={150} required />
        </Field>
        <Field label={t("Address")} optional>
          <input id="field-site-address" name="address" defaultValue={site?.address ?? ""} placeholder={t("e.g. {example}", { example: "Enterprise Road, Industrial Area, Nairobi" })} maxLength={255} />
        </Field>
        <div className="formGroup">
          <span className="fieldTitle">{t("Pin on the map")}</span>
          <small className="muted fieldHint">{t("Where technicians go. Routes are planned from these pins.")}</small>
          <MapPicker value={position} onChange={setPosition} label={t("Map: pin for {name}", { name: site?.name ?? t("the new site") })} />
        </div>
        <Field label={t("Notes")} optional>
          <textarea id="field-site-notes" name="notes" defaultValue={site?.notes ?? ""} placeholder={t("e.g. {example}", { example: t("Gate B, ask for the site manager") })} maxLength={2000} />
        </Field>
        <button className="primary" disabled={busy}>
          {site ? t("Save changes") : t("Add site")}
        </button>
        {site && (
          <button type="button" className="link dangerText" onClick={remove}>
            <Trash2 size={14} /> {t("Remove site")}
          </button>
        )}
      </form>
    </Modal>
  );
}

// The server's words for planned maintenance that's due (see backend/app/services/machine_work.py).
const MAINTENANCE_STATUSES = [mark("Service due"), mark("Overdue")];

type CardProps = {
  machine: EquipmentSummary;
  siteName?: string;
  onOpenJob: (id: number) => void;
  onOpenMachine?: (id: number) => void;
  onCreateJob?: () => void;
  onEdit?: () => void;
};

export function MachineCard({ machine, siteName, onOpenJob, onOpenMachine, onCreateJob, onEdit }: CardProps) {
  const statusClass = String(machine.status).replace(/ /g, "").toLowerCase();
  const faults = machine.repeat_faults ?? 0;
  return (
    <li className={`machineCard ${machine.needs_work ? "needsWork" : ""}`}>
      <div className="machineCardHead">
        <div>
          {onOpenMachine ? (
            <button className="titleLink" onClick={() => onOpenMachine(machine.id)}>
              <strong>{machine.name}</strong>
            </button>
          ) : (
            <strong>{machine.name}</strong>
          )}
          <small>{[machine.equipment_type, machine.model || t("Model not recorded"), machine.serial_no].filter(Boolean).join(" · ")}</small>
          {siteName && (
            <small className="machineSite">
              <MapPin size={11} /> {siteName}
            </small>
          )}
        </div>
        <span className={`machineStatus ${statusClass}`}>{t(machine.status)}</span>
      </div>
      {faults >= 2 && (
        <p className="repeatFault">
          <Repeat size={13} /> {t("Repeat fault: {count} in 90 days", { count: faults })}
        </p>
      )}
      {machine.needs_work ? (
        <ul className="workReasons" aria-label={t("Why {name} needs work", { name: machine.name })}>
          {machine.work.map((reason, index) => (
            <li key={index}>
              {reason.type === "job" ? (
                <>
                  <ClipboardList size={13} />
                  <span>
                    {t("Job:")}{" "}
                    <button className="titleLink reasonLink" onClick={() => onOpenJob(reason.id)}>
                      {reason.title}
                    </button>{" "}
                    <em>{t(reason.status)}</em>
                  </span>
                </>
              ) : reason.type === "request" ? (
                <>
                  <AlertTriangle size={13} />
                  <span>
                    {t("Customer requested service:")} {reason.title} <em>{t(reason.status)}</em>
                  </span>
                </>
              ) : reason.type === "maintenance" ? (
                <>
                  <CalendarClock size={13} />
                  <span>
                    {t("Planned maintenance:")} {reason.title} <em>{t(MAINTENANCE_STATUSES.find((status) => status === reason.status) ?? reason.status)}</em> {formatDate(reason.due)}
                  </span>
                </>
              ) : (
                <>
                  <Wrench size={13} />
                  <span>{t("Status: {status}", { status: t(reason.status) })}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="machineOk">
          <CheckCircle2 size={13} /> {machine.status === "Retired" ? t("Retired") : t("No work needed")}
        </p>
      )}
      <div className="machineCardActions">
        {onCreateJob && machine.status !== "Retired" && (
          <button className="listAction" onClick={onCreateJob}>
            <Plus size={12} /> {t("Create job")}
          </button>
        )}
        {onEdit && (
          <button className="listAction" onClick={onEdit}>
            <Pencil size={12} /> {t("Edit")}
          </button>
        )}
      </div>
    </li>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button className="link jobBack" onClick={onBack}>
      <ArrowLeft size={15} /> {t("Back")}
    </button>
  );
}
