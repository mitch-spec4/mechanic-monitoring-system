import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Plus, Wrench } from "lucide-react";
import Modal from "./Modal";
import Field from "./Field";
import { createMachine, customers, sites as loadSites, updateMachine } from "../services/api";
import type { Customer, Machine, Site } from "../services/types";
import { errorMessage } from "../lib/format";
import { EQUIPMENT_STATUSES } from "../lib/labels";
import { mark, t } from "../i18n";

// Offered while typing a type; any other can be typed.
const TYPE_SUGGESTIONS = [
  mark("Generator"),
  mark("Pump"),
  mark("Compressor"),
  mark("Conveyor"),
  mark("Mixer"),
  mark("Excavator"),
  mark("Boiler"),
  mark("Forklift"),
  mark("Air conditioner"),
  mark("Vehicle"),
];

const formData = (event: FormEvent<HTMLFormElement>) => Object.fromEntries(new FormData(event.currentTarget));

function StatusSelect({ value = "Operational" }: { value?: string }) {
  return (
    <Field label={t("Status")}>
      <select id="field-status" name="status" defaultValue={value}>
        {EQUIPMENT_STATUSES.map((status) => (
          <option key={status} value={status}>
            {t(status)}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Type, manufacturer, the customer's site, when it was installed, and notes. */
function DetailFields({ customerId, machine }: { customerId?: number; machine?: Machine }) {
  const [siteList, setSiteList] = useState<Site[]>([]);
  useEffect(() => {
    if (!customerId) {
      setSiteList([]);
      return;
    }
    loadSites(customerId)
      .then((data) => setSiteList(data.sites))
      .catch(() => setSiteList([]));
  }, [customerId]);
  return (
    <>
      <div className="row">
        <Field label={t("Type")} optional>
          <input id="field-equipment_type" name="equipment_type" list="equipment-types" defaultValue={machine?.equipment_type || ""} placeholder={t("e.g. {example}", { example: t("Generator") })} />
        </Field>
        <Field label={t("Manufacturer")} optional>
          <input id="field-manufacturer" name="manufacturer" defaultValue={machine?.manufacturer || ""} placeholder={t("e.g. {example}", { example: "Caterpillar" })} />
        </Field>
      </div>
      <datalist id="equipment-types">
        {TYPE_SUGGESTIONS.map((type) => (
          <option key={type} value={t(type)} />
        ))}
      </datalist>
      <div className="row">
        <Field label={t("Site")} optional hint={siteList.length ? undefined : t("Add the customer's sites on their page.")}>
          <select id="field-site_id" name="site_id" defaultValue={machine?.site_id ? String(machine.site_id) : ""} key={siteList.length}>
            <option value="">{t("No site")}</option>
            {siteList.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Installed on")} optional>
          <input id="field-installed_on" name="installed_on" type="date" defaultValue={machine?.installed_on || ""} />
        </Field>
      </div>
      <Field label={t("Notes")} optional>
        <textarea id="field-notes" name="notes" defaultValue={machine?.notes || ""} placeholder={t("e.g. {example}", { example: t("Fuel tank 500 L, key with the site guard") })} />
      </Field>
    </>
  );
}

export function AddMachine({ customerId, onClose, onAdded }: { customerId?: number; onClose: () => void; onAdded: () => void }) {
  const [customerList, setCustomerList] = useState<Customer[]>([]);
  const [chosen, setChosen] = useState<number | undefined>(customerId);
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
        <Field label={t("Customer")}>
          <select
            id="field-customer_id"
            name="customer_id"
            defaultValue={customerId ? String(customerId) : ""}
            key={customerList.length}
            onChange={(event) => setChosen(Number(event.target.value) || undefined)}
            required
          >
            <option value="">{t("Select customer")}</option>
            {customerList.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Equipment name")}>
          <input id="field-name" name="name" placeholder={t("e.g. {example}", { example: "Generator G-102" })} required />
        </Field>
        <Field label={t("Model")} optional>
          <input id="field-model" name="model" placeholder={t("e.g. {example}", { example: "CAT XQ200" })} />
        </Field>
        <Field label={t("Serial number")}>
          <input id="field-serial_no" name="serial_no" placeholder={t("Serial number")} required />
        </Field>
        <StatusSelect />
        <DetailFields customerId={chosen} />
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

export function EditMachine({ machine, onClose, onSaved }: { machine: Machine; onClose: () => void; onSaved: () => void }) {
  const save = async (data: Record<string, FormDataEntryValue>) => {
    await updateMachine(machine.id, data);
    onSaved();
  };
  return (
    <EditForm title={t("Edit equipment")} onClose={onClose} save={save}>
      <Field label={t("Equipment name")}>
        <input id="field-name" name="name" defaultValue={machine.name} required />
      </Field>
      <Field label={t("Model")} optional>
        <input id="field-model" name="model" defaultValue={machine.model || ""} />
      </Field>
      <Field label={t("Serial number")}>
        <input id="field-serial_no" name="serial_no" defaultValue={machine.serial_no} required />
      </Field>
      <StatusSelect value={machine.status} />
      <DetailFields customerId={machine.customer_id} machine={machine} />
    </EditForm>
  );
}
