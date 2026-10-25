import type { FormAnswer, FormField, JobForm } from "../services/types";

/** The questions shown for these answers, in order: the same rule as the server's
 *  (backend/app/services/forms.py). A question with `show_if` is asked only when the earlier
 *  question it depends on is shown and has that answer. */
export function visibleFields(fields: FormField[], answers: Record<string, FormAnswer>) {
  const shown = new Set<string>();
  return fields.filter((field) => {
    const rule = field.show_if;
    if (rule && (!shown.has(rule.field) || answers[rule.field] !== rule.equals)) return false;
    shown.add(field.id);
    return true;
  });
}

/** Required questions shown and not answered yet (their labels). */
export function missingAnswers(form: JobForm, answers: Record<string, FormAnswer>, photos: Record<string, unknown[]>) {
  const fields = form.version?.fields ?? [];
  return visibleFields(fields, answers)
    .filter((field) => field.required && (field.type === "photo" ? !(photos[field.id]?.length) : answers[field.id] === undefined || answers[field.id] === ""))
    .map((field) => field.label);
}

/** Only the answers to questions still shown. */
export function keptAnswers(fields: FormField[], answers: Record<string, FormAnswer>) {
  const shown = new Set(visibleFields(fields, answers).map((field) => field.id));
  return Object.fromEntries(Object.entries(answers).filter(([id]) => shown.has(id)));
}
