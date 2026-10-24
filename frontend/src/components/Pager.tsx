import { ChevronLeft, ChevronRight } from "lucide-react";
import { t } from "../i18n";

type Props = { page: number; pages: number; total: number; size: number; onPage: (page: number) => void };

/** Previous and Next under a long list, with where this page sits ("26–50 of 340"). Hidden for one page. */
export default function Pager({ page, pages, total, size, onPage }: Props) {
  if (pages <= 1) return null;
  const from = (page - 1) * size + 1;
  const to = Math.min(page * size, total);
  return (
    <nav className="pager" aria-label={t("Pages")}>
      <button className="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft size={15} /> {t("Previous")}
      </button>
      <span aria-live="polite">{t("{from}–{to} of {total}", { from, to, total })}</span>
      <button className="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {t("Next")} <ChevronRight size={15} />
      </button>
    </nav>
  );
}
