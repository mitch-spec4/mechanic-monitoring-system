"""Lists every text the server can show that has no Kiswahili yet.

    python -m app.i18n.check

It reads the source: text passed to _() or N_(), field labels passed to the validation helpers (or
the label they make from a field name), and job, request and equipment statuses, which are shown
through _(status). tests/test_i18n.py runs the same check.
"""
import ast
from pathlib import Path

from app.i18n import MONTHS
from app.models.constants import JOB_STATUSES, MACHINE_STATUSES, PRIORITIES, REQUEST_STATUSES
from app.utils.validation import default_label

APP = Path(__file__).resolve().parents[1]
# Helpers that take (data, field, label, ...) and show the label in their messages.
LABELLED = {"text", "integer", "choice", "iso_date", "_coordinate", "parse_time"}


def _literal(node):
    return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) else None


def server_texts():
    """{text: "file:line"} for every translatable text in the app."""
    found = {status: "app/models/constants.py" for status in (*JOB_STATUSES, *REQUEST_STATUSES, *MACHINE_STATUSES, *PRIORITIES)}
    found.update({month: "app/i18n/__init__.py" for month in MONTHS})
    for path in APP.rglob("*.py"):
        if "i18n" in path.parts:
            continue
        tree = ast.parse(path.read_text(), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            name = node.func.id if isinstance(node.func, ast.Name) else getattr(node.func, "attr", None)
            where = f"{path.relative_to(APP.parent).as_posix()}:{node.lineno}"
            if name in ("_", "N_") and node.args and _literal(node.args[0]) is not None:
                found.setdefault(_literal(node.args[0]), where)
            elif name in LABELLED and len(node.args) >= 2:
                keyword = next((k.value for k in node.keywords if k.arg == "label"), None)
                label = _literal(node.args[2]) if len(node.args) >= 3 else _literal(keyword) if keyword is not None else None
                field = _literal(node.args[1])
                if label is None and field and name in ("text", "integer", "choice", "iso_date"):
                    label = default_label(field)
                if label:
                    found.setdefault(label, where)
    found.setdefault("Email", "app/utils/validation.py")
    return found


def missing(catalog):
    return {text: where for text, where in server_texts().items() if text not in catalog}


if __name__ == "__main__":
    from app.i18n.sw import SW

    gaps = missing(SW)
    for text, where in sorted(gaps.items(), key=lambda item: item[1]):
        print(f"{where}\t{text!r}")
    print(f"{len(gaps)} text(s) without Kiswahili.")
