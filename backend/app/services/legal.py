"""The privacy policy and terms of service, read from backend/legal/*.md.

Each file starts with a "Version: ..." line; the rest is Markdown. The version someone agreed to
is saved on their account (User.terms_version), so a new version can be detected later.
"""
from functools import lru_cache
from pathlib import Path

from app.utils.time import utcnow

LEGAL_DIR = Path(__file__).resolve().parents[2] / "legal"
DOCUMENTS = ("privacy", "terms")


@lru_cache(maxsize=None)
def document(name):
    if name not in DOCUMENTS:
        raise KeyError(name)
    lines = (LEGAL_DIR / f"{name}.md").read_text(encoding="utf-8").splitlines()
    version = "unversioned"
    if lines and lines[0].lower().startswith("version:"):
        version = lines[0].split(":", 1)[1].strip() or version
        lines = lines[1:]
    return {"name": name, "version": version, "text": "\n".join(lines).strip()}


def current_version():
    """One version for both documents: agreeing covers the pair."""
    return "+".join(document(name)["version"] for name in DOCUMENTS)[:20]


def record_agreement(user):
    user.terms_version = current_version()
    user.terms_accepted_at = utcnow()
