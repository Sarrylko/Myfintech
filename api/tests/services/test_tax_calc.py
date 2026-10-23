"""Hand-checked 2026 cases for the tax engine (tax_calc.compute)."""

from datetime import date

import pytest

from app.services import tax_tables as tt
from app.services.tax_calc import Business, Earner, TaxInputs, compute


def _w2(wages: float, withheld: float = 0.0, user: str = "u1") -> Earner:
    return Earner(user_id=user, name=user, wages=wages, medicare_wages=wages, ss_wages=min(wages, 184_500),
                  federal_withheld=withheld)


def test_brackets_mfj_wages_only():
    r = compute(TaxInputs(year=2026, filing_status="mfj", state="TX", earners=[_w2(200_000, 30_000)]))
    assert r["taxable_income"] == pytest.approx(167_800)
    # 10% of 24,800 + 12% of 76,000 + 22% of 67,000
    assert r["tax"]["federal_total"] == pytest.approx(2_480 + 9_120 + 14_740)
    assert r["tax"]["state"] == 0
    assert r["balance"]["federal"] == pytest.approx(26_340 - 30_000)
    assert r["rates"]["marginal_rate"] == 0.22
    assert r["bracket"]["room"] == pytest.approx(211_400 - 167_800)


def test_sole_prop_se_tax_and_qbi():
    r = compute(TaxInputs(
        year=2026, filing_status="single", state="TX",
        businesses=[Business(id="b", name="Biz", classification="schedule_c", net_profit=100_000)],
    ))
    se = 100_000 * 0.9235 * 0.153
    assert r["tax"]["self_employment"] == pytest.approx(se)
    agi = 100_000 - se / 2
    assert r["agi"] == pytest.approx(agi)
    before_qbi = agi - 16_100
    qbi = 0.2 * min(100_000 - se / 2, before_qbi)
    assert r["deductions"]["qbi"] == pytest.approx(qbi)
    taxable = before_qbi - qbi
    income_tax = 1_240 + 0.12 * (50_400 - 12_400) + 0.22 * (taxable - 50_400)
    assert r["tax"]["federal_total"] == pytest.approx(income_tax + se)


def test_long_term_gains_stack_on_ordinary_income():
    r = compute(TaxInputs(year=2026, filing_status="single", state="TX",
                          earners=[_w2(40_000)], lt_gains=30_000))
    # taxable 53,900: ordinary 23,900, gains 30,000 of which 25,550 sit in the 0% band
    assert r["taxable_income"] == pytest.approx(53_900)
    assert r["tax"]["ordinary"] == pytest.approx(1_240 + 0.12 * 11_500)
    assert r["tax"]["capital_gains"] == pytest.approx(0.15 * 4_450)


def test_capital_loss_limited_to_3000_and_carried_forward():
    r = compute(TaxInputs(year=2026, filing_status="single", earners=[_w2(80_000)], st_gains=-10_000))
    assert r["income"]["capital_gain_or_loss"] == -3_000
    assert r["income"]["capital_loss_carryover_out"] == 7_000


def test_rental_loss_allowance_phases_out():
    r = compute(TaxInputs(year=2026, filing_status="single", earners=[_w2(120_000)], rental_net=-30_000))
    # $25k allowance less half of the $20k over $100k MAGI
    assert r["income"]["rental"] == pytest.approx(-15_000)
    assert r["income"]["suspended_passive_out"] == pytest.approx(15_000)


def test_salt_cap_and_itemizing():
    r = compute(TaxInputs(
        year=2026, filing_status="mfj", state="CA",
        earners=[Earner(user_id="a", name="a", wages=300_000, state_withheld=25_000)],
        property_tax=20_000, mortgage_interest=15_000,
    ))
    d = r["deductions"]
    assert d["salt"] == pytest.approx(40_400)
    assert d["itemizing"] is True
    assert d["itemized"] == pytest.approx(55_400)


def test_niit_and_additional_medicare():
    r = compute(TaxInputs(year=2026, filing_status="single", earners=[_w2(250_000)], interest=20_000))
    assert r["tax"]["niit"] == pytest.approx(0.038 * 20_000)
    assert r["tax"]["additional_medicare"] == pytest.approx(0.009 * 50_000)


def test_child_credit_and_safe_harbor():
    r = compute(TaxInputs(
        year=2026, filing_status="mfj", earners=[_w2(150_000, 10_000)], dependents_under_17=2,
        prior_year_agi=140_000, prior_year_tax=12_000, as_of=date(2026, 10, 22),
    ))
    assert r["tax"]["credits"] == pytest.approx(4_400)
    sh = r["safe_harbor"]
    assert sh["required"] == pytest.approx(min(0.9 * r["tax"]["federal_total"], 12_000))
    assert [q["due"] for q in sh["quarterly"]] == ["2027-01-15"]


