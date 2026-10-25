"""Billing: extra technicians, renewals with a saved card, payment failures and webhook events

Revision ID: 0015_billing
Revises: 0014_routes_costing
Create Date: 2026-10-24 22:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0015_billing'
down_revision = '0014_routes_costing'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('billing_event',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('provider', sa.String(length=20), nullable=False),
    sa.Column('event_id', sa.String(length=128), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('reference', sa.String(length=64), nullable=True),
    sa.Column('company_id', sa.Integer(), nullable=True),
    sa.Column('received_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['company_id'], ['company.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('provider', 'event_id', name='uq_billing_event')
    )
    with op.batch_alter_table('billing_event', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_billing_event_company_id'), ['company_id'], unique=False)

    with op.batch_alter_table('payment', schema=None) as batch_op:
        batch_op.add_column(sa.Column('kind', sa.String(length=10), server_default='checkout', nullable=False))
        batch_op.add_column(sa.Column('extra_mechanics', sa.Integer(), server_default='0', nullable=False))
        batch_op.add_column(sa.Column('failure_reason', sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column('failed_at', sa.DateTime(), nullable=True))

    with op.batch_alter_table('subscription', schema=None) as batch_op:
        batch_op.add_column(sa.Column('extra_mechanics', sa.Integer(), server_default='0', nullable=False))
        batch_op.add_column(sa.Column('auto_renew', sa.Boolean(), server_default=sa.true(), nullable=False))
        batch_op.add_column(sa.Column('payment_token', sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column('payment_method', sa.String(length=80), nullable=True))
        batch_op.add_column(sa.Column('past_due_since', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('reminded_at', sa.DateTime(), nullable=True))


def downgrade():
    with op.batch_alter_table('subscription', schema=None) as batch_op:
        batch_op.drop_column('reminded_at')
        batch_op.drop_column('past_due_since')
        batch_op.drop_column('payment_method')
        batch_op.drop_column('payment_token')
        batch_op.drop_column('auto_renew')
        batch_op.drop_column('extra_mechanics')

    with op.batch_alter_table('payment', schema=None) as batch_op:
        batch_op.drop_column('failed_at')
        batch_op.drop_column('failure_reason')
        batch_op.drop_column('extra_mechanics')
        batch_op.drop_column('kind')

    with op.batch_alter_table('billing_event', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_billing_event_company_id'))

    op.drop_table('billing_event')
