"""Tax planning: profile, projection, opportunities, what-if scenarios and a
document checklist for the Tax Center.

  GET  /tax/profile?year=                 profile (or defaults) + rental and entity tax fields
  PUT  /tax/profile?year=                 upsert the profile
  PUT  /tax/properties/{id}               land value, in-service date, personal-use days
  PUT  /tax/entities/{id}                 tax classification and owner/plan details
  GET  /tax/projection?year=              projected tax, where it comes from, data gaps
  GET  /tax/opportunities?year=           priced year-end moves
  PUT  /tax/opportunities/{id}?year=      mark one dismissed / done / open
  POST /tax/scenario?year=                base vs what-if
  GET  /tax/checklist?year=               expected tax forms vs uploaded documents
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.account import Account
from app.models.business_entity import BusinessEntity
from app.models.financial_document import FinancialDocument
from app.models.property import Property
from app.models.property_details import Loan
from app.models.salary_withholdings import SalaryWithholding
from app.models.tax_profile import TaxProfile
from app.models.user import User
from app.services import tax_tables as tt
from app.services.tax import tax_treatment
from app.services.tax_calc import compute
from app.services.tax_opportunities import build_opportunities
from app.services.tax_projection import (
    SCENARIO_FIELDS, apply_scenario, gather_inputs, load_profile, profile_defaults, serialize,
)

router = APIRouter(prefix="/tax", tags=["tax"])

_MONEY_FIELDS = (
    "prior_year_agi", "prior_year_tax", "expected_bonus", "other_ordinary_income", "capital_loss_carryover",
    "above_line_adjustments", "mortgage_interest_override", "property_tax_override", "charitable_cash",
    "charitable_noncash", "medical_expenses", "other_itemized", "estimated_payments_federal",
    "estimated_payments_state", "suspended_passive_loss",
)
_OTHER_FIELDS = (
    "filing_status", "state", "taxpayer_birthdate", "spouse_birthdate", "dependents_under_17",
    "other_dependents", "real_estate_professional", "active_participation",
)


def _year(year: int | None) -> int:
    return year or datetime.now(timezone.utc).year


def _money(v) -> str | None:
    return None if v is None else str(Decimal(str(v)).quantize(Decimal("0.01")))


# ─── Profile ─────────────────────────────────────────────────────────────────

class TaxProfileUpdate(BaseModel):
    filing_status: Optional[Literal["single", "mfj", "mfs", "hoh"]] = None
    state: Optional[str] = Field(None, max_length=2)
    taxpayer_birthdate: Optional[date] = None
    spouse_birthdate: Optional[date] = None
    dependents_under_17: Optional[int] = Field(None, ge=0, le=20)
    other_dependents: Optional[int] = Field(None, ge=0, le=20)
    real_estate_professional: Optional[bool] = None
    active_participation: Optional[bool] = None
    prior_year_agi: Optional[Decimal] = None
    prior_year_tax: Optional[Decimal] = None
    expected_bonus: Optional[Decimal] = None
    other_ordinary_income: Optional[Decimal] = None
    capital_loss_carryover: Optional[Decimal] = None
    above_line_adjustments: Optional[Decimal] = None
    mortgage_interest_override: Optional[Decimal] = None
    property_tax_override: Optional[Decimal] = None
    charitable_cash: Optional[Decimal] = None
    charitable_noncash: Optional[Decimal] = None
    medical_expenses: Optional[Decimal] = None
    other_itemized: Optional[Decimal] = None
    estimated_payments_federal: Optional[Decimal] = None
    estimated_payments_state: Optional[Decimal] = None
    suspended_passive_loss: Optional[Decimal] = None


def _profile_out(p: TaxProfile | None, defaults: dict, year: int) -> dict:
    out = {"year": year, "exists": p is not None}
    for f in _OTHER_FIELDS:
        v = getattr(p, f) if p else defaults.get(f)
        out[f] = v.isoformat() if isinstance(v, date) else v
    for f in _MONEY_FIELDS:
        v = getattr(p, f) if p else defaults.get(f)
        out[f] = _money(v)
    return out


@router.get("/profile")
async def get_profile(
    year: Optional[int] = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    year = _year(year)
    hid = user.household_id
    p = await load_profile(db, hid, year)
    defaults = await profile_defaults(db, hid, year)
    props = (await db.execute(
        select(Property).where(
            Property.household_id == hid,
            Property.is_primary_residence == False,  # noqa: E712
            or_(Property.country.is_(None), Property.country == "US"),  # Schedule E is US-only
        )
        .order_by(Property.address)
    )).scalars().all()
    entities = (await db.execute(
        select(BusinessEntity).where(BusinessEntity.household_id == hid, BusinessEntity.is_active == True)  # noqa: E712
        .order_by(BusinessEntity.name)
    )).scalars().all()
    return {
        "profile": _profile_out(p, defaults, year),
        "properties": [
            {
                "id": str(pr.id), "address": pr.address, "purchase_price": _money(pr.purchase_price),
                "purchase_date": pr.purchase_date.date().isoformat() if pr.purchase_date else None,
                "land_value": _money(pr.land_value),
                "placed_in_service_date": pr.placed_in_service_date.isoformat() if pr.placed_in_service_date else None,
                "personal_use_days": pr.personal_use_days,
            }
            for pr in props
        ],
        "entities": [
            {
                "id": str(e.id), "name": e.name, "entity_type": e.entity_type,
                "tax_classification": e.tax_classification, "owner_salary": _money(e.owner_salary),
                "home_office_sqft": e.home_office_sqft,
                "health_insurance_premiums": _money(e.health_insurance_premiums),
                "retirement_plan": e.retirement_plan, "retirement_contribution": _money(e.retirement_contribution),
                "accountable_plan": e.accountable_plan,
            }
            for e in entities if e.entity_type != "trust"
        ],
        "states": sorted(tt.STATE_TAX_RATES),
    }


@router.put("/profile")
async def put_profile(
    body: TaxProfileUpdate,
    year: Optional[int] = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    year = _year(year)
    hid = user.household_id
    p = await load_profile(db, hid, year)
    if p is None:
        defaults = await profile_defaults(db, hid, year)
        p = TaxProfile(household_id=hid, year=year)
        for f in _OTHER_FIELDS + ("prior_year_agi", "prior_year_tax"):
            v = defaults.get(f)
            if v is not None:
                setattr(p, f, Decimal(str(v)) if f.startswith("prior_") else v)
        db.add(p)
    for f, v in body.model_dump(exclude_unset=True).items():
        if f in ("filing_status", "dependents_under_17", "other_dependents",
                 "real_estate_professional", "active_participation") and v is None:
            continue  # not nullable
        if f == "state" and v:
            v = v.upper()
        setattr(p, f, v)
    await db.commit()
    await db.refresh(p)
    return _profile_out(p, {}, year)


class PropertyTaxUpdate(BaseModel):
    land_value: Optional[Decimal] = None
    placed_in_service_date: Optional[date] = None
    personal_use_days: Optional[int] = Field(None, ge=0, le=366)


@router.put("/properties/{property_id}")
async def put_property_tax(
    property_id: uuid.UUID,
    body: PropertyTaxUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    prop = (await db.execute(
        select(Property).where(Property.id == property_id, Property.household_id == user.household_id)
    )).scalar_one_or_none()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    for f, v in body.model_dump(exclude_unset=True).items():
        setattr(prop, f, v)
    await db.commit()
    return {"ok": True}


class EntityTaxUpdate(BaseModel):
    tax_classification: Optional[Literal["schedule_c", "partnership", "s_corp", "c_corp"]] = None
    owner_salary: Optional[Decimal] = None
    home_office_sqft: Optional[int] = Field(None, ge=0, le=100_000)
    health_insurance_premiums: Optional[Decimal] = None
    retirement_plan: Optional[Literal["none", "sep", "solo_401k", "simple"]] = None
    retirement_contribution: Optional[Decimal] = None
    accountable_plan: Optional[bool] = None


@router.put("/entities/{entity_id}")
async def put_entity_tax(
    entity_id: uuid.UUID,
    body: EntityTaxUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ent = (await db.execute(
        select(BusinessEntity).where(BusinessEntity.id == entity_id, BusinessEntity.household_id == user.household_id)
    )).scalar_one_or_none()
    if not ent:
        raise HTTPException(status_code=404, detail="Entity not found")
    for f, v in body.model_dump(exclude_unset=True).items():
        if f == "accountable_plan" and v is None:
            continue
        setattr(ent, f, v)
    await db.commit()
    return {"ok": True}


# ─── Projection, opportunities, scenarios ────────────────────────────────────

def _inputs_summary(inp) -> dict:
    return {
        "filing_status": inp.filing_status,
        "state": inp.state,
        "taxpayer_age": inp.taxpayer_age,
        "spouse_age": inp.spouse_age,
        "earners": [
            {"name": e.name, "wages": e.wages, "federal_withheld": e.federal_withheld,
             "state_withheld": e.state_withheld, "k401_traditional": e.k401_traditional,
             "k401_roth": e.k401_roth, "hsa_payroll": e.hsa_payroll}
            for e in inp.earners
        ],
    }


@router.get("/projection")
async def get_projection(
    year: Optional[int] = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    year = _year(year)
    inputs, ctx = await gather_inputs(db, user.household_id, year)
    return serialize({
        "projection": compute(inputs),
        "inputs": _inputs_summary(inputs),
        "context": ctx,
    })


async def _status_map(db: AsyncSession, household_id: uuid.UUID, year: int) -> dict:
    p = await load_profile(db, household_id, year)
    return dict(p.opportunity_status or {}) if p else {}


@router.get("/opportunities")
async def get_opportunities(
    year: Optional[int] = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    year = _year(year)
    inputs, ctx = await gather_inputs(db, user.household_id, year)
    result = compute(inputs)
    statuses = await _status_map(db, user.household_id, year)
    opps = build_opportunities(inputs, result, ctx)
    for o in opps:
        o["status"] = statuses.get(o["id"], "open")
    total = sum(o["est_savings"] or 0 for o in opps if o["status"] == "open")
    return serialize({"year": year, "total_est_savings": total, "opportunities": opps})


class OpportunityStatus(BaseModel):
    status: Literal["open", "dismissed", "done"]


@router.put("/opportunities/{opportunity_id}")
async def put_opportunity_status(
    opportunity_id: str,
    body: OpportunityStatus,
    year: Optional[int] = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    year = _year(year)
    p = await load_profile(db, user.household_id, year)
    if p is None:
        defaults = await profile_defaults(db, user.household_id, year)
        p = TaxProfile(household_id=user.household_id, year=year,
                       **{f: defaults[f] for f in _OTHER_FIELDS if defaults.get(f) is not None})
        db.add(p)
    statuses = dict(p.opportunity_status or {})
    if body.status == "open":
        statuses.pop(opportunity_id, None)
    else:
        statuses[opportunity_id] = body.status
    p.opportunity_status = statuses  # reassign so SQLAlchemy sees the JSONB change
    await db.commit()
    return {"id": opportunity_id, "status": body.status}


class ScenarioRequest(BaseModel):
    changes: dict[str, float] = {}


@router.post("/scenario")
async def run_scenario(
    body: ScenarioRequest,
    year: Optional[int] = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    year = _year(year)
    unknown = set(body.changes) - set(SCENARIO_FIELDS)
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown scenario fields: {', '.join(sorted(unknown))}")
    inputs, _ = await gather_inputs(db, user.household_id, year)
    base = compute(inputs)
    scenario = compute(apply_scenario(inputs, body.changes))

    def pick(r: dict) -> dict:
        return {
            "agi": r["agi"], "taxable_income": r["taxable_income"],
            "federal": r["tax"]["federal_total"], "state": r["tax"]["state"], "total": r["tax"]["total"],
            "balance_federal": r["balance"]["federal"], "marginal_rate": r["rates"]["marginal_rate"],
            "effective_rate": r["rates"]["effective_rate"],
        }

    b, s = pick(base), pick(scenario)
    return serialize({
        "fields": list(SCENARIO_FIELDS),
        "base": b,
        "scenario": s,
        "delta": {k: s[k] - b[k] for k in ("agi", "taxable_income", "federal", "state", "total", "balance_federal")},
    })


# ─── Document checklist ──────────────────────────────────────────────────────

@router.get("/checklist")
async def get_checklist(
    year: Optional[int] = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Forms the household should expect for the year, matched to uploads by form type."""
    year = _year(year)
    hid = user.household_id
    expected: list[dict] = []

    w2s = (await db.execute(
        select(SalaryWithholding).where(SalaryWithholding.household_id == hid, SalaryWithholding.year == year)
    )).scalars().all()
    for w in w2s:
        expected.append({"category": "w2", "label": f"W-2 — {w.employer_name or 'employer'}"})

    accounts = (await db.execute(
        select(Account).where(Account.household_id == hid, Account.is_hidden == False,  # noqa: E712
                              Account.country == "US")
    )).scalars().all()
    brokers = sorted({
        a.institution_name or (a.plaid_item.institution_name if a.plaid_item else None) or a.name
        for a in accounts if a.type == "investment" and tax_treatment(a) in ("taxable", "crypto")
    })
    for b in brokers:
        expected.append({"category": "1099_b", "label": f"1099 composite (B/DIV/INT) — {b}"})
    retirement_brokers = sorted({
        a.institution_name or (a.plaid_item.institution_name if a.plaid_item else None) or a.name
        for a in accounts if a.type == "investment" and tax_treatment(a) in ("tax_deferred", "tax_free")
    })
    for b in retirement_brokers:
        expected.append({"category": "1099_r", "label": f"1099-R / 5498 if you withdrew or contributed — {b}",
                         "optional": True})
    banks = sorted({
        a.institution_name or (a.plaid_item.institution_name if a.plaid_item else None) or a.name
        for a in accounts if a.type == "depository" and (a.subtype or "") in ("savings", "cd", "money market")
    })
    for b in banks:
        expected.append({"category": "1099_int", "label": f"1099-INT (if over $10 interest) — {b}", "optional": True})

    loans = (await db.execute(
        select(Loan, Property.address).join(Property, Property.id == Loan.property_id)
        .where(Property.household_id == hid)
    )).all()
    for loan, address in loans:
        expected.append({"category": "1098", "label": f"1098 mortgage interest — {loan.lender_name or address}"})

    entities = (await db.execute(
        select(BusinessEntity).where(BusinessEntity.household_id == hid, BusinessEntity.is_active == True)  # noqa: E712
    )).scalars().all()
    for e in entities:
        cls = e.tax_classification or {"s_corp": "s_corp", "partnership": "partnership"}.get(e.entity_type)
        if cls in ("s_corp", "partnership"):
            expected.append({"category": "k1", "label": f"Schedule K-1 — {e.name}"})

    p = await load_profile(db, hid, year)
    if p and p.dependents_under_17:
        expected.append({"category": "tax_other", "label": "Childcare provider statements (if claiming the credit)",
                         "optional": True})
    expected.append({"category": "1040", "label": f"{year - 1} federal return (for safe harbor and carryovers)",
                     "year": year - 1})

    counts = {
        (cat, yr): n for cat, yr, n in (await db.execute(
            select(FinancialDocument.category, FinancialDocument.reference_year, func.count())
            .where(FinancialDocument.household_id == hid, FinancialDocument.document_type == "tax",
                   FinancialDocument.reference_year.in_((year, year - 1)))
            .group_by(FinancialDocument.category, FinancialDocument.reference_year)
        )).all()
    }
    # 1099 composites are often filed under DIV or INT instead of B
    aliases = {"1099_b": ("1099_b", "1099_div"), "1099_int": ("1099_int",)}
    used: dict[tuple, int] = {}
    items = []
    for item in expected:
        yr = item.get("year", year)
        cats = aliases.get(item["category"], (item["category"],))
        received = False
        for c in cats:
            if used.get((c, yr), 0) < counts.get((c, yr), 0):
                used[(c, yr)] = used.get((c, yr), 0) + 1
                received = True
                break
        items.append({**item, "year": yr, "optional": item.get("optional", False), "received": received})
    return {
        "year": year,
        "items": items,
        "received": sum(1 for i in items if i["received"]),
        "required": sum(1 for i in items if not i["optional"]),
        "required_received": sum(1 for i in items if i["received"] and not i["optional"]),
    }
