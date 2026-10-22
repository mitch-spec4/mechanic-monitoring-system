import re
from datetime import date

from flask import request

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class ValidationError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def json_body():
    data = request.get_json(silent=True)
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise ValidationError("Request body must be a JSON object")
    return data


def text(data, field, label=None, required=False, max_length=None):
    """Return a stripped string or None. Missing/blank values raise only when required."""
    label = label or field.replace("_", " ").capitalize()
    value = data.get(field)
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            raise ValidationError(f"{label} is required")
        return None
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        raise ValidationError(f"{label} must be text")
    value = str(value).strip()
    if max_length and len(value) > max_length:
        raise ValidationError(f"{label} must be at most {max_length} characters")
    return value


def email(data, field="email", required=True):
    value = text(data, field, "Email", required=required, max_length=160)
    if value is None:
        return None
    value = value.lower()
    if not EMAIL_PATTERN.match(value):
        raise ValidationError("Enter a valid email address")
    return value


def integer(data, field, label=None, required=False, minimum=None, maximum=None):
    """Accept ints or numeric strings (HTML forms send strings); blank means None."""
    label = label or field.replace("_", " ").capitalize()
    value = data.get(field)
    if value is None or value == "":
        if required:
            raise ValidationError(f"{label} is required")
        return None
    if isinstance(value, bool):
        raise ValidationError(f"{label} must be a whole number")
    try:
        number = int(str(value).strip())
    except ValueError:
        raise ValidationError(f"{label} must be a whole number") from None
    if (minimum is not None and number < minimum) or (maximum is not None and number > maximum):
        raise ValidationError(f"{label} must be between {minimum} and {maximum}")
    return number


def choice(data, field, options, label=None, default=None):
    label = label or field.replace("_", " ").capitalize()
    value = data.get(field)
    if value is None or value == "":
        return default
    if value not in options:
        raise ValidationError(f"{label} must be one of: {', '.join(options)}")
    return value


def iso_date(data, field, label=None):
    label = label or field.replace("_", " ").capitalize()
    value = data.get(field)
    if value is None or value == "":
        return None
    try:
        return date.fromisoformat(str(value).strip())
    except ValueError:
        raise ValidationError(f"{label} must be a date in YYYY-MM-DD format") from None
