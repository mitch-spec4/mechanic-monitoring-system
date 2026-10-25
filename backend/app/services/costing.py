"""What a job cost and what it made, for managers only.

Labour is each technician's worksheet time on the job times their pay rate; parts are each part's
quantity times its unit cost. Both are in the company's currency, in cents. A technician with no
pay rate, or a part with no cost, is left out of the total and listed, so the gap is visible
rather than counted as free. The margin is what the customer is charged less the cost.
"""
from decimal import ROUND_HALF_UP, Decimal

from app.models.user import User
from app.models.worksheet import JobPart, WorkEntry
from app.utils.time import utcnow


def cents(value):
    return int(Decimal(value).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def job_costing(job, now=None):
    now = now or utcnow()
    entries = WorkEntry.query.filter_by(job_id=job.id).all()
    hours = {}
    for entry in entries:
        worked = max(((entry.ended_at or now) - entry.started_at).total_seconds(), 0) / 3600
        hours[entry.mechanic_id] = hours.get(entry.mechanic_id, 0) + worked
    people = {person.id: person for person in User.query.filter(User.id.in_(list(hours) or [0])).all()}
    labour = []
    for person_id, worked in sorted(hours.items(), key=lambda item: people[item[0]].name if item[0] in people else ""):
        rate = people[person_id].pay_rate_cents if person_id in people else None
        labour.append(
            {
                "mechanic_id": person_id,
                "name": people[person_id].name if person_id in people else None,
                "hours": round(worked, 2),
                "rate_cents": rate,
                "cost_cents": cents(Decimal(str(worked)) * rate) if rate is not None else None,
            }
        )
    parts = []
    for part in JobPart.query.filter_by(job_id=job.id).order_by(JobPart.id).all():
        cost = cents(part.quantity * part.unit_cost_cents) if part.unit_cost_cents is not None else None
        parts.append({"id": part.id, "name": part.name, "quantity": float(part.quantity), "unit_cost_cents": part.unit_cost_cents, "cost_cents": cost})
    labour_cents = sum(row["cost_cents"] for row in labour if row["cost_cents"] is not None)
    parts_cents = sum(row["cost_cents"] for row in parts if row["cost_cents"] is not None)
    total = labour_cents + parts_cents
    charged = job.charged_cents
    margin = charged - total if charged is not None else None
    return {
        "labour": labour,
        "parts": parts,
        "labour_cents": labour_cents,
        "parts_cents": parts_cents,
        "cost_cents": total,
        "charged_cents": charged,
        "margin_cents": margin,
        "margin_percent": round(margin / charged * 100) if charged else None,
        # What the total leaves out.
        "missing_rates": [row["name"] for row in labour if row["rate_cents"] is None],
        "missing_costs": [row["name"] for row in parts if row["unit_cost_cents"] is None],
    }
