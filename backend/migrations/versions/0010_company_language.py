"""The company's language, for new members and invitations

Revision ID: 0010_company_language
Revises: 0009_security
Create Date: 2026-10-24 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0010_company_language'
down_revision = '0009_security'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('company', schema=None) as batch_op:
        batch_op.add_column(sa.Column('language', sa.String(length=5), server_default='en', nullable=False))


def downgrade():
    with op.batch_alter_table('company', schema=None) as batch_op:
        batch_op.drop_column('language')
