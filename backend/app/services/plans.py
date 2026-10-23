"""Subscription plans. Prices are in cents of Kenyan shillings; yearly billing charges ten months (two free)."""
import calendar

CURRENCY = "KES"
TRIAL_DAYS = 14
INTERVALS = ("month", "year")
YEARLY_MONTHS = 10
GB = 1024**3

PLANS = {
    "starter": {"name": "Starter", "monthly_cents": 150_000, "mechanics": 3, "storage_gb": 2},
    "professional": {"name": "Professional", "monthly_cents": 450_000, "mechanics": 10, "storage_gb": 20},
    "business": {"name": "Business", "monthly_cents": 1_200_000, "mechanics": 30, "storage_gb": 100},
}


def price_cents(plan, interval):
    monthly = PLANS[plan]["monthly_cents"]
    return monthly * YEARLY_MONTHS if interval == "year" else monthly


def plan_out(key):
    plan = PLANS[key]
    return {
        "key": key,
        "name": plan["name"],
        "mechanics": plan["mechanics"],
        "storage_gb": plan["storage_gb"],
        "prices": {interval: price_cents(key, interval) for interval in INTERVALS},
    }


def add_period(moment, interval):
    """One calendar month or year later, keeping the day where the month allows it."""
    months = 12 if interval == "year" else 1
    month_index = moment.month - 1 + months
    year, month = moment.year + month_index // 12, month_index % 12 + 1
    return moment.replace(year=year, month=month, day=min(moment.day, calendar.monthrange(year, month)[1]))
