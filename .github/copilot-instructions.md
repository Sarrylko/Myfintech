# MyFintech AI Coding Assistant Instructions

Self-hosted personal finance dashboard with multi-tenant support. Focus on async database operations, strict household isolation, and clean data layer separation.

## Architecture Overview

**Stack**: FastAPI + async SQLAlchemy, Next.js 14, Celery/Redis, PostgreSQL, Plaid/SnapTrade integrations

**Services**:
- **API** (`api/app/main.py`): FastAPI with async SQLAlchemy, all endpoints prefixed `/api/v1`
- **Frontend** (`frontend/src/`): Next.js 14 with RSC patterns
- **Worker** (`api/app/worker.py`): Celery background tasks + Celery Beat scheduler
- **Database** (`api/alembic/versions/`): PostgreSQL 16, no raw SQL in handlers
- **Auth**: JWT tokens (access + refresh), household-scoped via `user.household_id`

## Key Patterns & Conventions

### 1. Async Database Layer (Critical)
- All DB operations are **async** using `AsyncSession` from `sqlalchemy.ext.asyncio`
- Use `async with async_session() as session:` pattern (already handled in `get_db()`)
- **Never** import or use sync SQLAlchemy in endpoint code
- Relationships use `lazy="selectin"` to avoid greenlet issues: `category: Mapped["Category"] = relationship(lazy="selectin")`
- Example from `budget.py`: After querying, use `.scalars()` for lists, `.scalar_one_or_none()` for single
  ```python
  stmt = select(Budget).where(Budget.id == budget_id)
  budget = await db.scalars(stmt).first()  # NOT db.query()
  ```

### 2. Household Isolation (Security)
- **All multi-tenant data** (budgets, accounts, transactions, rules) is scoped to `household_id`
- Every data model has `household_id: Mapped[uuid.UUID] = mapped_column(..., ForeignKey("households.id"))`
- **Every query must filter by household** to prevent cross-tenant data leaks
  ```python
  stmt = select(Budget).where(
    (Budget.household_id == user.household_id) & 
    (Budget.id == budget_id)
  )
  ```
- User authentication returns `user.household_id` via `get_current_user` dependency

### 3. Request/Response Schemas (Pydantic)
- **All** input payloads use `BaseModel` schemas in `schemas/` (e.g., `BudgetCreate`, `BudgetUpdate`)
- Response models use `model_config = {"from_attributes": True}` to map from ORM objects
- Validation happens in schema (`@model_validator`) before DB writes
- Example from `budget.py` schema:
  ```python
  @model_validator(mode="after")
  def validate_period(self) -> "BudgetCreate":
      if self.budget_type == BudgetType.monthly and self.month is None:
          raise ValueError("month is required for monthly budgets")
      return self
  ```

### 4. Router Pattern (Endpoints)
- Routers in `routers/` use `APIRouter(prefix="/path", tags=["tag"])` 
- All handlers receive `current_user: User = Depends(get_current_user)` + `db: AsyncSession = Depends(get_db)`
- Use `@router.get()`, `@router.post()`, `@router.patch()`, `@router.delete()`
- Always return typed Pydantic models (not raw dicts)
- Example from `budget.py`:
  ```python
  @router.post("", response_model=BudgetResponse)
  async def create_budget(
      req: BudgetCreate,
      db: AsyncSession = Depends(get_db),
      user: User = Depends(get_current_user),
  ) -> BudgetResponse:
      budget = Budget(household_id=user.household_id, **req.model_dump())
      db.add(budget)
      await db.commit()
      return budget
  ```

### 5. Model/Column Patterns
- **UUID Primary Keys**: `id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)`
- **Foreign Keys**: `household_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("households.id"), index=True)`
- **Decimal Money**: `amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))`
- **Timestamps**: `created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))`
- **Enums**: Use `String` columns with enum validation in schemas, not SQLAlchemy Enum
- **Relationships**: Always specify `lazy="selectin"` for async compatibility

### 6. Budget Categories & Matching
- Budget categories tracked via `Budget.category_id` → `Category` table
- **Plaid matching**: Budget actual spending sums transactions by:
  1. `custom_category_id` (user override), OR
  2. `plaid_category` prefix match (see `_PLAID_PREFIXES` dict in `routers/budget.py`)
