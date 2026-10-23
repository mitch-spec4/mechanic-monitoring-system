"""Two-step sign-in, lockout, activity log, company deletion and agreeing to the terms

Revision ID: 0009_security
Revises: 0008_language_settings
Create Date: 2026-10-23 20:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0009_security'
down_revision = '0008_language_settings'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('user', schema=None) as batch_op:
        batch_op.add_column(sa.Column('totp_secret', sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column('totp_enabled_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('totp_last_step', sa.BigInteger(), nullable=True))
        batch_op.add_column(sa.Column('failed_logins', sa.Integer(), server_default='0', nullable=False))
        batch_op.add_column(sa.Column('locked_until', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('terms_version', sa.String(length=20), nullable=True))
        batch_op.add_column(sa.Column('terms_accepted_at', sa.DateTime(), nullable=True))

    with op.batch_alter_table('company', schema=None) as batch_op:
        batch_op.add_column(sa.Column('deletion_requested_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('deletion_requested_by', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('deletion_due_at', sa.DateTime(), nullable=True))
        batch_op.create_index(batch_op.f('ix_company_deletion_due_at'), ['deletion_due_at'], unique=False)

    op.create_table(
        'backup_code',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('code_hash', sa.String(length=64), nullable=False),
        sa.Column('used_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('backup_code', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_backup_code_user_id'), ['user_id'], unique=False)

    op.create_table(
        'trusted_device',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('token_hash'),
    )
    with op.batch_alter_table('trusted_device', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_trusted_device_user_id'), ['user_id'], unique=False)

    op.create_table(
        'audit_event',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('company_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('user_name', sa.String(length=120), nullable=True),
        sa.Column('action', sa.String(length=40), nullable=False),
        sa.Column('detail', sa.String(length=300), nullable=True),
        sa.Column('ip', sa.String(length=64), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['company_id'], ['company.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('audit_event', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_audit_event_company_id'), ['company_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_audit_event_created_at'), ['created_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_audit_event_user_id'), ['user_id'], unique=False)


def downgrade():
    with op.batch_alter_table('audit_event', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_audit_event_user_id'))
        batch_op.drop_index(batch_op.f('ix_audit_event_created_at'))
        batch_op.drop_index(batch_op.f('ix_audit_event_company_id'))
    op.drop_table('audit_event')
    with op.batch_alter_table('trusted_device', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_trusted_device_user_id'))
    op.drop_table('trusted_device')
    with op.batch_alter_table('backup_code', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_backup_code_user_id'))
    op.drop_table('backup_code')

    with op.batch_alter_table('company', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_company_deletion_due_at'))
        batch_op.drop_column('deletion_due_at')
        batch_op.drop_column('deletion_requested_by')
        batch_op.drop_column('deletion_requested_at')

    with op.batch_alter_table('user', schema=None) as batch_op:
        batch_op.drop_column('terms_accepted_at')
        batch_op.drop_column('terms_version')
        batch_op.drop_column('locked_until')
        batch_op.drop_column('failed_logins')
        batch_op.drop_column('totp_last_step')
        batch_op.drop_column('totp_enabled_at')
        batch_op.drop_column('totp_secret')
