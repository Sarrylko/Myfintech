import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

# ── Category taxonomy ──────────────────────────────────────────────────────────
# document_type → allowed categories
#
# "tax":        w2 | 1099_nec | 1099_misc | 1099_r | ssa_1099 | 1099_b | 1099_div
#               | 1099_int | k1 | 1098 | 1098_t | schedule_e | 1040 | state_return | tax_other
# "investment": brokerage_statement | cost_basis | stock_options | rsu_schedule
#               | options_agreement | investment_other
# "retirement": 401k_statement | ira_statement | pension_statement | ss_statement
#               | rmd_notice | retirement_other
# "insurance":  life_insurance | disability_insurance | health_insurance
#               | umbrella_policy | annuity | insurance_other
# "banking":    bank_statement | credit_report | loan_agreement | cd_statement | banking_other
# "income":     pay_stub | employment_contract | offer_letter | equity_agreement | income_other
# "estate":     will | trust | power_of_attorney | beneficiary_designation | estate_other
# "other":      other
# ──────────────────────────────────────────────────────────────────────────────


class FinancialDocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    household_id: uuid.UUID
    owner_user_id: uuid.UUID | None
    document_type: str
    category: str
    reference_year: int | None
    filename: str
    file_size: int
    content_type: str
    description: str | None
    uploaded_at: datetime
