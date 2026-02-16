"""Plaid transaction sync service — idempotent, incremental."""

import logging

from app.worker import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.services.sync.sync_all_items")
def sync_all_items():
    """Iterate all active PlaidItems and sync transactions."""
    logger.info("Starting scheduled transaction sync for all items")
    # Implementation will be added in Phase B
    # 1. Query all active PlaidItems
    # 2. For each item, call sync_item(item_id)
    # 3. Use cursor-based sync (Plaid transactions/sync endpoint)
    # 4. Upsert transactions (idempotent by plaid_transaction_id)
    # 5. Handle pending → posted transitions
    # 6. Update account balances


@celery_app.task(name="app.services.sync.sync_item")
def sync_item(plaid_item_id: str):
    """Sync a single Plaid item — called on-demand or by sync_all_items."""
    logger.info(f"Syncing PlaidItem {plaid_item_id}")
    # Implementation in Phase B
