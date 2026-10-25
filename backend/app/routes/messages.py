"""The chat between a customer and the company's managers: quotes, questions, changes of plan.

Managers see every customer's conversation; a customer sees their own. Technicians aren't in it.
Each message notifies the other side in the app; a manager's message is also emailed to the
customer, once until they've read it (so a run of messages sends one email).
"""
from flask import Blueprint, jsonify
from sqlalchemy import func

from app import db
from app.models.company import Company
from app.models.customer import Customer
from app.models.request import CustomerMessage
from app.models.user import User
from app.services.email import app_link, layout, send_email
from app.services.notifications import notify, notify_bosses
from app.utils.auth import current_user, roles
from app.utils.time import utcnow
from app.utils.validation import json_body, text
from app.i18n import N_, _, speaking

bp = Blueprint("messages", __name__)
MAX_LENGTH = 2000
# How much of a message a notification shows.
PREVIEW = 120
PAGE = 200


def preview(body):
    body = " ".join(body.split())
    return body if len(body) <= PREVIEW else body[: PREVIEW - 1] + "…"


def message_out(message, user, names):
    return {
        "id": message.id,
        "body": message.body,
        "created_at": message.created_at.isoformat(),
        "from_customer": message.from_customer,
        "sender": names.get(message.sender_id),
        "mine": message.sender_id == user.id,
        "read_at": message.read_at.isoformat() if message.read_at else None,
    }


def thread(company_id, customer_id, user):
    """The conversation, oldest first, with what the other side wrote marked read."""
    query = CustomerMessage.query.filter_by(company_id=company_id, customer_id=customer_id)
    unread = query.filter(CustomerMessage.from_customer.is_(user.role != "customer"), CustomerMessage.read_at.is_(None))
    if unread.count():
        unread.update({"read_at": utcnow()}, synchronize_session=False)
        db.session.commit()
    messages = query.order_by(CustomerMessage.created_at.desc(), CustomerMessage.id.desc()).limit(PAGE).all()[::-1]
    ids = {message.sender_id for message in messages if message.sender_id}
    names = {person.id: person.name for person in User.query.filter(User.id.in_(ids)).all()} if ids else {}
    return [message_out(message, user, names) for message in messages]


def add_message(company_id, customer_id, user):
    body = text(json_body(), "body", "Message", required=True, max_length=MAX_LENGTH)
    message = CustomerMessage(company_id=company_id, customer_id=customer_id, sender_id=user.id, from_customer=user.role == "customer", body=body)
    db.session.add(message)
    db.session.flush()
    return message


@bp.get("")
@roles("boss", "customer")
def conversations():
    """A manager's list of conversations, newest first, with what's unread; a customer's own count."""
    user = current_user()
    if user.role == "customer":
        unread = CustomerMessage.query.filter_by(
            company_id=user.company_id, customer_id=user.customer_id, from_customer=False, read_at=None
        ).count()
        return jsonify(unread=unread)
    last = (
        db.session.query(CustomerMessage.customer_id, func.max(CustomerMessage.id).label("last_id"))
        .filter(CustomerMessage.company_id == user.company_id)
        .group_by(CustomerMessage.customer_id)
        .subquery()
    )
    latest = CustomerMessage.query.join(last, CustomerMessage.id == last.c.last_id).all()
    unread = dict(
        db.session.query(CustomerMessage.customer_id, func.count(CustomerMessage.id))
        .filter(CustomerMessage.company_id == user.company_id, CustomerMessage.from_customer.is_(True), CustomerMessage.read_at.is_(None))
        .group_by(CustomerMessage.customer_id)
        .all()
    )
    customers = {customer.id: customer.name for customer in Customer.query.filter_by(company_id=user.company_id).all()}
    rows = [
        {
            "customer_id": message.customer_id,
            "customer": customers.get(message.customer_id, ""),
            "last": {"body": preview(message.body), "created_at": message.created_at.isoformat(), "from_customer": message.from_customer},
            "unread": unread.get(message.customer_id, 0),
        }
        for message in latest
    ]
    rows.sort(key=lambda row: row["last"]["created_at"], reverse=True)
    return jsonify(conversations=rows, unread=sum(unread.values()))


@bp.get("/mine")
@roles("customer")
def my_thread():
    user = current_user()
    company = db.session.get(Company, user.company_id)
    return jsonify(company=company.name, messages=thread(user.company_id, user.customer_id, user))


@bp.post("/mine")
@roles("customer")
def send_to_company():
    user = current_user()
    message = add_message(user.company_id, user.customer_id, user)
    customer = db.session.get(Customer, user.customer_id)
    notify_bosses(user.company_id, N_("New message"), N_("{sender}: {message}"), "message", sender=customer.name, message=preview(message.body))
    db.session.commit()
    return jsonify(message=message_out(message, user, {user.id: user.name})), 201


@bp.get("/<int:cid>")
@roles("boss")
def customer_thread(cid):
    user = current_user()
    customer = Customer.query.filter_by(id=cid, company_id=user.company_id).first_or_404()
    return jsonify(customer={"id": customer.id, "name": customer.name}, messages=thread(user.company_id, customer.id, user))


@bp.post("/<int:cid>")
@roles("boss")
def send_to_customer(cid):
    user = current_user()
    customer = Customer.query.filter_by(id=cid, company_id=user.company_id).first_or_404()
    # Emailed only when nothing from the company is waiting unread already.
    waiting = CustomerMessage.query.filter_by(company_id=user.company_id, customer_id=customer.id, from_customer=False, read_at=None).count()
    message = add_message(user.company_id, customer.id, user)
    company = db.session.get(Company, user.company_id)
    link = app_link("/messages")
    for person in User.query.filter_by(company_id=user.company_id, customer_id=customer.id, role="customer", removed_at=None).all():
        notify(person.id, N_("New message"), N_("{sender}: {message}"), "message", (), sender=company.name, message=preview(message.body))
        if waiting:
            continue
        with speaking(person.language):
            subject = _("New message from {company}", company=company.name)
            paragraphs = [message.body]
            send_email(
                person.email,
                subject,
                "\n\n".join([*paragraphs, _("Reply in MechanicPro: {link}", link=link)]),
                layout(subject, paragraphs, (_("Reply"), link)),
                company_id=user.company_id,
            )
    db.session.commit()
    return jsonify(message=message_out(message, user, {user.id: user.name})), 201
