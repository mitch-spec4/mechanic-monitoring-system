from werkzeug.security import check_password_hash, generate_password_hash

from app import db


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(160), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(30), nullable=False)  # boss, mechanic, customer
    company_id = db.Column(db.Integer, db.ForeignKey("company.id"), nullable=False, index=True)
    customer_id = db.Column(db.Integer, db.ForeignKey("customer.id"), nullable=True, index=True)
    # Bumped on password change/reset so every existing session stops working.
    token_version = db.Column(db.Integer, nullable=False, default=0, server_default="0")
    # When a mechanic agreed to location sharing while clocked in (None: not agreed or withdrawn).
    location_consent_at = db.Column(db.DateTime)
    # When the owner of the email address proved it (a verification or password-reset link).
    email_verified_at = db.Column(db.DateTime)
    # The language this person reads the app, emails and notifications in (see app/i18n).
    language = db.Column(db.String(5), nullable=False, default="en", server_default="en")
    # Two-step sign-in with an authenticator app (see app/services/two_factor.py). The secret is
    # stored encrypted; the last code's time step is kept so a code can't be used twice.
    totp_secret = db.Column(db.String(255))
    totp_enabled_at = db.Column(db.DateTime)
    totp_last_step = db.Column(db.BigInteger)
    # Wrong passwords or codes in a row; at 5 the account is locked until locked_until.
    failed_logins = db.Column(db.Integer, nullable=False, default=0, server_default="0")
    locked_until = db.Column(db.DateTime)
    # The privacy policy and terms this person agreed to, and when.
    terms_version = db.Column(db.String(20))
    terms_accepted_at = db.Column(db.DateTime)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)
        self.token_version = (self.token_version or 0) + 1

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)
