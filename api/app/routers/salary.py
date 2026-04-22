import uuid
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.salary_withholdings import SalaryWithholding
from app.models.user import User

router = APIRouter(prefix="/salary", tags=["salary"])


class SalaryWithholdingResponse(BaseModel):
    id: str
    household_id: str
    user_id: str
    year: int
    employer_name: Optional[str]
    gross_wages: str
    federal_wages: str
    medicare_wages: str
    federal_income_tax: str
    state_income_tax: str
    social_security_tax: str
    medicare_tax: str
    traditional_401k: str
    roth_401k: str
    esop_income: str
    hsa: str
    health_insurance: str
    group_term_life: str
    fsa_section125: str

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm_obj(cls, obj: SalaryWithholding) -> "SalaryWithholdingResponse":
        return cls(
            id=str(obj.id),
            household_id=str(obj.household_id),
            user_id=str(obj.user_id),
            year=obj.year,
            employer_name=obj.employer_name,
            gross_wages=str(obj.gross_wages),
            federal_wages=str(obj.federal_wages),
            medicare_wages=str(obj.medicare_wages),
            federal_income_tax=str(obj.federal_income_tax),
            state_income_tax=str(obj.state_income_tax),
            social_security_tax=str(obj.social_security_tax),
            medicare_tax=str(obj.medicare_tax),
            traditional_401k=str(obj.traditional_401k),
            roth_401k=str(obj.roth_401k),
            esop_income=str(obj.esop_income),
            hsa=str(obj.hsa),
            health_insurance=str(obj.health_insurance),
            group_term_life=str(obj.group_term_life),
            fsa_section125=str(obj.fsa_section125),
        )


class SalaryWithholdingUpsert(BaseModel):
    user_id: uuid.UUID
    year: int
    employer_name: Optional[str] = None
    gross_wages: str = "0"
    federal_wages: str = "0"
    medicare_wages: str = "0"
    federal_income_tax: str = "0"
    state_income_tax: str = "0"
    social_security_tax: str = "0"
    medicare_tax: str = "0"
    traditional_401k: str = "0"
    roth_401k: str = "0"
    esop_income: str = "0"
    hsa: str = "0"
    health_insurance: str = "0"
    group_term_life: str = "0"
    fsa_section125: str = "0"


@router.get("/withholdings", response_model=list[SalaryWithholdingResponse])
async def list_withholdings(
    year: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    stmt = select(SalaryWithholding).where(
        SalaryWithholding.household_id == current_user.household_id
    )
    if year is not None:
        stmt = stmt.where(SalaryWithholding.year == year)
    stmt = stmt.order_by(SalaryWithholding.year.desc(), SalaryWithholding.employer_name)
    result = await db.execute(stmt)
    rows = result.scalars().all()
    return [SalaryWithholdingResponse.from_orm_obj(r) for r in rows]


@router.put("/withholdings", response_model=SalaryWithholdingResponse)
async def upsert_withholding(
    data: SalaryWithholdingUpsert,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Validate user_id belongs to same household
    result = await db.execute(
        select(User).where(
            User.id == data.user_id,
            User.household_id == current_user.household_id,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="User not found in household")

    # Try to find existing record
    result = await db.execute(
        select(SalaryWithholding).where(
            SalaryWithholding.household_id == current_user.household_id,
            SalaryWithholding.user_id == data.user_id,
            SalaryWithholding.year == data.year,
        )
    )
    record = result.scalar_one_or_none()

    decimal_fields = [
        "gross_wages", "federal_wages", "medicare_wages",
        "federal_income_tax", "state_income_tax", "social_security_tax", "medicare_tax",
        "traditional_401k", "roth_401k", "esop_income",
        "hsa", "health_insurance", "group_term_life", "fsa_section125",
    ]

    if record:
        record.employer_name = data.employer_name
        for field in decimal_fields:
            setattr(record, field, Decimal(getattr(data, field)))
    else:
        record = SalaryWithholding(
            household_id=current_user.household_id,
            user_id=data.user_id,
            year=data.year,
            employer_name=data.employer_name,
            **{field: Decimal(getattr(data, field)) for field in decimal_fields},
        )
        db.add(record)

    await db.commit()
    await db.refresh(record)
    return SalaryWithholdingResponse.from_orm_obj(record)


@router.delete("/withholdings/{record_id}", status_code=204)
async def delete_withholding(
    record_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(SalaryWithholding).where(
            SalaryWithholding.id == record_id,
            SalaryWithholding.household_id == current_user.household_id,
        )
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    await db.delete(record)
    await db.commit()
