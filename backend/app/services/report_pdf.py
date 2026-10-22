"""The customer-facing job report as a PDF: job, worksheet results, parts, photos and the
customer's sign-off. Hours and internal history stay out, as on the customer's screen."""
import io

from fpdf import FPDF
from PIL import Image, ImageOps

from app import db
from app.models.company import Company
from app.models.customer import Customer
from app.models.machine import Machine
from app.models.media import JobFile
from app.models.service_record import ServiceRecord
from app.models.user import User
from app.models.worksheet import JobChecklistItem, JobEvent, JobPart, WorkEntry
from app.services.storage import storage
from app.services.worksheet import format_quantity

INK = (23, 32, 51)
MUTED = (104, 118, 138)
ACCENT = (9, 105, 215)
LINE = (225, 232, 240)
PHOTO_LABELS = {"before": "Before", "after": "After", "other": "Photo"}
# Images bigger than this aren't decoded for the report: a hostile upload could exhaust memory.
MAX_PIXELS = 40_000_000


def clean(value):
    """The built-in PDF fonts cover Latin-1 only; keep common punctuation readable."""
    replacements = {"–": "-", "—": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "…": "...", "•": "-"}
    text = "".join(replacements.get(char, char) for char in str(value or ""))
    return text.encode("latin-1", "replace").decode("latin-1")


def fmt_date(value):
    return value.strftime("%d %b %Y") if value else "-"


