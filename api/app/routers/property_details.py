import csv
import io
import uuid
from datetime import date
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.property import Property
from app.models.property_details import Loan, MaintenanceExpense, PropertyCost
from app.models.user import User
from app.schemas.property_details import (
    LoanCreate,
    LoanResponse,
    LoanUpdate,
    MaintenanceExpenseCreate,
    MaintenanceExpenseResponse,
    MaintenanceExpenseUpdate,
    PropertyCostCreate,
    PropertyCostResponse,
    PropertyCostUpdate,
)

router = APIRouter(tags=["property-details"])


# ─── Helper: verify property ownership ───────────────────────────────────────

async def _get_property(
    property_id: uuid.UUID,
    user: User,
    db: AsyncSession,
) -> Property:
    result = await db.execute(
        select(Property).where(
            Property.id == property_id,
            Property.household_id == user.household_id,
        )
    )
    prop = result.scalar_one_or_none()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    return prop


# ─── Loans ────────────────────────────────────────────────────────────────────

@router.get("/properties/{property_id}/loans", response_model=list[LoanResponse])
async def list_loans(
    property_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_property(property_id, user, db)
    result = await db.execute(
        select(Loan)
        .where(Loan.property_id == property_id)
        .order_by(Loan.created_at)
    )
    return result.scalars().all()


@router.post("/properties/{property_id}/loans", response_model=LoanResponse, status_code=201)
async def create_loan(
    property_id: uuid.UUID,
    payload: LoanCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_property(property_id, user, db)
    loan = Loan(property_id=property_id, **payload.model_dump())
    db.add(loan)
    await db.flush()
    await db.refresh(loan)
    return loan


@router.patch("/loans/{loan_id}", response_model=LoanResponse)
async def update_loan(
    loan_id: uuid.UUID,
    payload: LoanUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Loan)
        .join(Property, Loan.property_id == Property.id)
        .where(Loan.id == loan_id, Property.household_id == user.household_id)
    )
    loan = result.scalar_one_or_none()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(loan, field, value)
    await db.flush()
    await db.refresh(loan)
    return loan


@router.delete("/loans/{loan_id}", status_code=204)
async def delete_loan(
    loan_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Loan)
        .join(Property, Loan.property_id == Property.id)
        .where(Loan.id == loan_id, Property.household_id == user.household_id)
    )
    loan = result.scalar_one_or_none()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    await db.delete(loan)


# ─── Property Costs ───────────────────────────────────────────────────────────