- Budget types: `monthly`, `annual`, `quarterly`, `custom`
- Monthly budgets use `month` + `year`; others use `start_date` + `end_date`

### 7. Migration Workflow
- Run migrations: `cd api && alembic upgrade head`
- Create migration: `alembic revision --autogenerate -m "description"`
- Migrations auto-detected from `alembic/versions/` (version naming: timestamp + description)
- Alembic env.py configured for async, targets both sync/async URLs

### 8. Testing & Local Dev
- **Run API locally**: `python -m uvicorn app.main:app --reload` (from `api/`)
- **API docs**: http://localhost:8000/docs (Swagger UI in dev mode)
- **Database**: PostgreSQL 16 or managed instance; configure via `DATABASE_URL`
- **Redis**: Required for Celery; configure via `REDIS_URL`

### 9. Multi-Service Communication
- **Frontend → API**: HTTP REST calls to `/api/v1/*` endpoints
- **API → External**: Plaid (banking), SnapTrade (investments), property APIs via service clients
- **Worker → API**: Celery tasks read/write same PostgreSQL database
- **Scheduler**: Celery Beat triggers tasks based on `worker.py` schedule definition

### 10. Common Tasks

**Adding a new endpoint**:
1. Create Pydantic schema in `schemas/{entity}.py` (`{Entity}Create`, `{Entity}Response`, etc.)
2. Add router handler in `routers/{entity}.py` with signature: `async def handler(req: ReqSchema, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user))`
3. Validate `user.household_id` in query filters
4. Use `db.add()`, `await db.commit()` for writes
5. Return Pydantic response model
6. Router auto-included in `main.py` ✓

**Adding a new database model**:
1. Create class in `models/{entity}.py` inheriting from `Base`
2. Add `household_id`, timestamps, and relationships with `lazy="selectin"`
3. Run `alembic revision --autogenerate -m "add {entity}"` to generate migration
4. Review generated migration and adjust if needed
5. Run `alembic upgrade head`

**Adding a background task**:
1. Define Celery task in `services/{feature}.py` or inline in `worker.py`
2. Import task in `worker.py` and trigger via `task.delay()`
3. For scheduled tasks, add schedule to `CELERY_BEAT_SCHEDULE` in `worker.py`
4. Worker consumes from Redis queue

## File Organization

```
api/app/
├── core/          → Config (settings, database, security, deps)
├── models/        → SQLAlchemy ORM classes (all inherit Base)
├── schemas/       → Pydantic request/response models
├── routers/       → FastAPI route handlers (import schemas + models)
├── services/      → Business logic (Plaid sync, calculations, Celery tasks)
├── main.py        → FastAPI app + middleware setup
└── worker.py      → Celery app + beat schedule
```

## Environment & Secrets

- Config via `.env` (top-level or auto-discovered from `core/config.py`)
- Use `settings` object from `core/config.py` for config access
- Sensitive keys: `api_secret_key`, `plaid_secret`, `encryption_key`, `snaptrade_consumer_key`
- Database: `DATABASE_URL` (async: `postgresql+asyncpg://`), `DATABASE_URL_SYNC` for migrations
- Redis: `REDIS_URL` for Celery

## Gotchas & Anti-Patterns

❌ **Don't**: Use `db.query()` (sync SQLAlchemy)  
✅ **Do**: Use `session.scalars(select(...))` or `session.execute(select(...))`

❌ **Don't**: Skip household filtering in queries  
✅ **Do**: Always include `where(Model.household_id == user.household_id)`

❌ **Don't**: Define relationships without `lazy="selectin"`  
✅ **Do**: `category: Mapped["Category"] = relationship(lazy="selectin")`

❌ **Don't**: Commit individual inserts in loops  
✅ **Do**: Batch adds then single `await db.commit()`

❌ **Don't**: Store Plaid tokens unencrypted  
✅ **Do**: Use Fernet encryption (see `core/security.py`)

---

**Last Updated**: 2026-02-22 | **Phase**: Phase C (Budgets) in progress
