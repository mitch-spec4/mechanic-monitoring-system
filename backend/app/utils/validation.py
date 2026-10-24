import re
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from flask import request

from app.i18n import _

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class ValidationError(Exception):
    def __init__(self, message, status=400, **extra):
        super().__init__(message)
        self.message = message
        self.status = status
        # Extra fields for the JSON error body (e.g. what still blocks completing a job).
        self.extra = extra


def agreed_to_terms(data):
    """The "I agree to the privacy policy and terms" box at signup and when joining a company."""
    if data.get("accept_terms") is not True:
        raise ValidationError(_("Please agree to the privacy policy and terms to continue."))


def default_label(field):
    """"due_date" -> "Due date", the label used when a caller doesn't name the field."""
    return field.replace("_", " ").capitalize()


def json_body():
    data = request.get_json(silent=True)
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise ValidationError(_("Request body must be a JSON object"))
    return data


def text(data, field, label=None, required=False, max_length=None):
    """Return a stripped string or None. Missing/blank values raise only when required."""
    label = _(label or default_label(field))
    value = data.get(field)
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            raise ValidationError(_("{label} is required", label=label))
        return None
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        raise ValidationError(_("{label} must be text", label=label))
    value = str(value).strip()
    if max_length and len(value) > max_length:
        raise ValidationError(_("{label} must be at most {count} characters", label=label, count=max_length))
    return value


def email(data, field="email", required=True):
    value = text(data, field, "Email", required=required, max_length=160)
    if value is None:
        return None
    value = value.lower()
    if not EMAIL_PATTERN.match(value):
        raise ValidationError(_("Enter a valid email address"))
    return value


def integer(data, field, label=None, required=False, minimum=None, maximum=None):
    """Accept ints or numeric strings (HTML forms send strings); blank means None."""
    label = _(label or default_label(field))
    value = data.get(field)
    if value is None or value == "":
        if required:
            raise ValidationError(_("{label} is required", label=label))
        return None
    if isinstance(value, bool):
        raise ValidationError(_("{label} must be a whole number", label=label))
    try:
        number = int(str(value).strip())
    except ValueError:
        raise ValidationError(_("{label} must be a whole number", label=label)) from None
    if (minimum is not None and number < minimum) or (maximum is not None and number > maximum):
        raise ValidationError(_("{label} must be between {minimum} and {maximum}", label=label, minimum=minimum, maximum=maximum))
    return number


def choice(data, field, options, label=None, default=None):
    label = _(label or default_label(field))
    value = data.get(field)
    if value is None or value == "":
        return default
    if value not in options:
        raise ValidationError(_("{label} must be one of: {options}", label=label, options=", ".join(options)))
    return value


def iso_date(data, field, label=None):
    label = _(label or default_label(field))
    value = data.get(field)
    if value is None or value == "":
        return None
    try:
        return date.fromisoformat(str(value).strip())
    except ValueError:
        raise ValidationError(_("{label} must be a date in YYYY-MM-DD format", label=label)) from None


MAX_MONEY_CENTS = 10_000_000_000  # 100 million in the currency: no real job costs more.


def money(data, field, label=None):
    """An amount of money ("18000", 18000.5, "18,000.50") as cents; blank or null means None."""
    label = _(label or default_label(field))
    value = data.get(field)
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ValidationError(_("{label} must be an amount, like 1500 or 1500.50", label=label))
    try:
        amount = Decimal(str(value).replace(",", "").strip())
    except InvalidOperation:
        raise ValidationError(_("{label} must be an amount, like 1500 or 1500.50", label=label)) from None
    if not amount.is_finite() or amount < 0 or amount * 100 > MAX_MONEY_CENTS:
        raise ValidationError(_("{label} must be an amount, like 1500 or 1500.50", label=label))
    return int((amount * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def coordinates(data, field="position", label=None):
    """A map pin {"latitude": .., "longitude": ..} as a pair of floats; null clears it."""
    value = data.get(field)
    if value is None:
        return None, None
    label = _(label or default_label(field))
    try:
        latitude, longitude = float(value["latitude"]), float(value["longitude"])
    except (TypeError, KeyError, ValueError):
        raise ValidationError(_("{label} must be a point on the map", label=label)) from None
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180) or latitude != latitude or longitude != longitude:
        raise ValidationError(_("{label} must be a point on the map", label=label))
    return round(latitude, 6), round(longitude, 6)
