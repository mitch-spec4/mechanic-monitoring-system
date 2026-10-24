import { useState } from "react";
import { MachineCard } from "../pages/CustomerPage";
import { CreateJobModal } from "./JobForms";
import { EditMachine } from "./MachineForms";
import type { Customer, EquipmentSummary, Machine } from "../services/types";
import { t } from "../i18n";
import { EmptyState } from "./States";
import { Wrench } from "lucide-react";

type Props = {
  machines: EquipmentSummary[];
  customers: Customer[];
  query: string;
  onOpenJob?: (id: number) => void;
  onOpenCustomer?: (id: number) => void;
  onOpenMachine?: (id: number) => void;
  onChanged: () => void;
};

/** Managers: all equipment under its customer, with filters for the pieces needing work and by type. */
export default function MachinesByCustomer({ machines, customers, query, onOpenJob, onOpenCustomer, onOpenMachine, onChanged }: Props) {
  const [onlyNeedsWork, setOnlyNeedsWork] = useState(false);
  const [type, setType] = useState("");
  const [creatingFor, setCreatingFor] = useState<Machine | null>(null);
  const [editing, setEditing] = useState<Machine | null>(null);
  const needle = query.toLowerCase();
  const types = [...new Set(machines.map((machine) => machine.equipment_type).filter((value): value is string => Boolean(value)))].sort();
  const visible = machines.filter(
    (machine) =>
      (!onlyNeedsWork || machine.needs_work) && (!type || machine.equipment_type === type) && JSON.stringify(machine).toLowerCase().includes(needle),
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
        <div className="machineFilters">
          {types.length > 0 && (
            <label>
              {t("Type")}
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">{t("All types")}</option>
                {types.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            <input type="checkbox" checked={onlyNeedsWork} onChange={(e) => setOnlyNeedsWork(e.target.checked)} />
            {t("Needs work only")}
          </label>
        </div>
      </div>
      {groups.length === 0 && (
        <EmptyState
          icon={<Wrench size={26} />}
          title={onlyNeedsWork && !type ? t("No equipment needs work") : t("No equipment found")}
          text={onlyNeedsWork && !type ? t("All equipment is operational, with no open jobs or requests.") : t("Try a different search.")}
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
                  onOpenMachine={onOpenMachine}
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
