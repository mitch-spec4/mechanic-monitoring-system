"""A completed form as a PDF certificate: the company's name and logo, the job and equipment, every
question shown with its answer (photos and signatures as images), and who completed it when."""
from datetime import date

from app import db
from app.models.company import Company
from app.models.customer import Customer
from app.models.forms import FormVersion
from app.models.machine import Machine
from app.models.user import User
from app.services.forms import form_files, visible
from app.services.report_pdf import INK, MUTED, Report, add_photo_grid, clean, company_logo, fmt_date, stored_thumbnail
from app.i18n import MONTHS, _


def answer_text(field, value):
    if value in (None, ""):
        return _("Not answered")
    if field["type"] == "yesno":
        return _("Yes") if value == "yes" else _("No")
    if field["type"] == "date":
        try:
            day = date.fromisoformat(value)
        except (TypeError, ValueError):
            return str(value)
        return f"{day.day:02d} {_(MONTHS[day.month - 1])} {day.year}"
    if field["type"] == "number" and isinstance(value, float):
        return f"{value:g}"
    return str(value)


def question(pdf, label, value=None):
    """A question's label, small and grey, with its answer under it."""
    if pdf.get_y() > 265:
        pdf.add_page()
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(0, 5, clean(label), new_x="LMARGIN", new_y="NEXT")
    if value is not None:
        pdf.set_font("Helvetica", "", 10.5)
        pdf.set_text_color(*INK)
        pdf.multi_cell(0, 5.4, clean(value), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1.5)


def build_certificate(job, form, submission):
    company = db.session.get(Company, job.company_id)
    customer = db.session.get(Customer, job.customer_id) if job.customer_id else None
    machine = db.session.get(Machine, submission.machine_id or job.machine_id) if (submission.machine_id or job.machine_id) else None
    version = db.session.get(FormVersion, submission.version_id)
    completer = db.session.get(User, submission.completed_by) if submission.completed_by else None
    answers = submission.answers or {}
    files = form_files(job.id, form.id)

    pdf = Report(company.name if company else "MechanicPro", _("Job #{number}", number=job.id), title=form.name, logo=company_logo(company))
    pdf.alias_nb_pages()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 17)
    pdf.set_text_color(*INK)
    pdf.multi_cell(0, 8, clean(form.name), new_x="LMARGIN", new_y="NEXT")
    if form.description:
        pdf.body(form.description, size=9, style="I")
    pdf.ln(2)
    pdf.pairs(
        [
            (_("Customer"), customer.name if customer else None),
            (_("Equipment"), f"{machine.name} ({machine.serial_no})" if machine else None),
            (_("Site"), job.location),
            (_("Job"), job.title),
            (_("Completed by"), completer.name if completer else None),
            (_("Completed"), fmt_date(submission.completed_at) if submission.completed_at else None),
        ]
    )
    pdf.ln(2)

    for field in visible(version.fields, answers):
        kind = field["type"]
        if kind == "heading":
            pdf.section(field["label"])
        elif kind == "photo":
            photos = [record for record in files.get(field["id"], []) if record.kind == "form_photo"]
            question(pdf, field["label"], None if photos else _("No photo"))
            if photos:
                add_photo_grid(pdf, photos, label=field["label"])
                pdf.ln(2)
        elif kind == "signature":
            signed = [record for record in files.get(field["id"], []) if record.kind == "form_signature"]
            question(pdf, field["label"])
            if signed:
                image, size = stored_thumbnail(signed[-1], 600)
                if image:
                    if pdf.get_y() + 26 > pdf.h - pdf.b_margin:
                        pdf.add_page()
                    width = 55
                    pdf.image(image, w=width, h=min(26, width * size[1] / size[0]), keep_aspect_ratio=True)
                name = (answers.get(field["id"]) or {}).get("name")
                pdf.body(_("Signed by {name} on {date}", name=name, date=fmt_date(signed[-1].created_at)), size=9)
                pdf.ln(1.5)
            else:
                pdf.body(_("Not signed."), size=10)
        else:
            question(pdf, field["label"], answer_text(field, answers.get(field["id"])))

    pdf.ln(4)
    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(
        0,
        4.5,
        clean(_("{form}, version {number}. Made with MechanicPro.", form=form.name, number=version.number)),
        new_x="LMARGIN",
        new_y="NEXT",
    )
    return bytes(pdf.output())
