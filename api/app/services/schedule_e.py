"""Schedule E (rental income and expense) per US rental property for a tax year.

Shared by the CPA CSV export and the tax projection. Gross rents are the
payments received (cash basis), management fees a percentage of rent
charged, fixed costs the annualized property costs and linked insurance
premiums, repairs the non-capex maintenance expenses. Mortgage interest is
estimated from each loan's amortization (services/loan_split). Depreciation
is straight-line over 27.5 years (39 for commercial) with the mid-month
convention, on the purchase price plus closing costs less land, and on each
capital improvement from the month it was made. Land defaults to 20% of the
purchase price when its value isn't set.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.insurance import InsurancePolicy
from app.models.property import Property
from app.models.property_details import Loan, MaintenanceExpense, PropertyCost
from app.models.rental import Lease, Payment, RentCharge, Unit
from app.services import tax_tables as tt
from app.services.loan_split import interest_in_year

DEFAULT_LAND_PCT = 0.20
_COMMERCIAL_TYPES = {"commercial", "office", "retail", "industrial", "warehouse", "mixed_use"}


def _annual(amount, frequency: str | None) -> float:
    amt = float(amount or 0)
    if frequency == "monthly":
        return amt * 12
    if frequency == "quarterly":
        return amt * 4
    if frequency == "semi_annual":
        return amt * 2
    return amt  # annual or one_time


def _as_date(d: datetime | date | None) -> date | None:
    if d is None:
        return None
    return d.date() if isinstance(d, datetime) else d


def depreciation_for_year(basis: float, in_service: date, year: int, recovery_years: float) -> float:
    """Straight-line, mid-month convention: the first and last years count
    half of the month the asset entered (or leaves) service."""
    if basis <= 0 or year < in_service.year:
        return 0.0
    annual = basis / recovery_years
    start_months = 12 - in_service.month + 0.5          # months in service in year one
    if year == in_service.year:
        return annual * start_months / 12
    months_before = start_months + 12 * (year - in_service.year - 1)
    remaining = recovery_years * 12 - months_before
    if remaining <= 0:
        return 0.0
    return annual * min(12, remaining) / 12


async def build_schedule_e(db: AsyncSession, household_id: uuid.UUID, year: int) -> list[dict]:
    """One dict per US rental property (primary residence excluded), amounts as floats."""
    props = (await db.execute(
        select(Property).where(
            Property.household_id == household_id,
            Property.is_primary_residence == False,  # noqa: E712
            or_(Property.country.is_(None), Property.country == "US"),
        )
    )).scalars().all()

    year_start, year_end = date(year, 1, 1), date(year, 12, 31)
    rows = []
    for prop in props:
        unit_ids = (await db.execute(select(Unit.id).where(Unit.property_id == prop.id))).scalars().all()
        leases = (await db.execute(
            select(Lease).where(Lease.unit_id.in_(unit_ids))
        )).scalars().all() if unit_ids else []
        lease_ids = [l.id for l in leases]
        # Rent still to come this year, for projecting the current year
        active_monthly_rent = sum(
            float(l.monthly_rent or 0) for l in leases
            if l.status == "active" and (l.lease_end is None or l.lease_end >= date.today())
        )

        gross_rents = rent_charged = 0.0
        if lease_ids:
            gross_rents = float((await db.execute(
                select(func.sum(Payment.amount)).where(
                    Payment.lease_id.in_(lease_ids),
                    Payment.payment_date >= year_start,
                    Payment.payment_date <= year_end,
                )
            )).scalar() or 0)
            rent_charged = float((await db.execute(
                select(func.sum(RentCharge.amount)).where(
                    RentCharge.lease_id.in_(lease_ids),
                    RentCharge.charge_date >= year_start,
                    RentCharge.charge_date <= year_end,
                )
            )).scalar() or 0)

        # Costs in effect during the year (a later rate change shouldn't count)
        costs = (await db.execute(
            select(PropertyCost).where(
                PropertyCost.property_id == prop.id,
                PropertyCost.is_active == True,  # noqa: E712
                or_(PropertyCost.effective_date.is_(None), PropertyCost.effective_date <= year_end),
            )
        )).scalars().all()
        # Insurance policies linked to the property and in force during the year
        policies = (await db.execute(
            select(InsurancePolicy).where(
                InsurancePolicy.property_id == prop.id,
                InsurancePolicy.is_active == True,  # noqa: E712
                or_(InsurancePolicy.start_date.is_(None), InsurancePolicy.start_date <= year_end),
                or_(InsurancePolicy.renewal_date.is_(None), InsurancePolicy.renewal_date >= year_start),
            )
        )).scalars().all()

        insurance = (sum(_annual(c.amount, c.frequency) for c in costs if c.category == "insurance")
                     + sum(_annual(p.premium_amount, p.premium_frequency or "annual") for p in policies))
        property_tax = sum(_annual(c.amount, c.frequency) for c in costs if c.category == "property_tax")
        hoa = sum(_annual(c.amount, c.frequency) for c in costs if c.category == "hoa")
        other_fixed = sum(_annual(c.amount, c.frequency) for c in costs
                          if c.category not in ("insurance", "property_tax", "hoa"))

        expenses = (await db.execute(
            select(MaintenanceExpense.expense_date, MaintenanceExpense.amount, MaintenanceExpense.is_capex).where(
                MaintenanceExpense.property_id == prop.id,
                MaintenanceExpense.expense_date <= year_end,
            )
        )).all()
        repairs = sum(float(a or 0) for d, a, capex in expenses if not capex and _as_date(d) >= year_start)
        capex = sum(float(a or 0) for d, a, capex in expenses if capex and _as_date(d) >= year_start)

        mgmt_pct = 0.0
        if prop.is_property_managed:
            mgmt_pct = float(prop.management_fee_pct) if prop.management_fee_pct else 8.0
        mgmt_fees = rent_charged * mgmt_pct / 100

        loans = (await db.execute(select(Loan).where(Loan.property_id == prop.id))).scalars().all()
        loan_balance = sum(float(l.current_balance or 0) for l in loans)
        interest_known = [i for i in (interest_in_year(l, year) for l in loans) if i is not None]
        mortgage_interest = sum(interest_known)

        # ── Depreciation ────────────────────────────────────────────────────
        purchase_price = float(prop.purchase_price or 0)
        in_service = prop.placed_in_service_date or _as_date(prop.purchase_date)
        recovery = (tt.COMMERCIAL_RECOVERY_YEARS if (prop.property_type or "").lower() in _COMMERCIAL_TYPES
                    else tt.RESIDENTIAL_RECOVERY_YEARS)
        land_estimated = prop.land_value is None
        land = float(prop.land_value) if prop.land_value is not None else purchase_price * DEFAULT_LAND_PCT
        building_basis = max(0.0, purchase_price + float(prop.closing_costs or 0) - land)
        depreciation = 0.0
        if in_service and (prop.property_type or "").lower() != "land":
            depreciation = depreciation_for_year(building_basis, in_service, year, recovery)
            for d, a, is_capex in expenses:
                if is_capex and a:
                    depreciation += depreciation_for_year(float(a), max(_as_date(d), in_service), year, recovery)

        total_opex = mgmt_fees + insurance + property_tax + hoa + repairs + other_fixed
        noi = gross_rents - total_opex
        rows.append({
            "property_id": str(prop.id),
            "address": prop.address,
            "entity_id": str(prop.entity_id) if prop.entity_id else None,
            "purchase_date": _as_date(prop.purchase_date).isoformat() if prop.purchase_date else None,
            "purchase_price": purchase_price,
            "rent_charged": rent_charged,
            "active_monthly_rent": active_monthly_rent,
            "mgmt_pct": mgmt_pct,
            "gross_rents": gross_rents,
            "mgmt_fees": mgmt_fees,
            "insurance": insurance,
            "property_tax": property_tax,
            "hoa": hoa,
            "repairs": repairs,
            "other_fixed": other_fixed,
            "total_opex": total_opex,
            "noi": noi,
            "capex": capex,
            "loan_balance": loan_balance,
            "mortgage_interest": mortgage_interest,
            "interest_estimated": bool(loans),
            "depreciation": depreciation,
            "depreciable_basis": building_basis,
            "land_value": land,
            "land_estimated": land_estimated,
            "placed_in_service": in_service.isoformat() if in_service else None,
            "personal_use_days": prop.personal_use_days,
            "net_income": noi - mortgage_interest - depreciation,
        })
    return rows


SCHEDULE_E_FIELDS = (
    "gross_rents", "mgmt_fees", "insurance", "property_tax", "hoa", "repairs", "other_fixed",
    "total_opex", "noi", "capex", "mortgage_interest", "depreciation", "net_income",
)


def schedule_e_totals(rows: list[dict]) -> dict:
    return {f: sum(r[f] for r in rows) for f in SCHEDULE_E_FIELDS}