@router.get("/properties/{property_id}/costs", response_model=list[PropertyCostResponse])
async def list_costs(
    property_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_property(property_id, user, db)
    result = await db.execute(
        select(PropertyCost)
        .where(PropertyCost.property_id == property_id)
        .order_by(PropertyCost.category, PropertyCost.created_at)
    )
    return result.scalars().all()


@router.post("/properties/{property_id}/costs", response_model=PropertyCostResponse, status_code=201)
async def create_cost(
    property_id: uuid.UUID,
    payload: PropertyCostCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_property(property_id, user, db)
    cost = PropertyCost(property_id=property_id, **payload.model_dump())
    db.add(cost)
    await db.flush()
    await db.refresh(cost)
    return cost


@router.patch("/property-costs/{cost_id}", response_model=PropertyCostResponse)
async def update_cost(
    cost_id: uuid.UUID,
    payload: PropertyCostUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PropertyCost)
        .join(Property, PropertyCost.property_id == Property.id)
        .where(PropertyCost.id == cost_id, Property.household_id == user.household_id)
    )
    cost = result.scalar_one_or_none()
    if not cost:
        raise HTTPException(status_code=404, detail="Cost not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(cost, field, value)
    await db.flush()
    await db.refresh(cost)
    return cost


@router.delete("/property-costs/{cost_id}", status_code=204)
async def delete_cost(
    cost_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PropertyCost)
        .join(Property, PropertyCost.property_id == Property.id)
        .where(PropertyCost.id == cost_id, Property.household_id == user.household_id)
    )
    cost = result.scalar_one_or_none()
    if not cost:
        raise HTTPException(status_code=404, detail="Cost not found")
    await db.delete(cost)


# ─── Maintenance Expenses ─────────────────────────────────────────────────────

@router.get("/properties/{property_id}/expenses", response_model=list[MaintenanceExpenseResponse])
async def list_expenses(
    property_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_property(property_id, user, db)
    result = await db.execute(
        select(MaintenanceExpense)
        .where(MaintenanceExpense.property_id == property_id)
        .order_by(MaintenanceExpense.expense_date.desc())
    )
    return result.scalars().all()


@router.post("/properties/{property_id}/expenses", response_model=MaintenanceExpenseResponse, status_code=201)
async def create_expense(
    property_id: uuid.UUID,
    payload: MaintenanceExpenseCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_property(property_id, user, db)
    expense = MaintenanceExpense(property_id=property_id, **payload.model_dump())
    db.add(expense)
    await db.flush()
    await db.refresh(expense)
    return expense


@router.patch("/expenses/{expense_id}", response_model=MaintenanceExpenseResponse)
async def update_expense(
    expense_id: uuid.UUID,
    payload: MaintenanceExpenseUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(MaintenanceExpense)
        .join(Property, MaintenanceExpense.property_id == Property.id)
        .where(MaintenanceExpense.id == expense_id, Property.household_id == user.household_id)
    )
    expense = result.scalar_one_or_none()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(expense, field, value)
    await db.flush()
    await db.refresh(expense)
    return expense


@router.delete("/expenses/{expense_id}", status_code=204)
async def delete_expense(
    expense_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(MaintenanceExpense)
        .join(Property, MaintenanceExpense.property_id == Property.id)
        .where(MaintenanceExpense.id == expense_id, Property.household_id == user.household_id)
    )
    expense = result.scalar_one_or_none()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    await db.delete(expense)


# ─── Maintenance Expense CSV Import ──────────────────────────────────────────

_CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "repair":         ["repair", "fix", "replace", "broken", "damage"],
    "appliance":      ["appliance", "fridge", "refrigerator", "washer", "dryer",
                       "dishwasher", "oven", "microwave", "stove"],
    "landscaping":    ["lawn", "landscape", "mow", "mowing", "tree", "garden",
                       "yard", "mulch", "fertilize", "shrub", "bush", "trim"],
    "cleaning":       ["clean", "cleaning", "janitorial", "pressure wash", "power wash"],
    "inspection":     ["inspect", "inspection", "pest", "termite", "survey", "assessment"],
    "plumbing":       ["plumb", "pipe", "drain", "leak", "toilet", "faucet",
                       "water heater", "sewer", "clog"],
    "electrical":     ["electric", "wiring", "outlet", "breaker", "light",
                       "panel", "switch", "circuit"],
    "roofing":        ["roof", "shingle", "gutter", "skylight", "flashing"],
    "hvac":           ["hvac", "heat", "furnace", "ac ", " ac", "air condition",
                       "cooling", "duct", "filter", "boiler"],
    "management_fee": ["management fee", "property management", "mgmt fee",
                       "management company", "pm fee"],
    "administrative": ["admin", "administrative", "office", "accounting", "bookkeeping",
                       "legal", "attorney", "filing", "permit", "license"],
    "leasing_fee":    ["leasing fee", "leasing commission", "tenant placement",
                       "advertising", "listing fee", "vacancy", "rental commission"],
}

_VALID_CATEGORIES = set(_CATEGORY_KEYWORDS.keys()) | {"other"}


def _guess_category(description: str) -> str:
    text = description.lower()
    for category, keywords in _CATEGORY_KEYWORDS.items():
        if any(kw in text for kw in keywords):
            return category
    return "other"


@router.post("/properties/{property_id}/expenses/import-csv")
async def import_expenses_csv(
    property_id: uuid.UUID,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Import maintenance expenses from CSV.
    Required columns: expense_date, amount, description
    Optional columns: vendor, category, notes
    """
    await _get_property(property_id, user, db)

    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv")

    content = await file.read()
    try:
        text = content.decode("utf-8-sig")  # handle BOM from Excel
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File must be UTF-8 encoded")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV file is empty")

    # Normalize to lowercase for matching
    col_map: dict[str, str] = {h.lower().strip(): h for h in reader.fieldnames}
    required = {"expense_date", "amount", "description"}
    missing = required - set(col_map.keys())
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"CSV missing required columns: {', '.join(sorted(missing))}. "
                   f"Required: expense_date, amount, description",
        )

    imported = 0
    errors: list[dict] = []

    for row_num, raw_row in enumerate(reader, start=2):  # 1=header
        row = {k.lower().strip(): v.strip() for k, v in raw_row.items() if v is not None}

        # --- expense_date ---
        raw_date = row.get("expense_date", "").strip()
        try:
            parsed_date = date.fromisoformat(raw_date)
        except ValueError:
            errors.append({"row": row_num, "error": f"Invalid date '{raw_date}' (use YYYY-MM-DD)"})
            continue

        # --- amount ---
        raw_amount = row.get("amount", "").strip().lstrip("$").replace(",", "")
        try:
            amount = Decimal(raw_amount)
            if amount <= 0:
                raise ValueError("must be positive")
        except (InvalidOperation, ValueError):
            errors.append({"row": row_num, "error": f"Invalid amount '{raw_amount}'"})
            continue

        # --- description ---
        description = row.get("description", "").strip()
        if not description:
            errors.append({"row": row_num, "error": "Description is required"})
            continue

        # --- optional fields ---
        vendor = row.get("vendor", "").strip() or None
        notes  = row.get("notes", "").strip() or None

        raw_category = row.get("category", "").strip().lower()
        if raw_category in _VALID_CATEGORIES:
            category = raw_category
        elif raw_category:
            # unknown category provided — try keyword match on it too, else guess from description
            category = _guess_category(raw_category + " " + description)
        else:
            category = _guess_category(description)

        expense = MaintenanceExpense(
            property_id=property_id,
            expense_date=parsed_date,
            amount=amount,
            description=description,
            vendor=vendor,
            category=category,
            notes=notes,
        )
        db.add(expense)
        imported += 1

    return {"imported": imported, "errors": errors, "total_rows": imported + len(errors)}
