"""Each person's language, and company time zone, currency and units

Revision ID: 0008_language_settings
Revises: 0007_email_demo_setup
Create Date: 2026-10-23 16:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0008_language_settings'
down_revision = '0007_email_demo_setup'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('user', schema=None) as batch_op:
        batch_op.add_column(sa.Column('language', sa.String(length=5), server_default='en', nullable=False))

    with op.batch_alter_table('company', schema=None) as batch_op:
        batch_op.add_column(sa.Column('timezone', sa.String(length=64), server_default='Africa/Nairobi', nullable=False))
        batch_op.add_column(sa.Column('currency', sa.String(length=3), server_default='KES', nullable=False))
        batch_op.add_column(sa.Column('units', sa.String(length=10), server_default='metric', nullable=False))


def downgrade():
    with op.batch_alter_table('company', schema=None) as batch_op:
        batch_op.drop_column('units')
        batch_op.drop_column('currency')
        batch_op.drop_column('timezone')

    with op.batch_alter_table('user', schema=None) as batch_op:
        batch_op.drop_column('language')
