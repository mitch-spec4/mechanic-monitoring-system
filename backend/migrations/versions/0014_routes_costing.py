"""Routes and job costing: map pins for the company's base and sites, a job's place in its
technician's planned route, technicians' pay rates, parts' unit costs and what a job is charged

Revision ID: 0014_routes_costing
Revises: 0013_equipment
Create Date: 2026-10-24 18:05:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0014_routes_costing'
down_revision = '0013_equipment'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('company', schema=None) as batch_op:
        batch_op.add_column(sa.Column('base_latitude', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('base_longitude', sa.Float(), nullable=True))

    with op.batch_alter_table('job', schema=None) as batch_op:
        batch_op.add_column(sa.Column('route_date', sa.Date(), nullable=True))
        batch_op.add_column(sa.Column('route_order', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('charged_cents', sa.Integer(), nullable=True))

    with op.batch_alter_table('job_part', schema=None) as batch_op:
        batch_op.add_column(sa.Column('unit_cost_cents', sa.Integer(), nullable=True))

    with op.batch_alter_table('site', schema=None) as batch_op:
        batch_op.add_column(sa.Column('latitude', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('longitude', sa.Float(), nullable=True))

    with op.batch_alter_table('user', schema=None) as batch_op:
        batch_op.add_column(sa.Column('pay_rate_cents', sa.Integer(), nullable=True))



def downgrade():
    with op.batch_alter_table('user', schema=None) as batch_op:
        batch_op.drop_column('pay_rate_cents')

    with op.batch_alter_table('site', schema=None) as batch_op:
        batch_op.drop_column('longitude')
        batch_op.drop_column('latitude')

    with op.batch_alter_table('job_part', schema=None) as batch_op:
        batch_op.drop_column('unit_cost_cents')

    with op.batch_alter_table('job', schema=None) as batch_op:
        batch_op.drop_column('charged_cents')
        batch_op.drop_column('route_order')
        batch_op.drop_column('route_date')

    with op.batch_alter_table('company', schema=None) as batch_op:
        batch_op.drop_column('base_longitude')
        batch_op.drop_column('base_latitude')

