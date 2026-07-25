"""Plaid transaction sync service — delegates to plaid_sync for implementation."""

import logging

from app.worker import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.services.sync.sync_all_items")
def sync_all_items():
    """Iterate all active PlaidItems and sync transactions."""
    from app.services.plaid_sync import sync_all_plaid_items
    sync_all_plaid_items()


@celery_app.task(name="app.services.sync.sync_item")
def sync_item(plaid_item_id: str):
    """Sync a single Plaid item — called on-demand or by sync_all_items."""
    from app.services.plaid_sync import sync_single_plaid_item
    sync_single_plaid_item(plaid_item_id)
