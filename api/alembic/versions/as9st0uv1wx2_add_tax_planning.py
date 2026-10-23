"""add tax planning: tax_profiles, rental depreciation and entity tax fields

Revision ID: as9st0uv1wx2
Revises: ar8rs9tu0vw1
Create Date: 2026-10-22

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "as9st0uv1wx2"
down_revision = "ar8rs9tu0vw1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tax_profiles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("household_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("households.id", ondelete="CASCADE"), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("filing_status", sa.String(10), server_default="mfj", nullable=False),
        sa.Column("state", sa.String(2)),
        sa.Column("taxpayer_birthdate", sa.Date()),
        sa.Column("spouse_birthdate", sa.Date()),
        sa.Column("dependents_under_17", sa.Integer(), server_default="0", nullable=False),
        sa.Column("other_dependents", sa.Integer(), server_default="0", nullable=False),
        sa.Column("prior_year_agi", sa.Numeric(14, 2)),
        sa.Column("prior_year_tax", sa.Numeric(14, 2)),
        sa.Column("expected_bonus", sa.Numeric(14, 2)),
        sa.Column("other_ordinary_income", sa.Numeric(14, 2)),
        sa.Column("capital_loss_carryover", sa.Numeric(14, 2)),
        sa.Column("above_line_adjustments", sa.Numeric(14, 2)),
        sa.Column("mortgage_interest_override", sa.Numeric(14, 2)),
        sa.Column("property_tax_override", sa.Numeric(14, 2)),
        sa.Column("charitable_cash", sa.Numeric(14, 2)),
        sa.Column("charitable_noncash", sa.Numeric(14, 2)),
        sa.Column("medical_expenses", sa.Numeric(14, 2)),
        sa.Column("other_itemized", sa.Numeric(14, 2)),
        sa.Column("estimated_payments_federal", sa.Numeric(14, 2)),
        sa.Column("estimated_payments_state", sa.Numeric(14, 2)),
        sa.Column("real_estate_professional", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("active_participation", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("suspended_passive_loss", sa.Numeric(14, 2)),
        sa.Column("opportunity_status", postgresql.JSONB()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("household_id", "year", name="uq_tax_profiles_household_year"),
    )
    op.create_index("ix_tax_profiles_household_id", "tax_profiles", ["household_id"])

    op.add_column("properties", sa.Column("land_value", sa.Numeric(14, 2)))
    op.add_column("properties", sa.Column("placed_in_service_date", sa.Date()))
    op.add_column("properties", sa.Column("personal_use_days", sa.Integer()))

    op.add_column("business_entities", sa.Column("tax_classification", sa.String(20)))
    op.add_column("business_entities", sa.Column("owner_salary", sa.Numeric(14, 2)))
    op.add_column("business_entities", sa.Column("home_office_sqft", sa.Integer()))
    op.add_column("business_entities", sa.Column("health_insurance_premiums", sa.Numeric(14, 2)))
    op.add_column("business_entities", sa.Column("retirement_plan", sa.String(20)))
    op.add_column("business_entities", sa.Column("retirement_contribution", sa.Numeric(14, 2)))
    op.add_column("business_entities", sa.Column("accountable_plan", sa.Boolean(), server_default=sa.text("false"), nullable=False))


def downgrade() -> None:
    for col in ("accountable_plan", "retirement_contribution", "retirement_plan", "health_insurance_premiums",
                "home_office_sqft", "owner_salary", "tax_classification"):
        op.drop_column("business_entities", col)
    for col in ("personal_use_days", "placed_in_service_date", "land_value"):
        op.drop_column("properties", col)
    op.drop_index("ix_tax_profiles_household_id", table_name="tax_profiles")
    op.drop_table("tax_profiles")
