"""rental_phase1

Revision ID: b3c4d5e6f7a8
Revises: e7f2a1b3c9d4
Create Date: 2026-02-18 13:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b3c4d5e6f7a8"
down_revision: Union[str, None] = "e7f2a1b3c9d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── New tables ──────────────────────────────────────────────────────────

    op.create_table(
        "units",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("property_id", sa.UUID(), nullable=False),
        sa.Column("unit_label", sa.String(length=50), nullable=False),
        sa.Column("beds", sa.Integer(), nullable=True),
        sa.Column("baths", sa.Numeric(3, 1), nullable=True),
        sa.Column("sqft", sa.Integer(), nullable=True),
        sa.Column("is_rentable", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["property_id"], ["properties.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_units_property_id"), "units", ["property_id"], unique=False)

    op.create_table(
        "tenants",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("household_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("phone", sa.String(length=50), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["household_id"], ["households.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_tenants_household_id"), "tenants", ["household_id"], unique=False)

    op.create_table(
        "leases",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("unit_id", sa.UUID(), nullable=False),
        sa.Column("tenant_id", sa.UUID(), nullable=False),
        sa.Column("lease_start", sa.Date(), nullable=False),
        sa.Column("lease_end", sa.Date(), nullable=True),
        sa.Column("move_in_date", sa.Date(), nullable=True),
        sa.Column("move_out_date", sa.Date(), nullable=True),
        sa.Column("monthly_rent", sa.Numeric(14, 2), nullable=False),
        sa.Column("deposit", sa.Numeric(14, 2), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["unit_id"], ["units.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_leases_unit_id"), "leases", ["unit_id"], unique=False)
    op.create_index(op.f("ix_leases_tenant_id"), "leases", ["tenant_id"], unique=False)

    op.create_table(
        "rent_charges",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("lease_id", sa.UUID(), nullable=False),
        sa.Column("charge_date", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("charge_type", sa.String(length=50), nullable=False, server_default="rent"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["lease_id"], ["leases.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_rent_charges_lease_id"), "rent_charges", ["lease_id"], unique=False)

    op.create_table(
        "payments",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("lease_id", sa.UUID(), nullable=False),
        sa.Column("payment_date", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("method", sa.String(length=50), nullable=True),
        sa.Column("applied_to_charge_id", sa.UUID(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["lease_id"], ["leases.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["applied_to_charge_id"], ["rent_charges.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_payments_lease_id"), "payments", ["lease_id"], unique=False)

    # ── Drop deprecated property financial columns ───────────────────────────
    op.drop_column("properties", "monthly_rent")
    op.drop_column("properties", "mortgage_monthly")
    op.drop_column("properties", "property_tax_annual")
    op.drop_column("properties", "insurance_annual")
    op.drop_column("properties", "hoa_monthly")
    op.drop_column("properties", "maintenance_monthly")


def downgrade() -> None:
    # Restore deprecated property columns
    op.add_column("properties", sa.Column("maintenance_monthly", sa.Numeric(14, 2), nullable=True))
    op.add_column("properties", sa.Column("hoa_monthly", sa.Numeric(14, 2), nullable=True))
    op.add_column("properties", sa.Column("insurance_annual", sa.Numeric(14, 2), nullable=True))
    op.add_column("properties", sa.Column("property_tax_annual", sa.Numeric(14, 2), nullable=True))
    op.add_column("properties", sa.Column("mortgage_monthly", sa.Numeric(14, 2), nullable=True))
    op.add_column("properties", sa.Column("monthly_rent", sa.Numeric(14, 2), nullable=True))

    # Drop new tables (reverse order for FK dependencies)
    op.drop_index(op.f("ix_payments_lease_id"), table_name="payments")
    op.drop_table("payments")
    op.drop_index(op.f("ix_rent_charges_lease_id"), table_name="rent_charges")
    op.drop_table("rent_charges")
    op.drop_index(op.f("ix_leases_tenant_id"), table_name="leases")
    op.drop_index(op.f("ix_leases_unit_id"), table_name="leases")
    op.drop_table("leases")
    op.drop_index(op.f("ix_tenants_household_id"), table_name="tenants")
    op.drop_table("tenants")
    op.drop_index(op.f("ix_units_property_id"), table_name="units")
    op.drop_table("units")
