"""add_insurance

Revision ID: d3e4f5a6b7c2
Revises: c2d3e4f5a6b1
Create Date: 2026-03-01 12:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "d3e4f5a6b7c2"
down_revision: Union[str, None] = "c2d3e4f5a6b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── vehicles (must be created before insurance_policies references it) ────
    op.create_table(
        "vehicles",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "household_id",
            UUID(as_uuid=True),
            sa.ForeignKey("households.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("make", sa.String(100), nullable=False),
        sa.Column("model", sa.String(100), nullable=False),
        sa.Column("year", sa.Integer, nullable=True),
        sa.Column("vin", sa.String(50), nullable=True),
        sa.Column("nickname", sa.String(255), nullable=True),
        sa.Column("color", sa.String(50), nullable=True),
        sa.Column("is_active", sa.Boolean, server_default=sa.text("true"), nullable=False),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_vehicles_household_id", "vehicles", ["household_id"])

    # ── insurance_policies ────────────────────────────────────────────────────
    op.create_table(
        "insurance_policies",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "household_id",
            UUID(as_uuid=True),
            sa.ForeignKey("households.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("policy_type", sa.String(30), nullable=False),
        sa.Column("provider", sa.String(255), nullable=False),
        sa.Column("policy_number", sa.String(100), nullable=True),
        sa.Column("premium_amount", sa.Numeric(14, 2), nullable=True),
        sa.Column(
            "premium_frequency",
            sa.String(20),
            server_default=sa.text("'monthly'"),
            nullable=False,
        ),
        sa.Column("coverage_amount", sa.Numeric(14, 2), nullable=True),
        sa.Column("deductible", sa.Numeric(14, 2), nullable=True),
        sa.Column("start_date", sa.Date, nullable=True),
        sa.Column("renewal_date", sa.Date, nullable=True),
        sa.Column("auto_renew", sa.Boolean, server_default=sa.text("false"), nullable=False),
        sa.Column("is_active", sa.Boolean, server_default=sa.text("true"), nullable=False),
        sa.Column(
            "property_id",
            UUID(as_uuid=True),
            sa.ForeignKey("properties.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "vehicle_id",
            UUID(as_uuid=True),
            sa.ForeignKey("vehicles.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "insured_user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "entity_id",
            UUID(as_uuid=True),
            sa.ForeignKey("business_entities.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_insurance_policies_household_id", "insurance_policies", ["household_id"])
    op.create_index("ix_insurance_policies_policy_type", "insurance_policies", ["policy_type"])
    op.create_index("ix_insurance_policies_renewal_date", "insurance_policies", ["renewal_date"])
    op.create_index("ix_insurance_policies_property_id", "insurance_policies", ["property_id"])
    op.create_index("ix_insurance_policies_vehicle_id", "insurance_policies", ["vehicle_id"])
    op.create_index(
        "ix_insurance_policies_insured_user_id", "insurance_policies", ["insured_user_id"]
    )
    op.create_index("ix_insurance_policies_entity_id", "insurance_policies", ["entity_id"])

    # ── insurance_beneficiaries ───────────────────────────────────────────────
    op.create_table(
        "insurance_beneficiaries",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "policy_id",
            UUID(as_uuid=True),
            sa.ForeignKey("insurance_policies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("relationship", sa.String(100), nullable=True),
        sa.Column(
            "beneficiary_type",
            sa.String(20),
            server_default=sa.text("'primary'"),
            nullable=False,
        ),
        sa.Column("percentage", sa.Numeric(5, 2), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_insurance_beneficiaries_policy_id", "insurance_beneficiaries", ["policy_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_insurance_beneficiaries_policy_id", table_name="insurance_beneficiaries")
    op.drop_table("insurance_beneficiaries")

    op.drop_index("ix_insurance_policies_entity_id", table_name="insurance_policies")
    op.drop_index("ix_insurance_policies_insured_user_id", table_name="insurance_policies")
    op.drop_index("ix_insurance_policies_vehicle_id", table_name="insurance_policies")
    op.drop_index("ix_insurance_policies_property_id", table_name="insurance_policies")
    op.drop_index("ix_insurance_policies_renewal_date", table_name="insurance_policies")
    op.drop_index("ix_insurance_policies_policy_type", table_name="insurance_policies")
    op.drop_index("ix_insurance_policies_household_id", table_name="insurance_policies")
    op.drop_table("insurance_policies")

    op.drop_index("ix_vehicles_household_id", table_name="vehicles")
    op.drop_table("vehicles")
