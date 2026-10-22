import { useState } from "react";
import { MachineCard } from "../pages/CustomerPage";
import { CreateJobModal } from "./JobForms";
import { EditMachine } from "./MachineForms";

type Props = {
  machines: any[];
  customers: any[];
  query: string;
  onOpenJob?: (id: number) => void;
  onOpenCustomer?: (id: number) => void;
  onChanged: () => void;
};

/** Managers: every machine under its customer, with a filter for the ones needing work. */
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
          {machines.length} machines · <b className="needsWorkText">{needing} need work</b>
        </span>
        <label>
          <input type="checkbox" checked={onlyNeedsWork} onChange={(e) => setOnlyNeedsWork(e.target.checked)} />
          Needs work only
        </label>
      </div>
      {groups.length === 0 && (
        <div className="subEmpty">
          <strong>{onlyNeedsWork ? "No machines need work" : "No machines found"}</strong>
          <span>{onlyNeedsWork ? "Every machine is operational with no open jobs or requests." : "Try a different search."}</span>
        </div>
      )}
      {groups.map(({ customer, machines: own }) => (
        <section className="machineGroup" key={customer.id} aria-label={customer.name}>
          <div className="machineGroupHead">
            <button className="titleLink" onClick={() => onOpenCustomer?.(customer.id)}>
              <strong>{customer.name}</strong>
            </button>
            <span>
              {own.length} machine{own.length === 1 ? "" : "s"}
              {own.some((m) => m.needs_work) ? ` · ${own.filter((m) => m.needs_work).length} need work` : ""}
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
          preset={{ customer_id: creatingFor.customer_id, machine_id: creatingFor.id, title: `Service ${creatingFor.name}` }}
          onClose={() => setCreatingFor(null)}
          onCreated={done}
        />
      )}
      {editing && <EditMachine machine={editing} onClose={() => setEditing(null)} onSaved={done} />}
    </div>
  );
}
