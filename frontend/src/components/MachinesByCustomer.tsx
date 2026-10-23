import { useState } from "react";
import { MachineCard } from "../pages/CustomerPage";
import { CreateJobModal } from "./JobForms";
import { EditMachine } from "./MachineForms";
import { t } from "../i18n";
import { EmptyState } from "./States";
import { Wrench } from "lucide-react";

type Props = {
  machines: any[];
  customers: any[];
  query: string;
  onOpenJob?: (id: number) => void;
  onOpenCustomer?: (id: number) => void;
  onChanged: () => void;
};

/** Managers: all equipment under its customer, with a filter for the pieces needing work. */
export default function MachinesByCustomer({ machines, customers, query, onOpenJob, onOpenCustomer, onChanged }: Props) {
  const [onlyNeedsWork, setOnlyNeedsWork] = useState(false);
  const [creatingFor, setCreatingFor] = useState<any>(null);
  const [editing, setEditing] = useState<any>(null);
  const needle = query.toLowerCase();
  const visible = machines.filter(
    (machine) => (!onlyNeedsWork || machine.needs_work) && JSON.stringify(machine).toLowerCase().includes(needle),
  );
  const needing = machines.filter((machine) => machine.needs_work).length;
  const groups = customers
    .map((customer) => ({ customer, machines: visible.filter((machine) => machine.customer_id === customer.id) }))
    .filter((group) => group.machines.length)
    .sort(
      (a, b) =>
        Number(b.machines.some((m) => m.needs_work)) - Number(a.machines.some((m) => m.needs_work)) ||
        a.customer.name.localeCompare(b.customer.name),
    );
  const done = () => {
    setCreatingFor(null);
    setEditing(null);
    onChanged();
  };

  return (
    <div className="machineGroups">
      <div className="machineGroupsBar">
        <span>
          {t("{count} pieces of equipment", { count: machines.length })} · <b className="needsWorkText">{t("{count} need work", { count: needing })}</b>
        </span>
        <label>
          <input type="checkbox" checked={onlyNeedsWork} onChange={(e) => setOnlyNeedsWork(e.target.checked)} />
          {t("Needs work only")}
        </label>
      </div>
      {groups.length === 0 && (
        <EmptyState
          icon={<Wrench size={26} />}
          title={onlyNeedsWork ? t("No equipment needs work") : t("No equipment found")}
          text={onlyNeedsWork ? t("All equipment is operational, with no open jobs or requests.") : t("Try a different search.")}
        />
      )}
      {groups.map(({ customer, machines: own }) => (
        <section className="machineGroup" key={customer.id} aria-label={customer.name}>
          <div className="machineGroupHead">
            <button className="titleLink" onClick={() => onOpenCustomer?.(customer.id)}>
              <strong>{customer.name}</strong>
            </button>
            <span>
              {own.length === 1 ? t("1 piece of equipment") : t("{count} pieces of equipment", { count: own.length })}
              {own.some((m) => m.needs_work) ? ` · ${t("{count} need work", { count: own.filter((m) => m.needs_work).length })}` : ""}
            </span>
          </div>
          <ul className="machineCards">
            {own
              .sort((a, b) => Number(b.needs_work) - Number(a.needs_work))
              .map((machine) => (
                <MachineCard
                  key={machine.id}
                  machine={machine}
                  onOpenJob={onOpenJob || (() => {})}
                  onCreateJob={() => setCreatingFor(machine)}
                  onEdit={() => setEditing(machine)}
                />
              ))}
          </ul>
        </section>
      ))}
      {creatingFor && (
        <CreateJobModal
          preset={{ customer_id: creatingFor.customer_id, machine_id: creatingFor.id, title: t("Service {name}", { name: creatingFor.name }) }}
          onClose={() => setCreatingFor(null)}
          onCreated={done}
        />
      )}
      {editing && <EditMachine machine={editing} onClose={() => setEditing(null)} onSaved={done} />}
    </div>
  );
}
