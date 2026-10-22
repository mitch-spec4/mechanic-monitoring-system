import { useEffect, useState } from "react";
import { ListChecks, Plus, Trash2 } from "lucide-react";
import Modal from "./Modal";
import { checklists, createChecklist, deleteChecklist, updateChecklist } from "../services/api";
import { errorMessage } from "../lib/format";
import "./ChecklistManager.css";

type Item = { label: string; required: boolean };
type Template = { id: number; job_type: string; items: Item[] };

/** Managers define a checklist per job type; it is copied onto each job when work starts. */
export default function ChecklistManager() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Template | "new" | null>(null);
  const [error, setError] = useState("");
  const load = () =>
    checklists()
      .then((data) => setTemplates(data.checklists))
      .catch((e) => setError(errorMessage(e)));
  useEffect(() => {
    load();
  }, []);

  const remove = async (template: Template) => {
    if (!confirm(`Delete the ${template.job_type} checklist? Jobs already started keep their copy.`)) return;
    try {
      await deleteChecklist(template.id);
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="checklistManager">
      {error && <div className="error">{error}</div>}
      <div className="checklistIntro">
        <p className="muted">
          Pick a job type when you create a job. When the mechanic starts work, that type's checklist is copied onto
          the job. Required items must be ticked before the job can be completed.
        </p>
        <button className="primary" onClick={() => setEditing("new")}>
          <Plus size={14} /> New checklist
        </button>
      </div>
      {templates.length === 0 ? (
        <div className="subEmpty">
          <strong>No checklists yet</strong>
          <span>Create one for each kind of job your team does, such as Repair or Inspection.</span>
        </div>
      ) : (
        <div className="checklistCards">
          {templates.map((template) => (
            <article key={template.id} className="checklistCard">
              <div className="checklistCardHead">
                <h3>
                  <ListChecks size={16} /> {template.job_type}
                </h3>
                <span>{template.items.length} items</span>
              </div>
              <ol>
                {template.items.map((item, index) => (
                  <li key={index}>
                    {item.label}
                    {item.required && <em>Required</em>}
                  </li>
                ))}
              </ol>
              <div className="checklistCardFoot">
                <button className="listAction" onClick={() => setEditing(template)}>
                  Edit
                </button>
                <button className="iconButton" title="Delete checklist" aria-label={`Delete ${template.job_type} checklist`} onClick={() => remove(template)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {editing && (
        <ChecklistEditor
          template={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function ChecklistEditor({ template, onClose, onSaved }: { template: Template | null; onClose: () => void; onSaved: () => void }) {
  const [jobType, setJobType] = useState(template?.job_type || "");
  const [items, setItems] = useState<Item[]>(template?.items.map(({ label, required }) => ({ label, required })) || [{ label: "", required: true }]);
  const [error, setError] = useState("");
  const update = (index: number, change: Partial<Item>) => setItems((rows) => rows.map((row, i) => (i === index ? { ...row, ...change } : row)));

  const save = async (event: any) => {
    event.preventDefault();
    setError("");
    const payload = { job_type: jobType, items: items.filter((item) => item.label.trim()) };
    try {
      if (template) await updateChecklist(template.id, payload);
      else await createChecklist(payload);
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Modal title={template ? `Edit ${template.job_type} checklist` : "New checklist"} icon={<ListChecks size={20} />} onClose={onClose}>
      <form className="form form-upgraded checklistEditor" onSubmit={save}>
        {error && <div className="error">{error}</div>}
        <div className="formGroup">
          <label htmlFor="field-job_type">Job type</label>
          <input id="field-job_type" value={jobType} onChange={(e) => setJobType(e.target.value)} placeholder="e.g. Repair" required />
        </div>
        <div className="formGroup">
          <span className="editorLabel">Items</span>
          {items.map((item, index) => (
            <div className="checklistRow" key={index}>
              <input
                aria-label={`Item ${index + 1}`}
                value={item.label}
                onChange={(e) => update(index, { label: e.target.value })}
                placeholder="e.g. Isolate power"
              />
              <label className="requiredToggle">
                <input type="checkbox" checked={item.required} onChange={(e) => update(index, { required: e.target.checked })} />
                Required
              </label>
              <button
                type="button"
                className="iconButton"
                title="Remove item"
                aria-label={`Remove item ${index + 1}`}
                onClick={() => setItems((rows) => rows.filter((_, i) => i !== index))}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button type="button" className="link" onClick={() => setItems((rows) => [...rows, { label: "", required: false }])}>
            + Add item
          </button>
        </div>
        <button className="primary">Save checklist</button>
      </form>
    </Modal>
  );
}
