"""Net worth snapshot service."""

import logging

from app.worker import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.services.networth.take_snapshot_all")
def take_snapshot_all():
    """Take a daily net worth snapshot for all households."""
    logger.info("Taking net worth snapshots for all households")
    # Implementation in Phase E
    # 1. For each household:
    #    - Sum depository + savings balances → total_cash
    #    - Sum investment account values → total_investments
    #    - Sum property current_value → total_real_estate
    #    - Sum credit + loan balances → total_debts
    #    - net_worth = cash + investments + real_estate - debts
    # 2. Insert NetWorthSnapshot row