def test_senior_deduction():
    r = compute(TaxInputs(year=2026, filing_status="mfj", earners=[_w2(100_000)], taxpayer_age=67, spouse_age=66))
    assert r["deductions"]["senior"] == pytest.approx(12_000)
    assert r["deductions"]["standard"] == pytest.approx(32_200 + 2 * 1_650)


def test_unknown_year_uses_nearest_table():
    assert tt.table_for(2031).year == tt.LATEST_YEAR
    assert tt.table_for(2019).year == min(tt.TABLES)


# ─── Depreciation, scenarios, opportunities ──────────────────────────────────

from app.services.schedule_e import depreciation_for_year  # noqa: E402
from app.services.tax_opportunities import build_opportunities  # noqa: E402
from app.services.tax_projection import apply_scenario, serialize  # noqa: E402


def test_mid_month_depreciation():
    assert depreciation_for_year(275_000, date(2020, 3, 1), 2020, 27.5) == pytest.approx(10_000 * 9.5 / 12)
    assert depreciation_for_year(275_000, date(2020, 3, 1), 2026, 27.5) == pytest.approx(10_000)
    assert depreciation_for_year(275_000, date(2020, 3, 1), 2019, 27.5) == 0
    # Fully recovered after 27.5 years
    assert depreciation_for_year(275_000, date(1990, 1, 1), 2026, 27.5) == 0


def test_scenario_401k_lowers_tax_and_leaves_base_untouched():
    base = TaxInputs(year=2026, filing_status="single", earners=[_w2(150_000)])
    changed = apply_scenario(base, {"extra_401k": 10_000})
    assert base.earners[0].wages == 150_000
    assert compute(base)["tax"]["total"] - compute(changed)["tax"]["total"] == pytest.approx(10_000 * 0.24 + 500, abs=1)


def test_s_corp_salary_cuts_self_employment_tax():
    base = TaxInputs(year=2026, filing_status="single", state="TX",
                     businesses=[Business(id="b", name="Biz", classification="schedule_c", net_profit=150_000,
                                          owner_user_id="u1")])
    s = apply_scenario(base, {"s_corp_salary": 60_000})
    r = compute(s)
    assert r["tax"]["self_employment"] == 0
    assert compute(base)["tax"]["total"] > r["tax"]["total"]


def test_opportunities_price_moves():
    inp = TaxInputs(year=2026, filing_status="mfj", state="TX", as_of=date(2026, 10, 22),
                    earners=[Earner(user_id="u1", name="A", wages=180_000, medicare_wages=180_000,
                                    ss_wages=180_000, federal_withheld=15_000, k401_traditional=5_000)],
                    businesses=[Business(id="b", name="Biz", classification="schedule_c", net_profit=90_000,
                                         owner_user_id="u1")])
    r = compute(inp)
    ctx = {"investments": {"tax_deferred_balance": 0.0, "unrealized_gain": 0.0,
                           "harvest": {"total_loss": "-4000.00", "candidates": []}},
           "businesses": [{"id": "b", "retirement_plan": None}], "rentals": []}
    ids = {o["id"]: o for o in build_opportunities(inp, r, ctx)}
    assert ids["401k:u1"]["est_savings"] > 0
    assert ids["tax_loss_harvest"]["est_savings"] > 0
    assert ids["retirement_plan:b"]["est_savings"] > 0
    # W-2 wages already near the SS wage base: an S-corp salary would add payroll tax, not save it
    assert "s_corp:b" not in ids
    assert "underpayment" in ids
    assert serialize({"x": -0.001, "marginal_rate": 0.24}) == {"x": "0.00", "marginal_rate": 0.24}


def test_s_corp_suggested_for_self_employed_without_wages():
    inp = TaxInputs(year=2026, filing_status="single", state="TX", as_of=date(2026, 10, 22),
                    businesses=[Business(id="b", name="Biz", classification="schedule_c", net_profit=150_000,
                                         owner_user_id="u1")])
    ctx = {"investments": {"tax_deferred_balance": 0.0, "unrealized_gain": 0.0,
                           "harvest": {"total_loss": "0.00", "candidates": []}},
           "businesses": [{"id": "b", "retirement_plan": "sep"}], "rentals": []}
    ids = {o["id"]: o for o in build_opportunities(inp, compute(inp), ctx)}
    assert ids["s_corp:b"]["est_savings"] > 2_000
