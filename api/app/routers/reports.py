"""
Rental reporting router.
Endpoints:
  GET /reports/property/{property_id}?year=2026&month=2026-02
  GET /reports/portfolio?year=2026&month=2026-02
"""
import logging
import uuid
from calendar import monthrange
from datetime import date
from math import isfinite

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
import io
import csv

logger = logging.getLogger(__name__)
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.capital_event import CapitalEvent
from app.models.property import Property
from app.models.property_details import Loan, MaintenanceExpense, PropertyCost
from app.models.rental import Lease, Payment, RentCharge, Unit
from app.models.user import User

router = APIRouter(tags=["reports"])


# ─── IRR (Newton's method) ────────────────────────────────────────────────────

def _irr(cash_flows: list[tuple[date, float]]) -> float | None:
    """
    Solve IRR from a list of (date, signed_amount) pairs.
    Times are expressed as fractional years from the earliest date.
    Returns annual rate (e.g. 0.125 = 12.5%) or None if no solution found.
    """
    if not cash_flows or len(cash_flows) < 2:
        return None
    cash_flows = sorted(cash_flows, key=lambda x: x[0])
    t0 = cash_flows[0][0]

    def year_frac(d: date) -> float:
        return (d - t0).days / 365.25

    times = [year_frac(d) for d, _ in cash_flows]
    amounts = [a for _, a in cash_flows]

    # Check signs — need at least one negative and one positive
    if all(a >= 0 for a in amounts) or all(a <= 0 for a in amounts):
        return None

    def npv(r: float) -> float:
        return sum(a / ((1 + r) ** t) for a, t in zip(amounts, times))

    def npv_prime(r: float) -> float:
        return sum(-t * a / ((1 + r) ** (t + 1)) for a, t in zip(amounts, times))

    r = 0.10  # initial guess
    for _ in range(100):
        f = npv(r)
        fp = npv_prime(r)
        if abs(fp) < 1e-12:
            break
        r_new = r - f / fp
        if abs(r_new - r) < 1e-8:
            r = r_new
            break
        r = r_new
        if r <= -1:
            r = -0.999

    if not isfinite(r) or r <= -1:
        return None
    return round(r * 100, 2)  # return as percentage


# ─── Date helpers ─────────────────────────────────────────────────────────────

def _parse_month(month_str: str) -> tuple[date, date]:
    """Return (first_day, last_day) for a YYYY-MM string."""
    try:
        year, mon = int(month_str[:4]), int(month_str[5:7])
    except (ValueError, IndexError):
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    last = monthrange(year, mon)[1]
    return date(year, mon, 1), date(year, mon, last)


def _quarter_range(year: int, month: int) -> tuple[date, date]:
    q = (month - 1) // 3
    q_start_month = q * 3 + 1
    q_end_month = q_start_month + 2
    last = monthrange(year, q_end_month)[1]
    return date(year, q_start_month, 1), date(year, q_end_month, last)


def _year_range(year: int) -> tuple[date, date]:
    return date(year, 1, 1), date(year, 12, 31)


def _prior_year_range(year: int) -> tuple[date, date]:
    return date(year - 1, 1, 1), date(year - 1, 12, 31)


def _bound_by_purchase(start: date, end: date, purchase_date) -> tuple[date, date]:
    """
    Cap the date range so it doesn't go before the property's purchase_date.
    If the entire period is before purchase, returns (end, end) which yields 0 results.
    """
    if not purchase_date:
        return (start, end)

    # Convert datetime to date if needed
    pd = purchase_date.date() if hasattr(purchase_date, 'date') else purchase_date

    # If entire period is before purchase, return empty range
    if end < pd:
        return (end, end)

    # Cap start at purchase_date
    if start < pd:
        start = pd

    return (start, end)


# ─── Aggregation helpers ──────────────────────────────────────────────────────

