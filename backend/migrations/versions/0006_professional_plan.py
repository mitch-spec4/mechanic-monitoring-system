"""Rename the Team plan to Professional

Revision ID: 0006_professional_plan
Revises: 0005_billing
Create Date: 2026-10-23 05:10:00.000000

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = '0006_professional_plan'
down_revision = '0005_billing'
branch_labels = None
depends_on = None


def upgrade():
    # Before prices moved to shillings the middle plan was called Team, with the same limits.
    # Databases that ran that version (the demo, local copies) still name it.
    op.execute("UPDATE subscription SET plan = 'professional' WHERE plan = 'team'")
    op.execute("UPDATE payment SET plan = 'professional' WHERE plan = 'team'")


def downgrade():
    # No code ever ran on 0005 without the rename, so there is nothing to put back.
    pass
