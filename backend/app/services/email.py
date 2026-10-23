"""Sending email behind one small interface, chosen by EMAIL_BACKEND:

- log: development and tests. Emails are written to the server log instead of being sent (and the
  last few are kept in memory for the tests).
- smtp: production. Works with any provider's SMTP settings: Resend, Postmark, Brevo, Amazon SES...

Demo companies never send email, so nobody can use the public demo to email strangers.
"""
import smtplib
from collections import deque
from email.message import EmailMessage
from email.utils import make_msgid, parseaddr

from flask import current_app
from markupsafe import escape

from app import db
from app.models.company import Company

BACKENDS = ("log", "smtp")
SECURITY = ("starttls", "ssl", "none")


class LogMailer:
    name = "log"

    def __init__(self):
        self.outbox = deque(maxlen=50)

    def send(self, message):
        self.outbox.append(message)
        current_app.logger.warning(
            "Email not sent (EMAIL_BACKEND=log)\nTo: %s\nSubject: %s\n\n%s",
            message["To"],
            message["Subject"],
            message.get_body(("plain",)).get_content(),
        )


class SmtpMailer:
    name = "smtp"

    def __init__(self, config):
        self.host = config["SMTP_HOST"]
        self.port = config["SMTP_PORT"]
        self.username = config["SMTP_USERNAME"]
        self.password = config["SMTP_PASSWORD"]
        self.security = config["SMTP_SECURITY"]

    def send(self, message):
        connect = smtplib.SMTP_SSL if self.security == "ssl" else smtplib.SMTP
        with connect(self.host, self.port, timeout=15) as server:
            if self.security == "starttls":
                server.starttls()
            if self.username:
                server.login(self.username, self.password)
            server.send_message(message)


def init_email(app):
    backend = app.config["EMAIL_BACKEND"]
    if backend not in BACKENDS:
        raise RuntimeError("EMAIL_BACKEND must be 'log' or 'smtp'")
    if backend == "smtp":
        missing = [name for name in ("SMTP_HOST", "EMAIL_FROM") if not app.config[name]]
        if missing:
            raise RuntimeError("EMAIL_BACKEND=smtp needs " + ", ".join(missing))
        if app.config["SMTP_SECURITY"] not in SECURITY:
            raise RuntimeError("SMTP_SECURITY must be 'starttls', 'ssl' or 'none'")
    app.extensions["email"] = SmtpMailer(app.config) if backend == "smtp" else LogMailer()


def mailer():
    return current_app.extensions["email"]


def app_link(path):
    """A link into the web app for an email, e.g. app_link("/verify?token=..."). Built from the
    configured APP_URL, never from the request, so a forged Host header can't redirect links."""
    return f"{current_app.config['APP_URL']}/#{path}"


def layout(heading, paragraphs, button=None, footer=""):
    """A plain branded HTML email. Every value is escaped: names and company names come from users."""
    body = "".join(f'<p style="margin:0 0 14px">{escape(paragraph)}</p>' for paragraph in paragraphs)
    if button:
        label, url = button
        body += (
            f'<p style="margin:22px 0"><a href="{escape(url)}" style="display:inline-block;padding:12px 20px;'
            f'border-radius:10px;background:#0969d7;color:#ffffff;font-weight:700;text-decoration:none">{escape(label)}</a></p>'
        )
    if footer:
        body += f'<p style="margin:22px 0 0;font-size:13px;color:#64748b">{escape(footer)}</p>'
    return (
        '<div style="background:#f3f6fa;padding:28px 12px;font-family:Arial,Helvetica,sans-serif;color:#0f1d33">'
        '<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:28px">'
        '<div style="font-weight:800;letter-spacing:.04em;color:#0969d7;margin-bottom:18px">MECHANICPRO</div>'
        f'<h1 style="font-size:21px;margin:0 0 16px">{escape(heading)}</h1>{body}</div></div>'
    )


def send_email(to, subject, text, html=None, company_id=None):
    """Send one email. Returns True if it went out, False if it was skipped (demo company) or failed;
    a failure is logged instead of breaking the request that sent it."""
    if company_id is not None:
        company = db.session.get(Company, company_id)
        if company and company.is_demo:
            current_app.logger.info("Email to %s not sent: %s is a demo company", to, company.name)
            return False
    message = EmailMessage()
    message["From"] = current_app.config["EMAIL_FROM"]
    message["To"] = to
    # Names in subjects come from users; keep them on one line.
    message["Subject"] = " ".join(subject.split())
    message["Message-ID"] = make_msgid(domain=parseaddr(message["From"])[1].partition("@")[2] or None)
    message.set_content(text)
    if html:
        message.add_alternative(html, subtype="html")
    try:
        mailer().send(message)
    except Exception:
        current_app.logger.exception("Could not send email to %s", to)
        return False
    return True
