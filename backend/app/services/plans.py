"""Subscription plans. Prices are in cents of Kenyan shillings; yearly billing charges ten months (two free).

Each plan has a technician limit (more can be added at EXTRA_MECHANIC_CENTS a month each), a storage
limit, and the features it includes. A feature is named by a key the API and the app both check
(app/services/billing.py `require_feature`, and `features` on the signed-in user).
"""
import calendar

from app.i18n import N_

CURRENCY = "KES"
TRIAL_DAYS = 14
INTERVALS = ("month", "year")
YEARLY_MONTHS = 10
GB = 1024**3
# Each technician beyond the plan's own, a month (about USD 4).
EXTRA_MECHANIC_CENTS = 50_000
MAX_EXTRA_MECHANICS = 100

# What each feature is called, in the order plans list them.
FEATURE_NAMES = {
    "insights": N_("Insights and exports"),
    "maintenance": N_("Planned maintenance and reminders"),
    "routes": N_("Route planning"),
    "costing": N_("Job costing and margins"),
}
# Everything else (jobs, worksheets, equipment, customers, photos, sign-off, reports, clock-in,
# the team map, requests, booking and chat, offline mode) is in every plan.
PLANS = {
    "starter": {"name": "Starter", "monthly_cents": 150_000, "mechanics": 3, "storage_gb": 2, "features": ()},
    "professional": {"name": "Professional", "monthly_cents": 450_000, "mechanics": 10, "storage_gb": 20, "features": ("insights", "maintenance")},
    "business": {
        "name": "Business",
        "monthly_cents": 1_200_000,
        "mechanics": 30,
        "storage_gb": 100,
        "features": ("insights", "maintenance", "routes", "costing"),
    },
}
ALL_FEATURES = tuple(FEATURE_NAMES)


def price_cents(plan, interval, extra_mechanics=0):
    monthly = PLANS[plan]["monthly_cents"] + extra_mechanics * EXTRA_MECHANIC_CENTS
    return monthly * YEARLY_MONTHS if interval == "year" else monthly


def first_plan_with(feature):
    """The cheapest plan that includes a feature."""
    return next(key for key, plan in PLANS.items() if feature in plan["features"])


def plan_out(key):
    plan = PLANS[key]
    return {
        "key": key,
        "name": plan["name"],
        "mechanics": plan["mechanics"],
        "storage_gb": plan["storage_gb"],
        "features": list(plan["features"]),
        "prices": {interval: price_cents(key, interval) for interval in INTERVALS},
    }


def add_period(moment, interval):
    """One calendar month or year later, keeping the day where the month allows it."""
    months = 12 if interval == "year" else 1
    month_index = moment.month - 1 + months
    year, month = moment.year + month_index // 12, month_index % 12 + 1
    return moment.replace(year=year, month=month, day=min(moment.day, calendar.monthrange(year, month)[1]))
