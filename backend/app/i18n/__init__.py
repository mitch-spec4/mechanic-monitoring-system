"""Server text in the reader's language: error messages, emails, notifications and PDF reports.

English is the source and the default. The English text is the key; app/i18n/sw.py holds its
Kiswahili. tests/test_i18n.py fails if any text the server can show has no Kiswahili.

    _("Customer not found")                        # in the language of the current request
    _("{count} days left", count=3)                # with values
    with speaking(user.language): ...              # for an email or notification to someone else
"""
from contextlib import contextmanager
from datetime import timezone
from zoneinfo import ZoneInfo

from flask import g, has_request_context, request

from app.i18n.en import EN
from app.i18n.sw import SW

# code: (name in its own language, written right to left)
LANGUAGES = {"en": ("English", False), "sw": ("Kiswahili", False)}
DEFAULT = "en"
# English needs a few entries of its own: stored values worded differently on screen.
CATALOGS = {"en": EN, "sw": SW}


def language_or_default(code):
    return code if code in LANGUAGES else DEFAULT


def current_language():
    """The language set by speaking(), else the one the app asked for, else English.

    The app sends X-Language: some browsers (Firefox) don't let a page change Accept-Language,
    which is still honoured for anything else that calls the API."""
    if not has_request_context():
        return getattr(_local, "language", DEFAULT)
    if "language" in g:
        return g.language
    asked = request.headers.get("X-Language", "").strip().lower()
    if asked in LANGUAGES:
        return asked
    return language_or_default((request.accept_languages.best_match(LANGUAGES) or DEFAULT))


class _Local:
    language = DEFAULT


_local = _Local()


@contextmanager
def speaking(code):
    """Write text for someone other than the person making the request, e.g. an email's recipient."""
    code = language_or_default(code)
    if has_request_context():
        had, previous = "language" in g, g.get("language")
        g.language = code
        try:
            yield
        finally:
            if had:
                g.language = previous
            else:
                g.pop("language", None)
    else:
        previous, _local.language = _local.language, code
        try:
            yield
        finally:
            _local.language = previous


def N_(text):
    """Marks text for translation where it's defined (a constant); translate it with _() where it's used."""
    return text


def _(text, **values):
    translated = CATALOGS.get(current_language(), {}).get(text, text)
    return translated.format(**values) if values else translated


MONTHS = [N_("Jan"), N_("Feb"), N_("Mar"), N_("Apr"), N_("May"), N_("Jun"), N_("Jul"), N_("Aug"), N_("Sep"), N_("Oct"), N_("Nov"), N_("Dec")]
DEFAULT_TIMEZONE = "Africa/Nairobi"


def company_timezone():
    """The signed-in person's company time zone (Nairobi when there's nobody signed in)."""
    user = g.get("user") if has_request_context() else None
    if user is None:
        return DEFAULT_TIMEZONE
    from app import db
    from app.models.company import Company

    company = db.session.get(Company, user.company_id)
    return company.timezone if company else DEFAULT_TIMEZONE


def local_time(moment, zone=None, with_time=True):
    """A stored UTC time as the company reads it: "05 Nov 2026 14:30" (month names translated)."""
    if moment is None:
        return "-"
    local = moment.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(zone or company_timezone()))
    text = f"{local.day:02d} {_(MONTHS[local.month - 1])} {local.year}"
    return f"{text} {local:%H:%M}" if with_time else text
