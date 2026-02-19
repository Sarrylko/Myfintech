import csv
import io
import uuid
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.property import Property
from app.models.rental import Lease, Payment, RentCharge, Tenant, Unit
from app.models.user import User
from app.schemas.rental import (
    LeaseCreate,
    LeaseResponse,
    LeaseUpdate,
    PaymentCreate,
    PaymentResponse,
    PaymentUpdate,
    RentChargeCreate,
    RentChargeResponse,
    TenantCreate,
    TenantResponse,
    TenantUpdate,
    UnitCreate,
    UnitResponse,
    UnitUpdate,
)

router = APIRouter(tags=["rentals"])


# ─── Helper: verify property ownership ──────────────────────────────────────

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


async def _get_unit(
    unit_id: uuid.UUID,
    user: User,
    db: AsyncSession,
) -> Unit:
    result = await db.execute(
        select(Unit)
        .join(Property, Unit.property_id == Property.id)
        .where(Unit.id == unit_id, Property.household_id == user.household_id)
    )
    unit = result.scalar_one_or_none()
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")
    return unit


async def _get_lease(
    lease_id: uuid.UUID,
    user: User,
    db: AsyncSession,
) -> Lease:
    result = await db.execute(
        select(Lease)
        .join(Unit, Lease.unit_id == Unit.id)
        .join(Property, Unit.property_id == Property.id)
        .where(Lease.id == lease_id, Property.household_id == user.household_id)
    )
    lease = result.scalar_one_or_none()
    if not lease:
        raise HTTPException(status_code=404, detail="Lease not found")
    return lease


# ─── Units ───────────────────────────────────────────────────────────────────

