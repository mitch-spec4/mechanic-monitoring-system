"""Offline sync: queued changes answered once, when changes were made, last-change times

Revision ID: 0011_offline_sync
Revises: 0010_company_language
Create Date: 2026-10-24 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0011_offline_sync'
down_revision = '0010_company_language'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'client_request',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('key', sa.String(length=80), nullable=False),
        sa.Column('method', sa.String(length=10), nullable=False),
        sa.Column('path', sa.String(length=300), nullable=False),
        sa.Column('status_code', sa.Integer(), nullable=True),
        sa.Column('body', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], name=op.f('fk_client_request_user_id_user')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_client_request')),
        sa.UniqueConstraint('user_id', 'key', name='uq_client_request_user_key'),
    )
    with op.batch_alter_table('client_request', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_client_request_created_at'), ['created_at'], unique=False)

    with op.batch_alter_table('job_event', schema=None) as batch_op:
        batch_op.add_column(sa.Column('synced_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('previous_mechanic_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key(batch_op.f('fk_job_event_previous_mechanic_id_user'), 'user', ['previous_mechanic_id'], ['id'])

    with op.batch_alter_table('job_checklist_item', schema=None) as batch_op:
        batch_op.add_column(sa.Column('changed_at', sa.DateTime(), nullable=True))

    with op.batch_alter_table('work_entry', schema=None) as batch_op:
        batch_op.add_column(sa.Column('updated_at', sa.DateTime(), nullable=True))

    with op.batch_alter_table('service_record', schema=None) as batch_op:
        batch_op.add_column(sa.Column('updated_at', sa.DateTime(), nullable=True))

    with op.batch_alter_table('job_file', schema=None) as batch_op:
        batch_op.add_column(sa.Column('client_key', sa.String(length=80), nullable=True))
        batch_op.create_unique_constraint('uq_job_file_uploaded_by_client_key', ['uploaded_by', 'client_key'])


def downgrade():
    with op.batch_alter_table('job_file', schema=None) as batch_op:
        batch_op.drop_constraint('uq_job_file_uploaded_by_client_key', type_='unique')
        batch_op.drop_column('client_key')

    with op.batch_alter_table('service_record', schema=None) as batch_op:
        batch_op.drop_column('updated_at')

    with op.batch_alter_table('work_entry', schema=None) as batch_op:
        batch_op.drop_column('updated_at')

    with op.batch_alter_table('job_checklist_item', schema=None) as batch_op:
        batch_op.drop_column('changed_at')

    with op.batch_alter_table('job_event', schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f('fk_job_event_previous_mechanic_id_user'), type_='foreignkey')
        batch_op.drop_column('previous_mechanic_id')
        batch_op.drop_column('synced_at')

    with op.batch_alter_table('client_request', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_client_request_created_at'))

    op.drop_table('client_request')