async def _property_metrics(
    property_id: uuid.UUID,
    year: int,
    month: int,
    db: AsyncSession,
    include_lifetime: bool = False,
) -> dict:
    """Compute all report metrics for one property."""
    m_start, m_end = _parse_month(f"{year:04d}-{month:02d}")
    q_start, q_end = _quarter_range(year, month)
    y_start, y_end = _year_range(year)
    py_start, py_end = _prior_year_range(year)

    # ── Fetch property ──
    prop_result = await db.execute(select(Property).where(Property.id == property_id))
    prop = prop_result.scalar_one_or_none()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    # ── Bound all date ranges by purchase_date (don't calculate before property was purchased) ──
    m_start, m_end = _bound_by_purchase(m_start, m_end, prop.purchase_date)
    q_start, q_end = _bound_by_purchase(q_start, q_end, prop.purchase_date)
    y_start, y_end = _bound_by_purchase(y_start, y_end, prop.purchase_date)
    py_start, py_end = _bound_by_purchase(py_start, py_end, prop.purchase_date)

    # ── Rentable units ──
    units_result = await db.execute(
        select(Unit).where(Unit.property_id == property_id, Unit.is_rentable == True)
    )
    rentable_units = list(units_result.scalars().all())
    unit_ids = [u.id for u in rentable_units]

    # ── Active leases at end of month ──
    occupied_month = 0
    if unit_ids:
        active_leases_result = await db.execute(
            select(func.count(Lease.id)).where(
                Lease.unit_id.in_(unit_ids),
                Lease.status == "active",
                Lease.lease_start <= m_end,
            )
        )
        occupied_month = active_leases_result.scalar() or 0

    # ── All lease IDs for this property ──
    all_leases_result = await db.execute(
        select(Lease.id).where(Lease.unit_id.in_(unit_ids)) if unit_ids
        else select(Lease.id).where(False)
    )
    lease_ids = [r[0] for r in all_leases_result.all()]

    async def rent_charged(d_start: date, d_end: date) -> float:
        """Sum of formal rent_charges for the period."""
        if not lease_ids:
            return 0.0
        r = await db.execute(
            select(func.coalesce(func.sum(RentCharge.amount), 0)).where(
                RentCharge.lease_id.in_(lease_ids),
                RentCharge.charge_date >= d_start,
                RentCharge.charge_date <= d_end,
            )
        )
        return float(r.scalar())

    async def rent_roll(d_start: date, d_end: date) -> float:
        """
        Scheduled rent roll for the period.
        Uses formal rent_charges when they exist; falls back to active-lease
        monthly_rent × months-in-period so the metric is never empty even if
        the landlord hasn't created explicit charge records.
        """
        actual = await rent_charged(d_start, d_end)
        if actual > 0:
            return actual
        if not unit_ids:
            return 0.0
        # Leases active at the end of the period
        r = await db.execute(
            select(func.coalesce(func.sum(Lease.monthly_rent), 0)).where(
                Lease.unit_id.in_(unit_ids),
                Lease.lease_start <= d_end,
                or_(Lease.lease_end.is_(None), Lease.lease_end >= d_start),
                Lease.status == "active",
            )
        )
        monthly = float(r.scalar())
        months_in_period = ((d_end.year - d_start.year) * 12 + d_end.month - d_start.month) + 1
        return monthly * months_in_period

    async def rent_collected(d_start: date, d_end: date) -> float:
        if not lease_ids:
            return 0.0
        r = await db.execute(
            select(func.coalesce(func.sum(Payment.amount), 0)).where(
                Payment.lease_id.in_(lease_ids),
                Payment.payment_date >= d_start,
                Payment.payment_date <= d_end,
            )
        )
        return float(r.scalar())

    async def maintenance_opex(d_start: date, d_end: date) -> float:
        r = await db.execute(
            select(func.coalesce(func.sum(MaintenanceExpense.amount), 0)).where(
                MaintenanceExpense.property_id == property_id,
                MaintenanceExpense.is_capex == False,
                MaintenanceExpense.expense_date >= d_start,
                MaintenanceExpense.expense_date <= d_end,
            )
        )
        return float(r.scalar())

    async def maintenance_capex(d_start: date, d_end: date) -> float:
        r = await db.execute(
            select(func.coalesce(func.sum(MaintenanceExpense.amount), 0)).where(
                MaintenanceExpense.property_id == property_id,
                MaintenanceExpense.is_capex == True,
                MaintenanceExpense.expense_date >= d_start,
                MaintenanceExpense.expense_date <= d_end,
            )
        )
        return float(r.scalar())

    def property_costs_monthly_equiv(costs: list) -> float:
        total = 0.0
        for c in costs:
            if not c.is_active:
                continue
            amt = float(c.amount)
            if c.frequency == "monthly":
                total += amt
            elif c.frequency == "quarterly":
                total += amt / 3
            elif c.frequency == "annual":
                total += amt / 12
        return total

    # Fetch active property costs once
    costs_result = await db.execute(
        select(PropertyCost).where(
            PropertyCost.property_id == property_id,
            PropertyCost.is_active == True,
        )
    )
    active_costs = list(costs_result.scalars().all())
    monthly_fixed_costs = property_costs_monthly_equiv(active_costs)

    # Per-category monthly equivalents for the stacked expense chart
    def category_monthly_equiv(cat: str) -> float:
        total = 0.0
        for c in active_costs:
            if not c.is_active or c.category != cat:
                continue
            amt = float(c.amount)
            if c.frequency == "monthly":
                total += amt
            elif c.frequency == "quarterly":
                total += amt / 3
            elif c.frequency == "annual":
                total += amt / 12
        return total

    monthly_tax       = category_monthly_equiv("property_tax")
    monthly_insurance = category_monthly_equiv("insurance")
    monthly_hoa       = category_monthly_equiv("hoa")
    monthly_other_fixed = monthly_fixed_costs - monthly_tax - monthly_insurance - monthly_hoa

    def expense_bd(months: int, repairs: float, charged: float) -> dict:
        """Return per-category expense breakdown for a given period length."""
        # Management fee: only if property is managed by property manager
        # Note: charged = gross rent billed to tenant, before PM takes their fee
        mgmt_fee = 0.0
        if prop.is_property_managed and prop.management_fee_pct:
            mgmt_fee = charged * float(prop.management_fee_pct) / 100

        return {
            "loan_payment": round(monthly_debt_service * months, 2),
            "property_tax": round(monthly_tax * months, 2),
            "insurance":    round(monthly_insurance * months, 2),
            "hoa":          round(monthly_hoa * months, 2),
            "other_fixed":  round(monthly_other_fixed * months, 2),
            "repairs":      round(repairs, 2),
            "management_fee": round(mgmt_fee, 2),
        }

    # ── Loans → debt service (estimated) ──
    loans_result = await db.execute(
        select(Loan).where(Loan.property_id == property_id)
    )
    loans = list(loans_result.scalars().all())
    monthly_debt_service = sum(float(l.monthly_payment or 0) for l in loans)
    total_original_loan_amount = sum(float(l.original_amount or 0) for l in loans)
    total_current_balance = sum(float(l.current_balance or 0) for l in loans)

    # ── MONTHLY ──
    m_charged = await rent_roll(m_start, m_end)
    m_collected = await rent_collected(m_start, m_end)
    m_opex_maint = await maintenance_opex(m_start, m_end)
    m_opex = m_opex_maint + monthly_fixed_costs
    m_capex = await maintenance_capex(m_start, m_end)
    m_noi = m_collected - m_opex
    m_cash_flow = m_noi - monthly_debt_service
    occ_pct = (occupied_month / len(rentable_units) * 100) if rentable_units else 0.0

    # ── QUARTERLY ──
    q_charged = await rent_roll(q_start, q_end)
    q_collected = await rent_collected(q_start, q_end)
    q_opex_maint = await maintenance_opex(q_start, q_end)
    # Fixed costs for quarter (3 months)
    q_months = ((q_end.year - q_start.year) * 12 + q_end.month - q_start.month) + 1
    q_fixed = monthly_fixed_costs * q_months
    q_opex = q_opex_maint + q_fixed
    q_debt = monthly_debt_service * q_months
    q_noi = q_collected - q_opex
    q_cash_flow = q_noi - q_debt

    # Expense breakdown by category for quarter
    exp_cat_result = await db.execute(
        select(
            MaintenanceExpense.category,
            func.sum(MaintenanceExpense.amount).label("total"),
        )
        .where(
            MaintenanceExpense.property_id == property_id,
            MaintenanceExpense.expense_date >= q_start,
            MaintenanceExpense.expense_date <= q_end,
        )
        .group_by(MaintenanceExpense.category)
        .order_by(func.sum(MaintenanceExpense.amount).desc())
    )
    expense_by_category = [
        {"category": row.category, "total": float(row.total)}
        for row in exp_cat_result.all()
    ]

    # Turnover: leases that ended in the quarter
    turnover_result = await db.execute(
        select(Lease).where(
            Lease.unit_id.in_(unit_ids) if unit_ids else False,
            Lease.status == "ended",
            Lease.move_out_date >= q_start,
            Lease.move_out_date <= q_end,
        )
    ) if unit_ids else None
    ended_leases = list(turnover_result.scalars().all()) if turnover_result else []
    turnover_count = len(ended_leases)

    # Average vacancy days: days between move_out and next lease_start on same unit
    avg_vacancy_days = 0
    if ended_leases:
        vacancy_days_list = []
        for ended in ended_leases:
            if ended.move_out_date:
                next_lease_result = await db.execute(
                    select(Lease)
                    .where(
                        Lease.unit_id == ended.unit_id,
                        Lease.lease_start > ended.move_out_date,
                    )
                    .order_by(Lease.lease_start)
                    .limit(1)
                )
                next_lease = next_lease_result.scalar_one_or_none()
                if next_lease:
                    vacancy_days_list.append(
                        (next_lease.lease_start - ended.move_out_date).days
                    )
        if vacancy_days_list:
            avg_vacancy_days = sum(vacancy_days_list) / len(vacancy_days_list)

    # ── YTD (Jan 1 → end of selected month) ──
    ytd_start = date(year, 1, 1)
    ytd_end = m_end              # end of the selected month (consistent with MTD)
    ytd_start, ytd_end = _bound_by_purchase(ytd_start, ytd_end, prop.purchase_date)
    # Recalculate months from bounded period (not just calendar month count)
    ytd_months = max(1, ((ytd_end.year - ytd_start.year) * 12 + ytd_end.month - ytd_start.month) + 1) if ytd_end >= ytd_start else 0
    ytd_charged = await rent_roll(ytd_start, ytd_end)
    ytd_collected = await rent_collected(ytd_start, ytd_end)
    ytd_opex_maint = await maintenance_opex(ytd_start, ytd_end)
    ytd_capex = await maintenance_capex(ytd_start, ytd_end)
    ytd_fixed = monthly_fixed_costs * ytd_months
    ytd_opex = ytd_opex_maint + ytd_fixed
    ytd_debt = monthly_debt_service * ytd_months
    ytd_noi = ytd_collected - ytd_opex
    ytd_cash_flow = ytd_noi - ytd_debt

    # Total equity invested (for cash-on-cash)
    purchase_price = float(prop.purchase_price or 0)
    closing_costs = float(prop.closing_costs or 0)
    total_equity_invested = (
        purchase_price + closing_costs - total_original_loan_amount
    )
    cash_on_cash_ytd = (
        (ytd_cash_flow / total_equity_invested * 100)
        if total_equity_invested > 0
        else None
    )

    # ── ANNUAL ──
    y_charged = await rent_roll(y_start, y_end)
    y_collected = await rent_collected(y_start, y_end)
    y_opex_maint = await maintenance_opex(y_start, y_end)
    y_capex = await maintenance_capex(y_start, y_end)
    # Recalculate months from bounded period (not just 12 if purchase was mid-year)
    y_months = max(1, ((y_end.year - y_start.year) * 12 + y_end.month - y_start.month) + 1) if y_end >= y_start else 0
    y_fixed = monthly_fixed_costs * y_months
    y_opex = y_opex_maint + y_fixed
    y_debt = monthly_debt_service * y_months
    y_noi = y_collected - y_opex
    y_cash_flow = y_noi - y_debt

    # Prior year NOI
    py_collected = await rent_collected(py_start, py_end)
    py_opex_maint = await maintenance_opex(py_start, py_end)
    py_months = max(1, ((py_end.year - py_start.year) * 12 + py_end.month - py_start.month) + 1) if py_end >= py_start else 0
    py_opex = py_opex_maint + (monthly_fixed_costs * py_months)
    py_noi = py_collected - py_opex
    noi_yoy_pct = (
        ((y_noi - py_noi) / abs(py_noi) * 100) if py_noi != 0 else None
    )

    # Cap rate
    current_value = float(prop.current_value or 0)
    cap_rate = (y_noi / current_value * 100) if current_value > 0 else None

    # Tax rollups from property_costs
    tax_total = sum(
        float(c.amount) / (3 if c.frequency == "quarterly" else 1 if c.frequency == "monthly" else 12 if c.frequency == "annual" else 1) * 12
        for c in active_costs if c.category == "property_tax"
    )
    insurance_total = sum(
        float(c.amount) / (3 if c.frequency == "quarterly" else 1 if c.frequency == "monthly" else 12 if c.frequency == "annual" else 1) * 12
        for c in active_costs if c.category == "insurance"
    )

    # Current equity
    current_equity = current_value - total_current_balance

    # ── IRR ──
    irr_value = None
    capital_events_result = await db.execute(
        select(CapitalEvent)
        .where(CapitalEvent.property_id == property_id)
        .order_by(CapitalEvent.event_date)
    )
    capital_events = list(capital_events_result.scalars().all())

    # Resolve acquisition date: purchase_date → earliest payment → None
    _purchase_date = None
    if prop.purchase_date:
        _purchase_date = prop.purchase_date.date() if hasattr(prop.purchase_date, "date") else prop.purchase_date
    elif lease_ids:
        # Fall back to the earliest recorded payment when purchase_date is not set
        _earliest_pay_result = await db.execute(
            select(func.min(Payment.payment_date)).where(Payment.lease_id.in_(lease_ids))
        )
        _purchase_date = _earliest_pay_result.scalar()

    if capital_events or (total_equity_invested != 0 and _purchase_date):
        cf_list: list[tuple[date, float]] = []

        # If no acquisition event, auto-derive initial equity from property data
        has_acquisition = any(e.event_type == "acquisition" for e in capital_events)
        if not has_acquisition and _purchase_date and total_equity_invested > 0:
            cf_list.append((_purchase_date, -total_equity_invested))

        for e in capital_events:
            cf_list.append((e.event_date, float(e.amount)))

        # Add annual operating cash flows since earliest event year
        if cf_list:
            earliest = cf_list[0][0]
            for yr in range(earliest.year, year + 1):
                yr_s, yr_e = _year_range(yr)
                yr_s, yr_e = _bound_by_purchase(yr_s, yr_e, prop.purchase_date)
                yr_end_cap = yr_e if yr < year else date.today()
                yr_collected = await rent_collected(yr_s, yr_end_cap)
                yr_opex_m = await maintenance_opex(yr_s, yr_end_cap)
                yr_months = ((yr_end_cap.month - yr_s.month) + 1) + (yr_end_cap.year - yr_s.year) * 12
                yr_fixed = monthly_fixed_costs * yr_months
                yr_opex = yr_opex_m + yr_fixed
                yr_debt = monthly_debt_service * yr_months
                yr_op_cf = yr_collected - yr_opex - yr_debt
                cf_list.append((date(yr, 12, 31) if yr < year else date.today(), yr_op_cf))

            # Terminal value: current equity
            if current_equity > 0:
                cf_list.append((date.today(), current_equity))

        irr_value = _irr(cf_list)

    # ── LIFETIME (since acquisition) ──
    lifetime_data: dict | None = None
    if include_lifetime:
        if prop.purchase_date:
            lt_start = prop.purchase_date.date() if hasattr(prop.purchase_date, "date") else prop.purchase_date
        elif _purchase_date:
            # Already resolved above: earliest payment date (or None)
            lt_start = _purchase_date
        else:
            # Last resort: earliest rent charge date
            earliest_result = await db.execute(
                select(func.min(RentCharge.charge_date)).where(
                    RentCharge.lease_id.in_(lease_ids) if lease_ids else False
                )
            )
            lt_start = earliest_result.scalar() or date(year, 1, 1)
        lt_end = date.today()
        lt_months = max(1, ((lt_end.year - lt_start.year) * 12 + lt_end.month - lt_start.month) + 1)

        lt_charged = await rent_roll(lt_start, lt_end)
        lt_collected = await rent_collected(lt_start, lt_end)
        lt_opex_m = await maintenance_opex(lt_start, lt_end)
        lt_capex = await maintenance_capex(lt_start, lt_end)
        lt_fixed = monthly_fixed_costs * lt_months
        lt_opex = lt_opex_m + lt_fixed
        lt_debt = monthly_debt_service * lt_months
        lt_noi = lt_collected - lt_opex
        lt_cash_flow = lt_noi - lt_debt

        lifetime_data = {
            "start_date": lt_start.isoformat(),
            "months": lt_months,
            "rent_charged": round(lt_charged, 2),
            "rent_collected": round(lt_collected, 2),
            "delinquency": round(lt_charged - lt_collected, 2),
            "opex": round(lt_opex, 2),
            "capex": round(lt_capex, 2),
            "noi": round(lt_noi, 2),
            "debt_service": round(lt_debt, 2),
            "cash_flow": round(lt_cash_flow, 2),
            "avg_monthly_noi": round(lt_noi / lt_months, 2),
            "avg_monthly_cash_flow": round(lt_cash_flow / lt_months, 2),
            "cap_rate": round(cap_rate, 2) if cap_rate is not None else None,
            "irr": irr_value,
            "current_equity": round(current_equity, 2),
            "total_equity_invested": round(total_equity_invested, 2),
            "expense_breakdown": expense_bd(lt_months, lt_opex_m, lt_charged),
        }

    quarter_num = (month - 1) // 3 + 1

    result: dict = {
        "property_id": str(property_id),
        "property_address": prop.address,
        "year": year,
        "month": f"{year:04d}-{month:02d}",
        "quarter": f"{year}-Q{quarter_num}",
        "monthly": {
            "rent_charged": round(m_charged, 2),
            "rent_collected": round(m_collected, 2),
            "delinquency": round(m_charged - m_collected, 2),
            "opex": round(m_opex, 2),
            "capex": round(m_capex, 2),
            "noi": round(m_noi, 2),
            "debt_service": round(monthly_debt_service, 2),
            "cash_flow": round(m_cash_flow, 2),
            "occupancy_pct": round(occ_pct, 1),
            "rentable_units": len(rentable_units),
            "occupied_units": int(occupied_month),
            "expense_breakdown": expense_bd(1, m_opex_maint, m_charged),
        },
        "ytd": {
            "months": ytd_months,
            "rent_charged": round(ytd_charged, 2),
            "rent_collected": round(ytd_collected, 2),
            "delinquency": round(ytd_charged - ytd_collected, 2),
            "opex": round(ytd_opex, 2),
            "capex": round(ytd_capex, 2),
            "noi": round(ytd_noi, 2),
            "debt_service": round(ytd_debt, 2),
            "cash_flow": round(ytd_cash_flow, 2),
            "occupancy_pct": round(occ_pct, 1),
            "rentable_units": len(rentable_units),
            "occupied_units": int(occupied_month),
            "expense_breakdown": expense_bd(ytd_months, ytd_opex_maint, ytd_charged),
        },
        "quarterly": {
            "rent_charged": round(q_charged, 2),
            "rent_collected": round(q_collected, 2),
            "opex": round(q_opex, 2),
            "noi": round(q_noi, 2),
            "debt_service": round(q_debt, 2),
            "cash_flow": round(q_cash_flow, 2),
            "cash_on_cash_ytd": round(cash_on_cash_ytd, 2) if cash_on_cash_ytd is not None else None,
            "expense_by_category": expense_by_category,
            "turnover_count": turnover_count,
            "avg_vacancy_days": round(avg_vacancy_days, 1),
        },
        "annual": {
            "rent_charged": round(y_charged, 2),
            "rent_collected": round(y_collected, 2),
            "opex": round(y_opex, 2),
            "capex": round(y_capex, 2),
            "noi": round(y_noi, 2),
            "debt_service": round(y_debt, 2),
            "cash_flow": round(y_cash_flow, 2),
            "cap_rate": round(cap_rate, 2) if cap_rate is not None else None,
            "irr": irr_value,
            "noi_prior_year": round(py_noi, 2),
            "noi_yoy_pct": round(noi_yoy_pct, 1) if noi_yoy_pct is not None else None,
            "property_tax_annual": round(tax_total, 2),
            "insurance_annual": round(insurance_total, 2),
            "total_equity_invested": round(total_equity_invested, 2),
            "current_equity": round(current_equity, 2),
            "expense_breakdown": expense_bd(y_months, y_opex_maint, y_charged),
        },
    }
    if lifetime_data is not None:
        result["lifetime"] = lifetime_data
    return result


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/reports/property/{property_id}")
async def property_report(
    property_id: uuid.UUID,
    year: int = Query(default=None),
    month: str = Query(default=None),    # YYYY-MM
    period: str = Query(default="default"),  # "default" | "ltd"
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Per-property investment report: monthly, quarterly, and annual metrics."""
    today = date.today()
    if year is None:
        year = today.year
    if month is None:
        month = today.month
    else:
        try:
            month = int(month[5:7])
        except (ValueError, IndexError):
            raise HTTPException(status_code=400, detail="month must be YYYY-MM")

    # Verify ownership
    prop_result = await db.execute(
        select(Property).where(
            Property.id == property_id,
            Property.household_id == user.household_id,
        )
    )
    if not prop_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Property not found")

    return await _property_metrics(property_id, year, month, db, include_lifetime=(period == "ltd"))


@router.get("/reports/portfolio")
async def portfolio_report(
    year: int = Query(default=None),
    month: str = Query(default=None),  # YYYY-MM
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Portfolio report: per-property summaries + aggregate totals."""
    today = date.today()
    if year is None:
        year = today.year
    if month is None:
        month_num = today.month
    else:
        try:
            month_num = int(month[5:7])
        except (ValueError, IndexError):
            raise HTTPException(status_code=400, detail="month must be YYYY-MM")

    props_result = await db.execute(
        select(Property).where(Property.household_id == user.household_id)
    )
    properties = list(props_result.scalars().all())

    reports = []
    for prop in properties:
        try:
            report = await _property_metrics(prop.id, year, month_num, db)
            reports.append(report)
        except Exception as exc:
            logger.warning("Portfolio: skipping property %s — %s: %s", prop.id, type(exc).__name__, exc)

    # Aggregate portfolio totals
    def agg(key_path: list[str]) -> float:
        total = 0.0
        for r in reports:
            obj = r
            for k in key_path:
                obj = obj.get(k, 0) if isinstance(obj, dict) else 0
            total += float(obj or 0)
        return round(total, 2)

    def agg_bd(period: str) -> dict:
        cats = ["loan_payment", "property_tax", "insurance", "hoa", "other_fixed", "repairs", "management_fee"]
        return {c: agg([period, "expense_breakdown", c]) for c in cats}

    portfolio_total = {
        "monthly": {
            "rent_charged": agg(["monthly", "rent_charged"]),
            "rent_collected": agg(["monthly", "rent_collected"]),
            "delinquency": agg(["monthly", "delinquency"]),
            "opex": agg(["monthly", "opex"]),
            "capex": agg(["monthly", "capex"]),
            "noi": agg(["monthly", "noi"]),
            "debt_service": agg(["monthly", "debt_service"]),
            "cash_flow": agg(["monthly", "cash_flow"]),
            "rentable_units": agg(["monthly", "rentable_units"]),
            "occupied_units": agg(["monthly", "occupied_units"]),
            "expense_breakdown": agg_bd("monthly"),
        },
        "ytd": {
            "months": month_num,
            "rent_charged": agg(["ytd", "rent_charged"]),
            "rent_collected": agg(["ytd", "rent_collected"]),
            "delinquency": agg(["ytd", "delinquency"]),
            "opex": agg(["ytd", "opex"]),
            "capex": agg(["ytd", "capex"]),
            "noi": agg(["ytd", "noi"]),
            "debt_service": agg(["ytd", "debt_service"]),
            "cash_flow": agg(["ytd", "cash_flow"]),
            "rentable_units": agg(["monthly", "rentable_units"]),
            "occupied_units": agg(["monthly", "occupied_units"]),
            "expense_breakdown": agg_bd("ytd"),
        },
        "annual": {
            "rent_charged": agg(["annual", "rent_charged"]),
            "rent_collected": agg(["annual", "rent_collected"]),
            "opex": agg(["annual", "opex"]),
            "noi": agg(["annual", "noi"]),
            "debt_service": agg(["annual", "debt_service"]),
            "cash_flow": agg(["annual", "cash_flow"]),
            "total_equity_invested": agg(["annual", "total_equity_invested"]),
            "current_equity": agg(["annual", "current_equity"]),
        },
    }

    return {
        "year": year,
        "month": f"{year:04d}-{month_num:02d}",
        "properties": reports,
        "portfolio_total": portfolio_total,
    }


# ─── Tax Export (CSV for CPA) ─────────────────────────────────────────────────

@router.get("/reports/tax-export")
async def tax_export(
    year: int = Query(..., description="Tax year (e.g., 2025)"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Generate a CSV tax report for all properties for the given year.
    Format matches IRS Schedule E (Supplemental Income and Loss).
    """
    # Get all properties for the household
    props_result = await db.execute(
        select(Property).where(Property.household_id == user.household_id)
    )
    properties = list(props_result.scalars().all())

    if not properties:
        raise HTTPException(status_code=404, detail="No properties found")

    # Date range for the tax year
    year_start = date(year, 1, 1)
    year_end = date(year, 12, 31)

    # Prepare CSV data
    output = io.StringIO()
    writer = csv.writer(output)

    # Write header
    writer.writerow([
        "Property Address",
        "Gross Rents Received",
        "Management Fees",
        "Insurance",
        "Property Taxes",
        "HOA Fees",
        "Repairs & Maintenance",
        "Other Fixed Costs",
        "Total Operating Expenses",
        "Net Operating Income",
        "Capital Expenditures (Separate - For Depreciation)",
        "Loan Balance (End of Year)",
        "Notes"
    ])

    portfolio_totals = {
        "gross_rents": 0.0,
        "mgmt_fees": 0.0,
        "insurance": 0.0,
        "property_tax": 0.0,
        "hoa": 0.0,
        "repairs": 0.0,
        "other_fixed": 0.0,
        "total_opex": 0.0,
        "noi": 0.0,
        "capex": 0.0,
    }

    for prop in properties:
        # Get units for this property
        units_result = await db.execute(
            select(Unit).where(Unit.property_id == prop.id)
        )
        units = list(units_result.scalars().all())
        unit_ids = [u.id for u in units]

        # Get leases for these units
        if unit_ids:
            leases_result = await db.execute(
                select(Lease).where(Lease.unit_id.in_(unit_ids))
            )
            leases = list(leases_result.scalars().all())
            lease_ids = [l.id for l in leases]
        else:
            lease_ids = []

        # Calculate gross rents received (actual payments)
        gross_rents = 0.0
        if lease_ids:
            payments_result = await db.execute(
                select(func.sum(Payment.amount)).where(
                    and_(
                        Payment.lease_id.in_(lease_ids),
                        Payment.payment_date >= year_start,
                        Payment.payment_date <= year_end,
                    )
                )
            )
            gross_rents = float(payments_result.scalar() or 0)

        # Calculate rent charged (for management fee calculation)
        rent_charged = 0.0
        if lease_ids:
            charges_result = await db.execute(
                select(func.sum(RentCharge.amount)).where(
                    and_(
                        RentCharge.lease_id.in_(lease_ids),
                        RentCharge.charge_date >= year_start,
                        RentCharge.charge_date <= year_end,
                    )
                )
            )
            rent_charged = float(charges_result.scalar() or 0)

        # Get active property costs
        costs_result = await db.execute(
            select(PropertyCost).where(
                PropertyCost.property_id == prop.id,
                PropertyCost.is_active == True,
            )
        )
        costs = list(costs_result.scalars().all())

        # Calculate annual amounts for each cost category
        def annual_amount(cost: PropertyCost) -> float:
            amt = float(cost.amount)
            if cost.frequency == "monthly":
                return amt * 12
            elif cost.frequency == "quarterly":
                return amt * 4
            elif cost.frequency == "annual":
                return amt
            else:  # one_time
                return amt

        insurance_annual = sum(annual_amount(c) for c in costs if c.category == "insurance")
        property_tax_annual = sum(annual_amount(c) for c in costs if c.category == "property_tax")
        hoa_annual = sum(annual_amount(c) for c in costs if c.category == "hoa")
        other_fixed_annual = sum(
            annual_amount(c) for c in costs
            if c.category not in ("insurance", "property_tax", "hoa")
        )

        # Get maintenance expenses (repairs only, not CapEx)
        repairs_result = await db.execute(
            select(func.sum(MaintenanceExpense.amount)).where(
                and_(
                    MaintenanceExpense.property_id == prop.id,
                    MaintenanceExpense.expense_date >= year_start,
                    MaintenanceExpense.expense_date <= year_end,
                    MaintenanceExpense.is_capex == False,
                )
            )
        )
        repairs_annual = float(repairs_result.scalar() or 0)

        # Get CapEx separately (for depreciation schedule)
        capex_result = await db.execute(
            select(func.sum(MaintenanceExpense.amount)).where(
                and_(
                    MaintenanceExpense.property_id == prop.id,
                    MaintenanceExpense.expense_date >= year_start,
                    MaintenanceExpense.expense_date <= year_end,
                    MaintenanceExpense.is_capex == True,
                )
            )
        )
        capex_annual = float(capex_result.scalar() or 0)

        # Calculate management fees (based on rent charged, not collected)
        mgmt_fees = 0.0
        if prop.is_property_managed and prop.management_fee_pct:
            mgmt_fees = rent_charged * float(prop.management_fee_pct) / 100

        # Get loan balance at end of year
        loans_result = await db.execute(
            select(Loan).where(Loan.property_id == prop.id)
        )
        loans = list(loans_result.scalars().all())
        total_loan_balance = sum(float(l.current_balance or 0) for l in loans)

        # Calculate totals
        total_opex = mgmt_fees + insurance_annual + property_tax_annual + hoa_annual + repairs_annual + other_fixed_annual
        noi = gross_rents - total_opex

        # Write property row
        writer.writerow([
            prop.address,
            f"{gross_rents:.2f}",
            f"{mgmt_fees:.2f}",
            f"{insurance_annual:.2f}",
            f"{property_tax_annual:.2f}",
            f"{hoa_annual:.2f}",
            f"{repairs_annual:.2f}",
            f"{other_fixed_annual:.2f}",
            f"{total_opex:.2f}",
            f"{noi:.2f}",
            f"{capex_annual:.2f}",
            f"{total_loan_balance:.2f}",
            "See loan statements for mortgage interest breakdown"
        ])

        # Accumulate portfolio totals
        portfolio_totals["gross_rents"] += gross_rents
        portfolio_totals["mgmt_fees"] += mgmt_fees
        portfolio_totals["insurance"] += insurance_annual
        portfolio_totals["property_tax"] += property_tax_annual
        portfolio_totals["hoa"] += hoa_annual
        portfolio_totals["repairs"] += repairs_annual
        portfolio_totals["other_fixed"] += other_fixed_annual
        portfolio_totals["total_opex"] += total_opex
        portfolio_totals["noi"] += noi
        portfolio_totals["capex"] += capex_annual

    # Write portfolio total row
    writer.writerow([
        "PORTFOLIO TOTAL",
        f"{portfolio_totals['gross_rents']:.2f}",
        f"{portfolio_totals['mgmt_fees']:.2f}",
        f"{portfolio_totals['insurance']:.2f}",
        f"{portfolio_totals['property_tax']:.2f}",
        f"{portfolio_totals['hoa']:.2f}",
        f"{portfolio_totals['repairs']:.2f}",
        f"{portfolio_totals['other_fixed']:.2f}",
        f"{portfolio_totals['total_opex']:.2f}",
        f"{portfolio_totals['noi']:.2f}",
        f"{portfolio_totals['capex']:.2f}",
        "",
        ""
    ])

    # Add notes section
    writer.writerow([])
    writer.writerow(["IMPORTANT NOTES FOR CPA:"])
    writer.writerow(["1. Gross Rents = Actual payments received (cash basis)"])
    writer.writerow(["2. Repairs & Maintenance = Operating expenses (deductible in current year)"])
    writer.writerow(["3. Capital Expenditures = Must be depreciated over time (NOT deductible in current year)"])
    writer.writerow(["4. Mortgage Interest: See loan statements - only INTEREST is deductible, not principal"])
    writer.writerow(["5. Management Fees = Based on gross rents charged (before manager takes cut)"])
    writer.writerow(["6. This report does NOT include: Depreciation, Mortgage Interest breakdown, or Prior year carryover losses"])

    # Return CSV as downloadable file
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=rental_tax_report_{year}.csv"
        }
    )