class Report(FPDF):
    def __init__(self, company_name, reference):
        super().__init__(format="A4")
        self.company_name = company_name
        self.reference = reference
        self.set_auto_page_break(True, margin=18)
        self.set_margins(16, 16, 16)

    def header(self):
        self.set_font("Helvetica", "B", 13)
        self.set_text_color(*INK)
        self.cell(0, 7, clean(self.company_name), new_x="LMARGIN", new_y="NEXT")
        self.set_font("Helvetica", "", 9)
        self.set_text_color(*MUTED)
        self.cell(0, 5, clean(f"Service report  -  {self.reference}"), new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(*LINE)
        self.line(16, self.get_y() + 2, 194, self.get_y() + 2)
        self.ln(6)

    def footer(self):
        self.set_y(-12)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(*MUTED)
        self.cell(0, 5, f"Page {self.page_no()}/{{nb}}", align="R")

    def section(self, title):
        if self.get_y() > 250:
            self.add_page()
        self.ln(3)
        self.set_font("Helvetica", "B", 11)
        self.set_text_color(*ACCENT)
        self.cell(0, 7, clean(title), new_x="LMARGIN", new_y="NEXT")
        self.set_text_color(*INK)

    def body(self, value, size=10, style=""):
        self.set_font("Helvetica", style, size)
        self.set_text_color(*INK)
        self.multi_cell(0, 5.2, clean(value), new_x="LMARGIN", new_y="NEXT")

    def pairs(self, rows):
        for label, value in rows:
            self.set_font("Helvetica", "B", 9)
            self.set_text_color(*MUTED)
            self.cell(38, 6, clean(label))
            self.set_font("Helvetica", "", 10)
            self.set_text_color(*INK)
            self.multi_cell(0, 6, clean(value or "-"), new_x="LMARGIN", new_y="NEXT")


def thumbnail(data, max_px):
    """Shrink a photo for the PDF so reports stay small; None if it can't be read."""
    try:
        image = Image.open(io.BytesIO(data))
        if image.width * image.height > MAX_PIXELS:
            return None, None
        image.draft("RGB", (max_px, max_px))  # JPEGs decode straight at a smaller size
        image = ImageOps.exif_transpose(image)
        if image.mode in ("RGBA", "LA", "P"):
            # Transparent areas (like around a signature) become white paper, not black.
            image = image.convert("RGBA")
            paper = Image.new("RGB", image.size, (255, 255, 255))
            paper.paste(image, mask=image.getchannel("A"))
            image = paper
        else:
            image = image.convert("RGB")
        image.thumbnail((max_px, max_px))
        out = io.BytesIO()
        image.save(out, "JPEG", quality=78)
        out.seek(0)
        return out, image.size
    except Exception:  # noqa: BLE001 - a broken upload shouldn't stop the report
        return None, None


def build_report(job):
    company = db.session.get(Company, job.company_id)
    customer = db.session.get(Customer, job.customer_id) if job.customer_id else None
    machine = db.session.get(Machine, job.machine_id) if job.machine_id else None
    mechanic = db.session.get(User, job.mechanic_id) if job.mechanic_id else None
    record = ServiceRecord.query.filter_by(job_id=job.id).first()
    entries = WorkEntry.query.filter_by(job_id=job.id).order_by(WorkEntry.started_at).all()
    parts = JobPart.query.filter_by(job_id=job.id).order_by(JobPart.id).all()
    checklist = JobChecklistItem.query.filter_by(job_id=job.id).order_by(JobChecklistItem.position, JobChecklistItem.id).all()
    files = JobFile.query.filter_by(job_id=job.id, status="ready").order_by(JobFile.created_at, JobFile.id).all()
    completed = (
        JobEvent.query.filter_by(job_id=job.id, action="status", to_status="Completed").order_by(JobEvent.created_at.desc()).first()
    )

    pdf = Report(company.name if company else "MechanicPro", f"Job #{job.id}")
    pdf.alias_nb_pages()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 17)
    pdf.multi_cell(0, 8, clean(job.title), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)
    pdf.pairs(
        [
            ("Customer", customer.name if customer else None),
            ("Machine", f"{machine.name} ({machine.serial_no})" if machine else None),
            ("Site", job.location),
            ("Mechanic", mechanic.name if mechanic else None),
            ("Job type", job.job_type or "General"),
            ("Completed", fmt_date(completed.created_at) if completed else job.status),
        ]
    )

    pdf.section("Problem reported")
    pdf.body(job.description)

    notes = [entry.work_done.strip() for entry in entries if (entry.work_done or "").strip()]
    pdf.section("Work done")
    pdf.body("\n".join(f"- {note}" for note in notes) if notes else "No work notes recorded.")

    if record and (record.solution or record.advice):
        pdf.section("Summary")
        if record.solution:
            pdf.body(record.solution)
        if record.advice:
            pdf.ln(1)
            pdf.body(f"Advice: {record.advice}", style="I")

    pdf.section("Parts used")
    if parts:
        for part in parts:
            pdf.body(f"{format_quantity(part.quantity)} x {part.name}")
    else:
        pdf.body("No parts used.")

    if checklist:
        pdf.section("Checklist")
        for item in checklist:
            mark = "Done" if item.done else "Not done"
            pdf.body(f"[{mark}] {item.label}{' (required)' if item.required else ''}")

    photos = [f for f in files if f.kind in PHOTO_LABELS]
    videos = [f for f in files if f.kind == "video"]
    if photos:
        pdf.section("Photos")
        add_photo_grid(pdf, photos)
    if videos:
        pdf.section("Videos")
        pdf.body(f"{len(videos)} video{'s' if len(videos) != 1 else ''} recorded. Open the job in MechanicPro to watch.")

    pdf.section("Customer sign-off")
    signature = next((f for f in reversed(files) if f.kind == "signature"), None)
    if job.signed_at:
        if signature:
            image, size = thumbnail(storage().read(signature.storage_key), 600)
            if image:
                width = 60
                pdf.image(image, w=width, h=width * size[1] / size[0])
        pdf.body(f"Signed by {job.signed_by_name} on {fmt_date(job.signed_at)}")
    elif job.no_signature_reason:
        pdf.body(f"Not signed: {job.no_signature_reason}")
    else:
        pdf.body("Not signed.")

    return bytes(pdf.output())


def add_photo_grid(pdf, photos):
    """Three photos per row, each fitted inside the same box and labelled Before/After/Photo."""
    columns, gap = 3, 4
    width = (pdf.w - pdf.l_margin - pdf.r_margin - gap * (columns - 1)) / columns
    height = width * 0.75
    images = []
    for photo in photos:
        try:
            image, _size = thumbnail(storage().read(photo.storage_key), 900)
        except Exception:  # noqa: BLE001 - a missing file shouldn't stop the report
            image = None
        if image:
            images.append((image, PHOTO_LABELS[photo.kind]))
    for start in range(0, len(images), columns):
        if pdf.get_y() + height + 8 > pdf.h - pdf.b_margin:
            pdf.add_page()
        top = pdf.get_y()
        for column, (image, label) in enumerate(images[start : start + columns]):
            x = pdf.l_margin + column * (width + gap)
            pdf.image(image, x=x, y=top, w=width, h=height, keep_aspect_ratio=True)
            pdf.set_xy(x, top + height + 0.5)
            pdf.set_font("Helvetica", "", 8)
            pdf.set_text_color(*MUTED)
            pdf.cell(width, 4, label)
        pdf.set_xy(pdf.l_margin, top + height + 6)
