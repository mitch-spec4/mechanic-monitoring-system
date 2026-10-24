"""Hand every Kiswahili text to a reviewer as one spreadsheet, and bring their corrections back.

    python -m app.i18n.review export kiswahili-review.csv
    python -m app.i18n.review import kiswahili-review.csv

The CSV has a row per text: where it shows (app screens or server messages and emails), the
English, the Kiswahili now, a column for a better Kiswahili, and one for notes. The reviewer fills
in "Better Kiswahili" only where the wording should change. Import writes those into
frontend/src/i18n/sw.ts and backend/app/i18n/sw.py, and refuses a change whose {placeholders}
differ from the English. Everything else in both files stays as it is.
"""
import ast
import csv
import json
import re
import sys
from pathlib import Path

from app.i18n.check import server_texts

BACKEND = Path(__file__).resolve().parents[2]
SERVER_FILE = BACKEND / "app" / "i18n" / "sw.py"
APP_FILE = BACKEND.parent / "frontend" / "src" / "i18n" / "sw.ts"
APP_SOURCE = BACKEND.parent / "frontend" / "src"

APP, SERVER = "App screens", "Server messages and emails"
COLUMNS = ["Where", "English", "Kiswahili now", "Better Kiswahili", "Notes", "Used in"]
APP_LINE = re.compile(r'^  (".*"): (".*"),$')
PLACEHOLDER = re.compile(r"\{(\w+)\}")
# Excel and Google Sheets read a cell starting with one of these as a formula ("+ Add item").
FORMULA_START = ("=", "+", "-", "@")


def placeholders(text):
    return sorted(PLACEHOLDER.findall(text))


def as_text(value):
    """A leading apostrophe tells a spreadsheet the cell is text, not a formula."""
    return f"'{value}" if value.startswith(FORMULA_START) else value


def from_text(value):
    """The cell's text, with or without the apostrophe (spreadsheets often drop it when saving)."""
    return value[1:] if value.startswith("'") and value[1:].startswith(FORMULA_START) else value


# ---------- Reading and writing the two files ----------


def _read_lines(path):
    """The file's lines and its line ending, kept as they are (a Windows checkout may use CRLF)."""
    with open(path, encoding="utf-8", newline="") as handle:
        source = handle.read()
    newline = "\r\n" if "\r\n" in source else "\n"
    return source.split(newline), newline


def _write_lines(path, lines, newline):
    with open(path, "w", encoding="utf-8", newline="") as handle:
        handle.write(newline.join(lines))


def read_app(path=APP_FILE):
    """{English: Kiswahili} from the app's sw.ts, one entry per line."""
    entries = {}
    for line in _read_lines(path)[0]:
        match = APP_LINE.match(line)
        if match:
            entries[json.loads(match.group(1))] = json.loads(match.group(2))
    return entries


def write_app(changes, path=APP_FILE):
    if not changes:
        return
    lines, newline = _read_lines(path)
    for index, line in enumerate(lines):
        match = APP_LINE.match(line)
        if match and json.loads(match.group(1)) in changes:
            lines[index] = f"  {match.group(1)}: {json.dumps(changes[json.loads(match.group(1))], ensure_ascii=False)},"
    _write_lines(path, lines, newline)


def _server_values(source):
    """{English: the Kiswahili's string node} in the server's sw.py."""
    tree = ast.parse(source)
    table = next(node.value for node in tree.body if isinstance(node, ast.Assign) and node.targets[0].id == "SW")
    return {key.value: value for key, value in zip(table.keys, table.values)}


def read_server(path=SERVER_FILE):
    lines, newline = _read_lines(path)
    return {english: node.value for english, node in _server_values(newline.join(lines)).items()}


def write_server(changes, path=SERVER_FILE):
    if not changes:
        return
    lines, newline = _read_lines(path)
    nodes = _server_values(newline.join(lines))
    # From the end of the file back, so earlier positions stay right.
    for english in sorted(changes, key=lambda key: (nodes[key].lineno, nodes[key].col_offset), reverse=True):
        node = nodes[english]
        assert node.lineno == node.end_lineno, f"{english!r} spans lines; edit it by hand"
        line = lines[node.lineno - 1]
        # Column offsets count UTF-8 bytes.
        raw = line.encode("utf-8")
        literal = json.dumps(changes[english], ensure_ascii=False).encode("utf-8")
        lines[node.lineno - 1] = (raw[: node.col_offset] + literal + raw[node.end_col_offset :]).decode("utf-8")
    _write_lines(path, lines, newline)


# ---------- Where texts show ----------


def app_usages(texts, source=APP_SOURCE):
    """{English: "pages/JobPage.tsx, ..."}: the app files that use each text."""
    files = [path for path in source.rglob("*.ts*") if "i18n" not in path.parts]
    contents = {path: path.read_text(encoding="utf-8") for path in files}
    usages = {}
    for text in texts:
        # Written plainly, or with \u escapes for curly quotes.
        quoted = (json.dumps(text, ensure_ascii=False), json.dumps(text), f"'{text}'", f"`{text}`")
        found = [str(path.relative_to(source)) for path, content in contents.items() if any(q in content for q in quoted)]
        usages[text] = ", ".join(sorted(found)[:3])
    return usages


# ---------- Export and import ----------


def export(target, app_file=APP_FILE, server_file=SERVER_FILE):
    app, server = read_app(app_file), read_server(server_file)
    used = app_usages(app)
    server_used = server_texts()
    rows = [[APP, as_text(english), as_text(kiswahili), "", "", used.get(english, "")] for english, kiswahili in app.items()]
    rows += [
        [SERVER, as_text(english), as_text(kiswahili), "", "", server_used.get(english, "").split(":")[0]]
        for english, kiswahili in server.items()
    ]
    # A byte order mark, so Excel opens it as UTF-8.
    with open(target, "w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle)
        writer.writerow(COLUMNS)
        writer.writerows(rows)
    return len(rows)


def import_review(source, app_file=APP_FILE, server_file=SERVER_FILE):
    """Apply the "Better Kiswahili" column. Returns (changed, problems)."""
    current = {APP: read_app(app_file), SERVER: read_server(server_file)}
    changes = {APP: {}, SERVER: {}}
    problems = []
    with open(source, newline="", encoding="utf-8-sig") as handle:
        for number, row in enumerate(csv.DictReader(handle), start=2):
            where, english = row.get("Where", ""), from_text(row.get("English", ""))
            better = from_text((row.get("Better Kiswahili") or "").strip())
            if not better:
                continue
            if where not in current:
                problems.append(f"row {number}: unknown Where {where!r}")
            elif english not in current[where]:
                problems.append(f"row {number}: {english!r} is no longer in the {where.lower()}")
            elif placeholders(better) != placeholders(english):
                problems.append(f"row {number}: {better!r} must keep the placeholders {placeholders(english)} of {english!r}")
            elif better != current[where][english]:
                changes[where][english] = better
    if not problems:
        write_app(changes[APP], app_file)
        write_server(changes[SERVER], server_file)
    return len(changes[APP]) + len(changes[SERVER]), problems


def main(argv):
    if len(argv) != 2 or argv[0] not in ("export", "import"):
        print(__doc__)
        return 2
    command, path = argv
    if command == "export":
        print(f"Wrote {export(path)} texts to {path}. Fill in 'Better Kiswahili' where the wording should change.")
        return 0
    changed, problems = import_review(path)
    if problems:
        print("Nothing was changed. Fix these rows and import again:", *problems, sep="\n  ")
        return 1
    print(f"Updated {changed} text(s). Check them with `git diff`, then run the app's and server's i18n checks.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
