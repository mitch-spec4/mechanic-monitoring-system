import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { t } from "../i18n";

/** Nothing to show yet: an icon, a short title and what will appear here. */
export function EmptyState({ title, text, icon }: { title: string; text?: string; icon?: ReactNode }) {
  return (
    <div className="emptyState subEmpty">
      <span className="emptyIcon" aria-hidden="true">
        {icon ?? <Inbox size={26} />}
      </span>
      <strong>{title}</strong>
      {text && <span>{text}</span>}
    </div>
  );
}

/** Shimmering placeholder lines while a page loads; screen readers hear the label. */
export function Loading({ label = t("Loading…") }: { label?: string }) {
  return (
    <div className="skeleton" role="status" aria-live="polite">
      <span className="visuallyHidden">{label}</span>
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}