@router.get("/properties/{property_id}/units", response_model=list[UnitResponse])
async def list_units(
    property_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_property(property_id, user, db)
    result = await db.execute(
        select(Unit)
        .where(Unit.property_id == property_id)
        .order_by(Unit.unit_label)
    )
    return result.scalars().all()


@router.post("/properties/{property_id}/units", response_model=UnitResponse, status_code=201)
async def create_unit(
    property_id: uuid.UUID,
    payload: UnitCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_property(property_id, user, db)
    unit = Unit(property_id=property_id, **payload.model_dump())
    db.add(unit)
    await db.flush()
    await db.refresh(unit)
    return unit


@router.patch("/units/{unit_id}", response_model=UnitResponse)
async def update_unit(
    unit_id: uuid.UUID,
    payload: UnitUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    unit = await _get_unit(unit_id, user, db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(unit, field, value)
    await db.flush()
    await db.refresh(unit)
    return unit


@router.delete("/units/{unit_id}", status_code=204)
async def delete_unit(
    unit_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    unit = await _get_unit(unit_id, user, db)
    await db.delete(unit)


# ─── Tenants ─────────────────────────────────────────────────────────────────

@router.get("/tenants/", response_model=list[TenantResponse])
async def list_tenants(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Tenant)
        .where(Tenant.household_id == user.household_id)
        .order_by(Tenant.name)
    )
    return result.scalars().all()


@router.post("/tenants/", response_model=TenantResponse, status_code=201)
async def create_tenant(
    payload: TenantCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant = Tenant(household_id=user.household_id, **payload.model_dump())
    db.add(tenant)
    await db.flush()
    await db.refresh(tenant)
    return tenant


@router.patch("/tenants/{tenant_id}", response_model=TenantResponse)
async def update_tenant(
    tenant_id: uuid.UUID,
    payload: TenantUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Tenant).where(
            Tenant.id == tenant_id,
            Tenant.household_id == user.household_id,
        )
    )
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(tenant, field, value)
    await db.flush()
    await db.refresh(tenant)
    return tenant


@router.delete("/tenants/{tenant_id}", status_code=204)
async def delete_tenant(
    tenant_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Tenant).where(
            Tenant.id == tenant_id,
            Tenant.household_id == user.household_id,
        )
    )
    tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    await db.delete(tenant)


# ─── Leases ──────────────────────────────────────────────────────────────────

@router.get("/units/{unit_id}/leases", response_model=list[LeaseResponse])
async def list_unit_leases(
    unit_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_unit(unit_id, user, db)
    result = await db.execute(
        select(Lease)
        .where(Lease.unit_id == unit_id)
        .order_by(Lease.lease_start.desc())
    )
    return result.scalars().all()


@router.get("/leases/", response_model=list[LeaseResponse])
async def list_leases(
    status: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(Lease)
        .join(Unit, Lease.unit_id == Unit.id)
        .join(Property, Unit.property_id == Property.id)
        .where(Property.household_id == user.household_id)
        .order_by(Lease.lease_start.desc())
    )
    if status:
        query = query.where(Lease.status == status)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/leases/", response_model=LeaseResponse, status_code=201)
async def create_lease(
    payload: LeaseCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_unit(payload.unit_id, user, db)
    # Verify tenant belongs to same household
    result = await db.execute(
        select(Tenant).where(
            Tenant.id == payload.tenant_id,
            Tenant.household_id == user.household_id,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Tenant not found")

    lease = Lease(**payload.model_dump())
    db.add(lease)
    await db.flush()
    await db.refresh(lease)
    return lease


@router.patch("/leases/{lease_id}", response_model=LeaseResponse)
async def update_lease(
    lease_id: uuid.UUID,
    payload: LeaseUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    lease = await _get_lease(lease_id, user, db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(lease, field, value)
    await db.flush()
    await db.refresh(lease)
    return lease


@router.delete("/leases/{lease_id}", status_code=204)
async def delete_lease(
    lease_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    lease = await _get_lease(lease_id, user, db)
    await db.delete(lease)


# ─── Rent Charges ─────────────────────────────────────────────────────────────

@router.get("/leases/{lease_id}/charges", response_model=list[RentChargeResponse])
async def list_charges(
    lease_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_lease(lease_id, user, db)
    result = await db.execute(
        select(RentCharge)
        .where(RentCharge.lease_id == lease_id)
        .order_by(RentCharge.charge_date.desc())
    )
    return result.scalars().all()


@router.post("/leases/{lease_id}/charges", response_model=RentChargeResponse, status_code=201)
async def create_charge(
    lease_id: uuid.UUID,
    payload: RentChargeCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_lease(lease_id, user, db)
    charge = RentCharge(lease_id=lease_id, **payload.model_dump())
    db.add(charge)
    await db.flush()
    await db.refresh(charge)
    return charge


# ─── Payments ─────────────────────────────────────────────────────────────────

@router.get("/leases/{lease_id}/payments", response_model=list[PaymentResponse])
async def list_payments(
    lease_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_lease(lease_id, user, db)
    result = await db.execute(
        select(Payment)
        .where(Payment.lease_id == lease_id)
        .order_by(Payment.payment_date.desc())
    )
    return result.scalars().all()


@router.post("/leases/{lease_id}/payments", response_model=PaymentResponse, status_code=201)
async def create_payment(
    lease_id: uuid.UUID,
    payload: PaymentCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_lease(lease_id, user, db)
    payment = Payment(lease_id=lease_id, **payload.model_dump())
    db.add(payment)
    await db.flush()
    await db.refresh(payment)
    return payment


@router.patch("/payments/{payment_id}", response_model=PaymentResponse)
async def update_payment(
    payment_id: uuid.UUID,
    payload: PaymentUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Payment)
        .join(Lease, Payment.lease_id == Lease.id)
        .join(Unit, Lease.unit_id == Unit.id)
        .join(Property, Unit.property_id == Property.id)
        .where(Payment.id == payment_id, Property.household_id == user.household_id)
    )
    payment = result.scalar_one_or_none()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(payment, field, value)
    await db.flush()
    await db.refresh(payment)
    return payment


@router.delete("/payments/{payment_id}", status_code=204)
async def delete_payment(
    payment_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Payment)
        .join(Lease, Payment.lease_id == Lease.id)
        .join(Unit, Lease.unit_id == Unit.id)
        .join(Property, Unit.property_id == Property.id)
        .where(Payment.id == payment_id, Property.household_id == user.household_id)
    )
    payment = result.scalar_one_or_none()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    await db.delete(payment)


_VALID_METHODS = {"cash", "check", "ach", "zelle", "other"}


@router.post("/leases/{lease_id}/payments/import-csv")
async def import_payments_csv(
    lease_id: uuid.UUID,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Import payments for a lease from CSV.

    Required columns: payment_date (YYYY-MM-DD), amount
    Optional columns: method (cash|check|ach|zelle|other), notes
    """
    await _get_lease(lease_id, user, db)

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

    col_map: dict[str, str] = {h.lower().strip(): h for h in reader.fieldnames}
    required = {"payment_date", "amount"}
    missing = required - set(col_map.keys())
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"CSV missing required columns: {', '.join(sorted(missing))}. "
                   "Required: payment_date, amount",
        )

    imported = 0
    errors: list[dict] = []

    from datetime import date as date_type
    for row_num, raw_row in enumerate(reader, start=2):  # 1 = header
        row = {k.lower().strip(): (v.strip() if v else "") for k, v in raw_row.items()}

        # payment_date
        raw_date = row.get("payment_date", "")
        try:
            parsed_date = date_type.fromisoformat(raw_date)
        except ValueError:
            errors.append({"row": row_num, "error": f"Invalid date '{raw_date}' (use YYYY-MM-DD)"})
            continue

        # amount
        raw_amount = row.get("amount", "").lstrip("$").replace(",", "")
        try:
            amount = Decimal(raw_amount)
            if amount <= 0:
                raise ValueError("must be positive")
        except (InvalidOperation, ValueError):
            errors.append({"row": row_num, "error": f"Invalid amount '{raw_amount}'"})
            continue

        # method (optional, normalise to lowercase)
        raw_method = row.get("method", "").lower() or None
        method = raw_method if raw_method in _VALID_METHODS else None

        notes = row.get("notes", "") or None

        payment = Payment(
            lease_id=lease_id,
            payment_date=parsed_date,
            amount=amount,
            method=method,
            notes=notes,
        )
        db.add(payment)
        imported += 1

    if imported:
        await db.flush()

    return {
        "imported": imported,
        "total_rows": imported + len(errors),
        "errors": errors,
    }
