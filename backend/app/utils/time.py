from datetime import datetime, timezone


def utcnow():
    """Naive UTC timestamp, matching how DateTime columns are stored."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
