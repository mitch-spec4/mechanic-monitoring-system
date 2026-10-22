import { useEffect, useState } from "react";
import { Plus, Wrench } from "lucide-react";
import Modal from "./Modal";
import { createMachine, customers, updateMachine } from "../services/api";
import { errorMessage } from "../lib/format";

export const MACHINE_STATUSES = ["Operational", "Under Maintenance", "Under Repair", "Retired"];

export function AddMachine({ customerId, onClose, onAdded }: { customerId?: number; onClose: () => void; onAdded: () => void }) {
  const [customerList, setCustomerList] = useState<any[]>([]);
  const [formError, setFormError] = useState("");
  useEffect(() => {
    customers().then((data) => setCustomerList(data.customers)).catch((e) => setFormError(errorMessage(e)));
  }, []);
  const submit = async (event: any) => {
    event.preventDefault();
    setFormError("");
    try {
      await createMachine(Object.fromEntries(new FormData(event.currentTarget)));
      onAdded();
    } catch (e) {
      setFormError(errorMessage(e));
    }
  };
  return (
    <Modal title="Add machine" icon={<Wrench size={20} />} onClose={onClose}>
      <form className="form form-upgraded" onSubmit={submit}>
        {formError && <div className="error">{formError}</div>}
        <div className="formGroup">
          <label htmlFor="field-customer_id">Customer</label>
          <select id="field-customer_id" name="customer_id" defaultValue={customerId ? String(customerId) : ""} key={customerList.length} required>
            <option value="">Select customer</option>
            {customerList.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="formGroup">
          <label htmlFor="field-name">Machine name</label>
          <input id="field-name" name="name" placeholder="e.g. Generator G-102" required />
        </div>
        <div className="formGroup">
          <label htmlFor="field-model">Model</label>
          <input id="field-model" name="model" placeholder="e.g. CAT XQ200" />
        </div>
        <div className="formGroup">
          <label htmlFor="field-serial_no">Serial number</label>
          <input id="field-serial_no" name="serial_no" placeholder="Serial number" required />
        </div>
        <div className="formGroup">
          <label htmlFor="field-status">Status</label>
          <select id="field-status" name="status" defaultValue="Operational">
            {MACHINE_STATUSES.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </div>
        <button className="primary">
          <Plus size={15} /> Add machine
        </button>
      </form>
    </Modal>
  );
}

export function EditForm({ title, onClose, save, children }: any) {
  const [formError, setFormError] = useState("");
  const submit = async (event: any) => {
    event.preventDefault();
    setFormError("");
    try {
      await save(Object.fromEntries(new FormData(event.currentTarget)));
    } catch (e) {
      setFormError(errorMessage(e));
    }
  };
  return (
    <Modal title={title} icon={<Wrench size={20} />} onClose={onClose}>
      <form className="form form-upgraded" onSubmit={submit}>
        {formError && <div className="error">{formError}</div>}
        {children}
        <button className="primary">Save changes</button>
      </form>
    </Modal>
  );
}

export function EditMachine({ machine, onClose, onSaved }: any) {
  return (
    <EditForm title="Edit machine" onClose={onClose} save={async (data: any) => { await updateMachine(machine.id, data); onSaved(); }}>
      <div className="formGroup">
        <label htmlFor="field-name">Machine name</label>
        <input id="field-name" name="name" defaultValue={machine.name} required />
      </div>
      <div className="formGroup">
        <label htmlFor="field-model">Model</label>
        <input id="field-model" name="model" defaultValue={machine.model || ""} />
      </div>
      <div className="formGroup">
        <label htmlFor="field-serial_no">Serial number</label>
        <input id="field-serial_no" name="serial_no" defaultValue={machine.serial_no} required />
      </div>
      <div className="formGroup">
        <label htmlFor="field-status">Status</label>
        <select id="field-status" name="status" defaultValue={machine.status}>
          {MACHINE_STATUSES.map((status) => (
            <option key={status}>{status}</option>
          ))}
        </select>
      </div>
    </EditForm>
  );
}
