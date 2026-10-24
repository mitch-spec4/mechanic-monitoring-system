"""Equipment: types and details, customers' sites, maintenance plans, equipment documents

Revision ID: 0013_equipment
Revises: 0012_booking
Create Date: 2026-10-24 16:20:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0013_equipment'
down_revision = '0012_booking'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('site',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('company_id', sa.Integer(), nullable=False),
    sa.Column('customer_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=150), nullable=False),
    sa.Column('address', sa.String(length=255), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['company_id'], ['company.id'], name=op.f('fk_site_company_id_company')),
    sa.ForeignKeyConstraint(['customer_id'], ['customer.id'], name=op.f('fk_site_customer_id_customer')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_site')),
    sa.UniqueConstraint('customer_id', 'name', name='uq_site_customer_name')
    )
    with op.batch_alter_table('site', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_site_company_id'), ['company_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_site_customer_id'), ['customer_id'], unique=False)

    op.create_table('maintenance_plan',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('company_id', sa.Integer(), nullable=False),
    sa.Column('machine_id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=150), nullable=False),
    sa.Column('job_type', sa.String(length=80), nullable=True),
    sa.Column('every', sa.Integer(), nullable=False),
    sa.Column('unit', sa.String(length=10), nullable=False),
    sa.Column('next_due', sa.Date(), nullable=False),
    sa.Column('lead_days', sa.Integer(), server_default='7', nullable=False),
    sa.Column('active', sa.Boolean(), server_default='1', nullable=False),
    sa.Column('last_done', sa.Date(), nullable=True),
    sa.Column('reminded_for', sa.Date(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['company_id'], ['company.id'], name=op.f('fk_maintenance_plan_company_id_company')),
    sa.ForeignKeyConstraint(['machine_id'], ['machine.id'], name=op.f('fk_maintenance_plan_machine_id_machine')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_maintenance_plan'))
    )
    with op.batch_alter_table('maintenance_plan', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_maintenance_plan_company_id'), ['company_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_maintenance_plan_machine_id'), ['machine_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_maintenance_plan_next_due'), ['next_due'], unique=False)

    with op.batch_alter_table('job', schema=None) as batch_op:
        batch_op.add_column(sa.Column('plan_id', sa.Integer(), nullable=True))
        batch_op.create_index(batch_op.f('ix_job_plan_id'), ['plan_id'], unique=False)
        batch_op.create_foreign_key(batch_op.f('fk_job_plan_id_maintenance_plan'), 'maintenance_plan', ['plan_id'], ['id'])

    with op.batch_alter_table('job_file', schema=None) as batch_op:
        batch_op.add_column(sa.Column('machine_id', sa.Integer(), nullable=True))
        batch_op.alter_column('job_id',
               existing_type=sa.INTEGER(),
               nullable=True)
        batch_op.create_index(batch_op.f('ix_job_file_machine_id'), ['machine_id'], unique=False)
        batch_op.create_foreign_key(batch_op.f('fk_job_file_machine_id_machine'), 'machine', ['machine_id'], ['id'])

    with op.batch_alter_table('machine', schema=None) as batch_op:
        batch_op.add_column(sa.Column('equipment_type', sa.String(length=80), nullable=True))
        batch_op.add_column(sa.Column('manufacturer', sa.String(length=100), nullable=True))
        batch_op.add_column(sa.Column('site_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('installed_on', sa.Date(), nullable=True))
        batch_op.add_column(sa.Column('notes', sa.Text(), nullable=True))
        batch_op.create_index(batch_op.f('ix_machine_equipment_type'), ['equipment_type'], unique=False)
        batch_op.create_index(batch_op.f('ix_machine_site_id'), ['site_id'], unique=False)
        batch_op.create_foreign_key(batch_op.f('fk_machine_site_id_site'), 'site', ['site_id'], ['id'])



def downgrade():
    with op.batch_alter_table('machine', schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f('fk_machine_site_id_site'), type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_machine_site_id'))
        batch_op.drop_index(batch_op.f('ix_machine_equipment_type'))
        batch_op.drop_column('notes')
        batch_op.drop_column('installed_on')
        batch_op.drop_column('site_id')
        batch_op.drop_column('manufacturer')
        batch_op.drop_column('equipment_type')

    # Equipment documents have no job: their rows go (the stored files stay behind).
    op.execute("delete from job_file where job_id is null")
    with op.batch_alter_table('job_file', schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f('fk_job_file_machine_id_machine'), type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_job_file_machine_id'))
        batch_op.alter_column('job_id',
               existing_type=sa.INTEGER(),
               nullable=False)
        batch_op.drop_column('machine_id')

    with op.batch_alter_table('job', schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f('fk_job_plan_id_maintenance_plan'), type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_job_plan_id'))
        batch_op.drop_column('plan_id')

    with op.batch_alter_table('maintenance_plan', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_maintenance_plan_next_due'))
        batch_op.drop_index(batch_op.f('ix_maintenance_plan_machine_id'))
        batch_op.drop_index(batch_op.f('ix_maintenance_plan_company_id'))

    op.drop_table('maintenance_plan')
    with op.batch_alter_table('site', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_site_customer_id'))
        batch_op.drop_index(batch_op.f('ix_site_company_id'))

    op.drop_table('site')
