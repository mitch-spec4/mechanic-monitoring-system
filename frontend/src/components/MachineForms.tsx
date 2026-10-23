import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Plus, Wrench } from "lucide-react";
import Modal from "./Modal";
import { createMachine, customers, updateMachine } from "../services/api";
import { errorMessage } from "../lib/format";
import { EQUIPMENT_STATUSES } from "../lib/labels";
import { t } from "../i18n";

type Customer = { id: number; name: string };
type Equipment = { id: number; name: string; model?: string | null; serial_no: string; status: string };

const formData = (event: FormEvent<HTMLFormElement>) => Object.fromEntries(new FormData(event.currentTarget));

function StatusSelect({ value = "Operational" }: { value?: string }) {
  return (
    <div className="formGroup">
      <label htmlFor="field-status">{t("Status")}</label>
      <select id="field-status" name="status" defaultValue={value}>
        {EQUIPMENT_STATUSES.map((status) => (
          <option key={status} value={status}>
            {t(status)}
          </option>
        ))}
      </select>
    </div>
  );
}

export function AddMachine({ customerId, onClose, onAdded }: { customerId?: number; onClose: () => void; onAdded: () => void }) {
  const [customerList, setCustomerList] = useState<Customer[]>([]);
  const [formError, setFormError] = useState("");
  useEffect(() => {
    customers()
      .then((data) => setCustomerList(data.customers))
      .catch((error) => setFormError(errorMessage(error)));
  }, []);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    try {
      await createMachine(formData(event));
      onAdded();
    } catch (error) {
      setFormError(errorMessage(error));
    }
  };
  return (
    <Modal title={t("Add equipment")} icon={<Wrench size={20} />} onClose={onClose}>
      <form className="form form-upgraded" onSubmit={submit}>
        {formError && <div className="error">{formError}</div>}
        <div className="formGroup">
          <label htmlFor="field-customer_id">{t("Customer")}</label>
          <select id="field-customer_id" name="customer_id" defaultValue={customerId ? String(customerId) : ""} key={customerList.length} required>
            <option value="">{t("Select customer")}</option>
            {customerList.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </div>
        <div className="formGroup">
          <label htmlFor="field-name">{t("Equipment name")}</label>
          <input id="field-name" name="name" placeholder={t("e.g. {example}", { example: "Generator G-102" })} required />
        </div>
        <div className="formGroup">
          <label htmlFor="field-model">{t("Model")}</label>
          <input id="field-model" name="model" placeholder={t("e.g. {example}", { example: "CAT XQ200" })} />
        </div>
        <div className="formGroup">
          <label htmlFor="field-serial_no">{t("Serial number")}</label>
          <input id="field-serial_no" name="serial_no" placeholder={t("Serial number")} required />
        </div>
        <StatusSelect />
        <button className="primary">
          <Plus size={15} /> {t("Add equipment")}
        </button>
      </form>
    </Modal>
  );
}

type EditFormProps = { title: string; onClose: () => void; save: (data: Record<string, FormDataEntryValue>) => Promise<void>; children: ReactNode };

export function EditForm({ title, onClose, save, children }: EditFormProps) {
  const [formError, setFormError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    try {
      await save(formData(event));
    } catch (error) {
      setFormError(errorMessage(error));
    }
  };
  return (
    <Modal title={title} icon={<Wrench size={20} />} onClose={onClose}>
      <form className="form form-upgraded" onSubmit={submit}>
        {formError && <div className="error">{formError}</div>}
        {children}
        <button className="primary">{t("Save changes")}</button>
      </form>
    </Modal>
  );
}

export function EditMachine({ machine, onClose, onSaved }: { machine: Equipment; onClose: () => void; onSaved: () => void }) {
  const save = async (data: Record<string, FormDataEntryValue>) => {
    await updateMachine(machine.id, data);
    onSaved();
  };
  return (
    <EditForm title={t("Edit equipment")} onClose={onClose} save={save}>
      <div className="formGroup">
        <label htmlFor="field-name">{t("Equipment name")}</label>
        <input id="field-name" name="name" defaultValue={machine.name} required />
      </div>
      <div className="formGroup">
        <label htmlFor="field-model">{t("Model")}</label>
        <input id="field-model" name="model" defaultValue={machine.model || ""} />
      </div>
      <div className="formGroup">
        <label htmlFor="field-serial_no">{t("Serial number")}</label>
        <input id="field-serial_no" name="serial_no" defaultValue={machine.serial_no} required />
      </div>
      <StatusSelect value={machine.status} />
    </EditForm>
  );
}
