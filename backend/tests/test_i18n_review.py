"""The Kiswahili review spreadsheet: export every text, bring a reviewer's corrections back."""
import csv
import shutil

import pytest

from app.i18n import review


@pytest.fixture
def files(tmp_path):
    """Copies of the app's and the server's Kiswahili, so the tests can change them."""
    app, server = tmp_path / "sw.ts", tmp_path / "sw.py"
    shutil.copy(review.APP_FILE, app)
    shutil.copy(review.SERVER_FILE, server)
    return app, server


def export_rows(files, tmp_path):
    sheet = tmp_path / "review.csv"
    count = review.export(sheet, *files)
    with open(sheet, newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle))
    assert len(rows) == count
    return sheet, rows


def write_rows(sheet, rows):
    with open(sheet, "w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, review.COLUMNS)
        writer.writeheader()
        writer.writerows(rows)


def test_the_sheet_has_every_text_from_the_app_and_the_server(files, tmp_path):
    sheet, rows = export_rows(files, tmp_path)
    assert sheet.read_bytes().startswith(b"\xef\xbb\xbf")  # Excel reads it as UTF-8
    app = {row["English"]: row for row in rows if row["Where"] == review.APP}
    server = {row["English"]: row for row in rows if row["Where"] == review.SERVER}
    assert len(app) == len(review.read_app(files[0])) and len(server) == len(review.read_server(files[1]))
    assert app["Today's jobs"]["Kiswahili now"] == "Kazi za leo"
    assert "MechanicDashboard.tsx" in app["Today's jobs"]["Used in"]
    assert server["Please sign in to continue."]["Kiswahili now"] == "Tafadhali ingia ili uendelee."
    assert server["Customer not found"]["Used in"].startswith("app/")


def test_importing_an_untouched_sheet_changes_nothing(files, tmp_path):
    before = [path.read_bytes() for path in files]
    sheet, _ = export_rows(files, tmp_path)
    assert review.import_review(sheet, *files) == (0, [])
    assert [path.read_bytes() for path in files] == before


def test_corrections_go_into_the_right_file_and_nothing_else_moves(files, tmp_path):
    app_before, server_before = (path.read_text(encoding="utf-8") for path in files)
    sheet, rows = export_rows(files, tmp_path)
    for row in rows:
        if row["English"] == "Today's jobs":
            row["Better Kiswahili"] = "Kazi za siku hii"
        if row["English"] == "{label} is required":
            row["Better Kiswahili"] = "Lazima ujaze {label}"
    write_rows(sheet, rows)

    assert review.import_review(sheet, *files) == (2, [])
    assert review.read_app(files[0])["Today's jobs"] == "Kazi za siku hii"
    assert review.read_server(files[1])["{label} is required"] == "Lazima ujaze {label}"
    # Exactly one line changed in each file.
    for path, before in zip(files, (app_before, server_before)):
        changed = [pair for pair in zip(before.split("\n"), path.read_text(encoding="utf-8").split("\n")) if pair[0] != pair[1]]
        assert len(changed) == 1
    compile(files[1].read_text(encoding="utf-8"), "sw.py", "exec")


def test_windows_line_endings_are_kept(files, tmp_path):
    for path in files:
        path.write_bytes(path.read_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n"))
    sheet, rows = export_rows(files, tmp_path)
    for row in rows:
        if row["English"] in ("Today's jobs", "{label} is required"):
            row["Better Kiswahili"] = row["Kiswahili now"] + "!"
    write_rows(sheet, rows)
    assert review.import_review(sheet, *files) == (2, [])
    for path in files:
        content = path.read_bytes()
        assert content.count(b"\n") == content.count(b"\r\n")
    assert review.read_app(files[0])["Today's jobs"] == "Kazi za leo!"


def test_a_correction_that_drops_a_placeholder_changes_nothing(files, tmp_path):
    before = [path.read_bytes() for path in files]
    sheet, rows = export_rows(files, tmp_path)
    for row in rows:
        if row["English"] == "Today's jobs":
            row["Better Kiswahili"] = "Kazi za siku hii"
        if row["English"] == "Overdue since {date}":
            row["Better Kiswahili"] = "Imechelewa"
    write_rows(sheet, rows)

    changed, problems = review.import_review(sheet, *files)
    assert len(problems) == 1 and "['date']" in problems[0]
    assert [path.read_bytes() for path in files] == before


def test_text_that_looks_like_a_formula_stays_text(files, tmp_path):
    sheet, rows = export_rows(files, tmp_path)
    row = next(row for row in rows if row["English"].endswith("+ Add item"))
    # Marked as text, so a spreadsheet doesn't try to calculate it.
    assert row["English"] == "'+ Add item" and row["Kiswahili now"] == "'+ Ongeza kipengele"
    # Spreadsheets usually drop the apostrophe when saving; with or without it, the row matches.
    row["English"], row["Better Kiswahili"] = "+ Add item", "'+ Weka kipengele"
    write_rows(sheet, rows)
    assert review.import_review(sheet, *files) == (1, [])
    assert review.read_app(files[0])["+ Add item"] == "+ Weka kipengele"


def test_a_text_that_no_longer_exists_is_reported(files, tmp_path):
    sheet, rows = export_rows(files, tmp_path)
    rows[0]["English"], rows[0]["Better Kiswahili"] = "A sentence the app dropped", "Sentensi"
    write_rows(sheet, rows)
    _, problems = review.import_review(sheet, *files)
    assert problems and "no longer" in problems[0]
