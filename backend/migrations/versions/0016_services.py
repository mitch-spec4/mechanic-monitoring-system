"""Service catalog: services the company offers, jobs and customer requests made from them

Revision ID: 0016_services
Revises: 0015_billing
Create Date: 2026-10-25 08:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0016_services'
down_revision = '0015_billing'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('service_template',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('company_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('equipment_type', sa.String(length=80), nullable=True),
    sa.Column('checklist_id', sa.Integer(), nullable=True),
    sa.Column('duration_minutes', sa.Integer(), nullable=False),
    sa.Column('skills', sa.JSON(), nullable=False),
    sa.Column('booking', sa.String(length=20), server_default='none', nullable=False),
    sa.Column('active', sa.Boolean(), server_default=sa.true(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['checklist_id'], ['checklist_template.id'], name=op.f('fk_service_template_checklist_id_checklist_template')),
    sa.ForeignKeyConstraint(['company_id'], ['company.id'], name=op.f('fk_service_template_company_id_company')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_service_template'))
    )
    with op.batch_alter_table('service_template', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_service_template_checklist_id'), ['checklist_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_service_template_company_id'), ['company_id'], unique=False)

    with op.batch_alter_table('job', schema=None) as batch_op:
        batch_op.add_column(sa.Column('service_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('estimated_minutes', sa.Integer(), nullable=True))
        batch_op.create_index(batch_op.f('ix_job_service_id'), ['service_id'], unique=False)
        batch_op.create_foreign_key(batch_op.f('fk_job_service_id_service_template'), 'service_template', ['service_id'], ['id'])

    with op.batch_alter_table('service_request', schema=None) as batch_op:
        batch_op.add_column(sa.Column('service_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('booking', sa.String(length=20), server_default='inspection', nullable=False))
        batch_op.create_index(batch_op.f('ix_service_request_service_id'), ['service_id'], unique=False)
        batch_op.create_foreign_key(batch_op.f('fk_service_request_service_id_service_template'), 'service_template', ['service_id'], ['id'])



def downgrade():
    with op.batch_alter_table('service_request', schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f('fk_service_request_service_id_service_template'), type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_service_request_service_id'))
        batch_op.drop_column('booking')
        batch_op.drop_column('service_id')

    with op.batch_alter_table('job', schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f('fk_job_service_id_service_template'), type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_job_service_id'))
        batch_op.drop_column('estimated_minutes')
        batch_op.drop_column('service_id')

    with op.batch_alter_table('service_template', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_service_template_company_id'))
        batch_op.drop_index(batch_op.f('ix_service_template_checklist_id'))

    op.drop_table('service_template')
