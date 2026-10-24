"""Booking: visits booked by customers, booking settings, the customer chat, new request steps

Revision ID: 0012_booking
Revises: 0011_offline_sync
Create Date: 2026-10-24 13:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0012_booking'
down_revision = '0011_offline_sync'
branch_labels = None
depends_on = None

# The old request steps were set by hand and never tied to a visit: those requests wait for the
# customer to book one.
OLD_OPEN_STATUSES = ("Received", "Reviewing", "Approved", "Mechanic Assigned", "Scheduled", "In Progress")


def upgrade():
    op.create_table(
        'customer_message',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('company_id', sa.Integer(), nullable=False),
        sa.Column('customer_id', sa.Integer(), nullable=False),
        sa.Column('sender_id', sa.Integer(), nullable=True),
        sa.Column('from_customer', sa.Boolean(), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('read_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['company_id'], ['company.id'], name=op.f('fk_customer_message_company_id_company')),
        sa.ForeignKeyConstraint(['customer_id'], ['customer.id'], name=op.f('fk_customer_message_customer_id_customer')),
        sa.ForeignKeyConstraint(['sender_id'], ['user.id'], name=op.f('fk_customer_message_sender_id_user')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_customer_message')),
    )
    with op.batch_alter_table('customer_message', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_customer_message_company_id'), ['company_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_customer_message_customer_id'), ['customer_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_customer_message_created_at'), ['created_at'], unique=False)

    with op.batch_alter_table('company', schema=None) as batch_op:
        batch_op.add_column(sa.Column('booking_days', sa.String(length=20), server_default='1,2,3,4,5', nullable=False))
        batch_op.add_column(sa.Column('booking_start', sa.String(length=5), server_default='08:00', nullable=False))
        batch_op.add_column(sa.Column('booking_end', sa.String(length=5), server_default='17:00', nullable=False))
        batch_op.add_column(sa.Column('inspection_minutes', sa.Integer(), server_default='120', nullable=False))
        batch_op.add_column(sa.Column('repair_minutes', sa.Integer(), server_default='240', nullable=False))
        batch_op.add_column(sa.Column('travel_minutes', sa.Integer(), server_default='30', nullable=False))
        batch_op.add_column(sa.Column('booking_notice_hours', sa.Integer(), server_default='24', nullable=False))
        batch_op.add_column(sa.Column('booking_window_days', sa.Integer(), server_default='14', nullable=False))

    with op.batch_alter_table('service_request', schema=None) as batch_op:
        batch_op.add_column(sa.Column('updated_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('repair_minutes', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('inspected_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('completed_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('repair_reminder_sent_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('follow_up_sent_at', sa.DateTime(), nullable=True))

    with op.batch_alter_table('job', schema=None) as batch_op:
        batch_op.add_column(sa.Column('request_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('visit', sa.String(length=20), nullable=True))
        batch_op.add_column(sa.Column('scheduled_start', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('scheduled_end', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('on_the_way_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('reminder_sent_at', sa.DateTime(), nullable=True))
        batch_op.create_index(batch_op.f('ix_job_request_id'), ['request_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_job_scheduled_start'), ['scheduled_start'], unique=False)
        batch_op.create_foreign_key(batch_op.f('fk_job_request_id_service_request'), 'service_request', ['request_id'], ['id'])

    request = sa.table('service_request', sa.column('status', sa.String))
    op.execute(request.update().where(request.c.status.in_(OLD_OPEN_STATUSES)).values(status='Submitted'))


def downgrade():
    with op.batch_alter_table('job', schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f('fk_job_request_id_service_request'), type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_job_scheduled_start'))
        batch_op.drop_index(batch_op.f('ix_job_request_id'))
        batch_op.drop_column('reminder_sent_at')
        batch_op.drop_column('on_the_way_at')
        batch_op.drop_column('scheduled_end')
        batch_op.drop_column('scheduled_start')
        batch_op.drop_column('visit')
        batch_op.drop_column('request_id')

    with op.batch_alter_table('service_request', schema=None) as batch_op:
        batch_op.drop_column('follow_up_sent_at')
        batch_op.drop_column('repair_reminder_sent_at')
        batch_op.drop_column('completed_at')
        batch_op.drop_column('inspected_at')
        batch_op.drop_column('repair_minutes')
        batch_op.drop_column('updated_at')

    with op.batch_alter_table('company', schema=None) as batch_op:
        batch_op.drop_column('booking_window_days')
        batch_op.drop_column('booking_notice_hours')
        batch_op.drop_column('travel_minutes')
        batch_op.drop_column('repair_minutes')
        batch_op.drop_column('inspection_minutes')
        batch_op.drop_column('booking_end')
        batch_op.drop_column('booking_start')
        batch_op.drop_column('booking_days')

    with op.batch_alter_table('customer_message', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_customer_message_created_at'))
        batch_op.drop_index(batch_op.f('ix_customer_message_customer_id'))
        batch_op.drop_index(batch_op.f('ix_customer_message_company_id'))

    op.drop_table('customer_message')

    # The new steps map back to the closest old ones.
    request = sa.table('service_request', sa.column('status', sa.String))
    op.execute(request.update().where(request.c.status.in_(('Inspection booked', 'Repair booked'))).values(status='Scheduled'))
    op.execute(request.update().where(request.c.status == 'Inspected').values(status='Reviewing'))
    op.execute(request.update().where(request.c.status == 'Declined').values(status='Cancelled'))
