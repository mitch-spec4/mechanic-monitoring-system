import { useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardList, FileText, Mail, Pencil, Phone, Plus, Wrench } from "lucide-react";
import { customerDetail } from "../services/api";
import type { CustomerDetail, EquipmentSummary, Machine } from "../services/types";
import { CreateJobModal } from "../components/JobForms";
import { AddMachine, EditMachine } from "../components/MachineForms";
import { errorMessage, formatDate } from "../lib/format";
import { usePolling } from "../lib/usePolling";
import { t } from "../i18n";
import "./JobPage.css";
import "./CustomerPage.css";
import { Loading } from "../components/States";

type Props = { customerId: number; onBack: () => void; onOpenJob: (id: number) => void };

/** A customer with all their equipment, the pieces needing work first, and their service history. */
export default function CustomerPage({ customerId, onBack, onOpenJob }: Props) {
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState("");
  const [creatingFor, setCreatingFor] = useState<Machine | null>(null);
  const [addingMachine, setAddingMachine] = useState(false);
  const [editing, setEditing] = useState<Machine | null>(null);
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
                  onOpenJob={onOpenJob}
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
    </main>
  );
}

type CardProps = { machine: EquipmentSummary; onOpenJob: (id: number) => void; onCreateJob?: () => void; onEdit?: () => void };

export function MachineCard({ machine, onOpenJob, onCreateJob, onEdit }: CardProps) {
  const statusClass = String(machine.status).replace(/ /g, "").toLowerCase();
  return (
    <li className={`machineCard ${machine.needs_work ? "needsWork" : ""}`}>
      <div className="machineCardHead">
        <div>
          <strong>{machine.name}</strong>
          <small>
            {machine.model || t("Model not recorded")} · {machine.serial_no}
          </small>
        </div>
        <span className={`machineStatus ${statusClass}`}>{t(machine.status)}</span>
      </div>
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
