"""Removed people: someone with work in the history loses access but stays named in it

Revision ID: 0018_removed_people
Revises: 0017_forms
Create Date: 2026-10-25 15:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0018_removed_people'
down_revision = '0017_forms'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('user', schema=None) as batch_op:
        batch_op.add_column(sa.Column('removed_at', sa.DateTime(), nullable=True))


def downgrade():
    with op.batch_alter_table('user', schema=None) as batch_op:
        batch_op.drop_column('removed_at')
