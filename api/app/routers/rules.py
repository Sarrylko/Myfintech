import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.account import Account, Transaction
from app.models.rule import CategorizationRule
from app.models.user import User
from app.schemas.rule import RuleCreate, RuleResponse, RuleUpdate

router = APIRouter(prefix="/rules", tags=["rules"])


def _match_rule(rule: CategorizationRule, txn: Transaction, account_type: str) -> bool:
    """Return True if the rule condition matches this transaction."""
    field = rule.match_field
    mtype = rule.match_type
    val = rule.match_value.lower()

    if field == "name":
        target = (txn.name or "").lower()
    elif field == "merchant_name":
        target = (txn.merchant_name or "").lower()
    elif field == "account_type":
        # exact match only
        return account_type.lower() == val
    else:
        return False

    if mtype == "contains":
        return val in target
    elif mtype == "exact":
        return target == val
    return False


def apply_rules_to_txn(
    txn: Transaction,
    account_type: str,
    rules: list[CategorizationRule],
) -> bool:
    """Apply the first matching rule. Returns True if any rule matched."""
    for rule in sorted(rules, key=lambda r: r.priority, reverse=True):
        if not rule.is_active:
            continue
        if _match_rule(rule, txn, account_type):
            if rule.category_string:
                txn.plaid_category = rule.category_string
            if rule.negate_amount:
                txn.amount = -abs(txn.amount)
            return True
    return False


@router.get("/", response_model=list[RuleResponse])
async def list_rules(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CategorizationRule)
        .where(CategorizationRule.household_id == user.household_id)
        .order_by(CategorizationRule.priority.desc(), CategorizationRule.created_at)
    )
    return result.scalars().all()


@router.post("/", response_model=RuleResponse, status_code=201)
async def create_rule(
    payload: RuleCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rule = CategorizationRule(
        household_id=user.household_id,
        name=payload.name,
        match_field=payload.match_field,
        match_type=payload.match_type,
        match_value=payload.match_value,
        category_string=payload.category_string,
        negate_amount=payload.negate_amount,
        priority=payload.priority,
        is_active=True,
    )
    db.add(rule)
    await db.flush()
    await db.refresh(rule)
    await db.commit()
    return rule


@router.patch("/{rule_id}", response_model=RuleResponse)
async def update_rule(
    rule_id: uuid.UUID,
    payload: RuleUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CategorizationRule).where(
            CategorizationRule.id == rule_id,
            CategorizationRule.household_id == user.household_id,
        )
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(rule, field, value)

    await db.flush()
    await db.refresh(rule)
    await db.commit()
    return rule


@router.delete("/{rule_id}", status_code=204)
async def delete_rule(
    rule_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CategorizationRule).where(
            CategorizationRule.id == rule_id,
            CategorizationRule.household_id == user.household_id,
        )
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    await db.delete(rule)
    await db.commit()


@router.post("/apply", status_code=200)
async def apply_rules_to_all(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Apply all active rules to every uncategorized transaction in the household."""
    # Load rules
    rules_result = await db.execute(
        select(CategorizationRule)
        .where(
            CategorizationRule.household_id == user.household_id,
            CategorizationRule.is_active == True,  # noqa: E712
        )
        .order_by(CategorizationRule.priority.desc())
    )
    rules = rules_result.scalars().all()

    if not rules:
        return {"applied": 0}

    # Load accounts for type lookup
    accts_result = await db.execute(
        select(Account).where(Account.household_id == user.household_id)
    )
    account_map = {a.id: a for a in accts_result.scalars().all()}

    # Load all transactions (not just uncategorized — rules can also flip sign)
    txns_result = await db.execute(
        select(Transaction).where(Transaction.household_id == user.household_id)
    )
    txns = txns_result.scalars().all()

    applied = 0
    for txn in txns:
        acct = account_map.get(txn.account_id)
        account_type = acct.type if acct else ""
        if apply_rules_to_txn(txn, account_type, rules):
            applied += 1

    if applied > 0:
        await db.commit()

    return {"applied": applied}
