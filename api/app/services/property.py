"""Property valuation refresh service."""

import logging

from app.worker import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.services.property.refresh_valuations")
def refresh_valuations():
    """Refresh property valuations from configured API provider."""
    logger.info("Refreshing property valuations")
    # Implementation in Phase E
    # 1. Query all properties
    # 2. For each, call the configured property valuation API
    # 3. Insert PropertyValuation record
    # 4. Update Property.current_value and last_valuation_date
