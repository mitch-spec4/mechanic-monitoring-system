"""Custom forms: forms with versioned questions, forms filled in on jobs, photos answering them, and the company logo

Revision ID: 0017_forms
Revises: 0016_services
Create Date: 2026-10-25 09:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0017_forms'
down_revision = '0016_services'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('form_template',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('company_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('job_types', sa.JSON(), nullable=False),
    sa.Column('service_ids', sa.JSON(), nullable=False),
    sa.Column('required', sa.Boolean(), server_default=sa.false(), nullable=False),
    sa.Column('customer_visible', sa.Boolean(), server_default=sa.false(), nullable=False),
    sa.Column('active', sa.Boolean(), server_default=sa.true(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['company_id'], ['company.id'], name=op.f('fk_form_template_company_id_company')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_form_template'))
    )
    with op.batch_alter_table('form_template', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_form_template_company_id'), ['company_id'], unique=False)

    op.create_table('form_version',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('form_id', sa.Integer(), nullable=False),
    sa.Column('number', sa.Integer(), nullable=False),
    sa.Column('fields', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('created_by', sa.Integer(), nullable=True),
    sa.ForeignKeyConstraint(['created_by'], ['user.id'], name=op.f('fk_form_version_created_by_user')),
    sa.ForeignKeyConstraint(['form_id'], ['form_template.id'], name=op.f('fk_form_version_form_id_form_template')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_form_version')),
    sa.UniqueConstraint('form_id', 'number', name='uq_form_version_number')
    )
    with op.batch_alter_table('form_version', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_form_version_form_id'), ['form_id'], unique=False)

    op.create_table('form_submission',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('company_id', sa.Integer(), nullable=False),
    sa.Column('job_id', sa.Integer(), nullable=False),
    sa.Column('form_id', sa.Integer(), nullable=False),
    sa.Column('version_id', sa.Integer(), nullable=False),
    sa.Column('machine_id', sa.Integer(), nullable=True),
    sa.Column('answers', sa.JSON(), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.Column('updated_by', sa.Integer(), nullable=True),
    sa.Column('completed_at', sa.DateTime(), nullable=True),
    sa.Column('completed_by', sa.Integer(), nullable=True),
    sa.ForeignKeyConstraint(['company_id'], ['company.id'], name=op.f('fk_form_submission_company_id_company')),
    sa.ForeignKeyConstraint(['completed_by'], ['user.id'], name=op.f('fk_form_submission_completed_by_user')),
    sa.ForeignKeyConstraint(['form_id'], ['form_template.id'], name=op.f('fk_form_submission_form_id_form_template')),
    sa.ForeignKeyConstraint(['job_id'], ['job.id'], name=op.f('fk_form_submission_job_id_job')),
    sa.ForeignKeyConstraint(['machine_id'], ['machine.id'], name=op.f('fk_form_submission_machine_id_machine')),
    sa.ForeignKeyConstraint(['updated_by'], ['user.id'], name=op.f('fk_form_submission_updated_by_user')),
    sa.ForeignKeyConstraint(['version_id'], ['form_version.id'], name=op.f('fk_form_submission_version_id_form_version')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_form_submission')),
    sa.UniqueConstraint('job_id', 'form_id', name='uq_form_submission_job_form')
    )
    with op.batch_alter_table('form_submission', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_form_submission_company_id'), ['company_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_form_submission_form_id'), ['form_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_form_submission_job_id'), ['job_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_form_submission_machine_id'), ['machine_id'], unique=False)

    with op.batch_alter_table('company', schema=None) as batch_op:
        batch_op.add_column(sa.Column('logo_key', sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column('logo_content_type', sa.String(length=40), nullable=True))

    with op.batch_alter_table('job_file', schema=None) as batch_op:
        batch_op.add_column(sa.Column('form_field', sa.String(length=80), nullable=True))



def downgrade():
    with op.batch_alter_table('job_file', schema=None) as batch_op:
        batch_op.drop_column('form_field')

    with op.batch_alter_table('company', schema=None) as batch_op:
        batch_op.drop_column('logo_content_type')
        batch_op.drop_column('logo_key')

    with op.batch_alter_table('form_submission', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_form_submission_machine_id'))
        batch_op.drop_index(batch_op.f('ix_form_submission_job_id'))
        batch_op.drop_index(batch_op.f('ix_form_submission_form_id'))
        batch_op.drop_index(batch_op.f('ix_form_submission_company_id'))

    op.drop_table('form_submission')
    with op.batch_alter_table('form_version', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_form_version_form_id'))

    op.drop_table('form_version')
    with op.batch_alter_table('form_template', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_form_template_company_id'))

    op.drop_table('form_template')
