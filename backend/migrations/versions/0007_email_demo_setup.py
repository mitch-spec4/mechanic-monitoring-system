"""Verified email addresses, private demo companies and the setup guide

Revision ID: 0007_email_demo_setup
Revises: 0006_professional_plan
Create Date: 2026-10-23 10:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0007_email_demo_setup'
down_revision = '0006_professional_plan'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('user', schema=None) as batch_op:
        batch_op.add_column(sa.Column('email_verified_at', sa.DateTime(), nullable=True))

    with op.batch_alter_table('company', schema=None) as batch_op:
        batch_op.add_column(sa.Column('demo_expires_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('setup_dismissed_at', sa.DateTime(), nullable=True))
        batch_op.create_index(batch_op.f('ix_company_demo_expires_at'), ['demo_expires_at'], unique=False)

    # Accounts made before email verification existed keep working: their addresses count as
    # confirmed, and existing companies don't get the new setup guide.
    user = sa.table('user', sa.column('email_verified_at', sa.DateTime()))
    company = sa.table('company', sa.column('setup_dismissed_at', sa.DateTime()))
    op.execute(user.update().values(email_verified_at=sa.func.current_timestamp()))
    op.execute(company.update().values(setup_dismissed_at=sa.func.current_timestamp()))


def downgrade():
    with op.batch_alter_table('company', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_company_demo_expires_at'))
        batch_op.drop_column('setup_dismissed_at')
        batch_op.drop_column('demo_expires_at')

    with op.batch_alter_table('user', schema=None) as batch_op:
        batch_op.drop_column('email_verified_at')
