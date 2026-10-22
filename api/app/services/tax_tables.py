"""US federal tax constants by year, and the bracket math that uses them.

Figures are the IRS inflation adjustments (Rev. Proc. 2024-40 for 2025,
Rev. Proc. 2025-32 for 2026) with the One Big Beautiful Bill Act changes:
the higher standard deduction, the $40k SALT cap with its phase-down above
$500k MAGI, the $6,000 senior deduction (2025-2028), the $2,200 child tax
credit and, from 2026, the charitable deduction for non-itemizers.

A year missing from TABLES uses the latest one. Planning numbers, not filing
numbers: check a figure against the IRS before relying on it near a threshold.
"""

from dataclasses import dataclass, field

FILING_STATUSES = ("single", "mfj", "mfs", "hoh")

_INF = float("inf")


@dataclass(frozen=True)
class TaxYear:
    year: int
    # (upper bound, rate) per filing status; the last bound is infinity
    brackets: dict[str, list[tuple[float, float]]]
    standard_deduction: dict[str, float]
    # Extra standard deduction per person 65+ (or blind)
    additional_65: dict[str, float]
    # Top of the 0% and 15% long-term capital gain bands (taxable income)
    ltcg_0: dict[str, float]
    ltcg_15: dict[str, float]
    ss_wage_base: float
    salt_cap: dict[str, float]
    salt_phaseout_start: dict[str, float]
    salt_floor: dict[str, float]
    senior_deduction: float          # per person 65+
    senior_phaseout_start: dict[str, float]
    child_credit: float              # per qualifying child under 17
    other_dependent_credit: float
    qbi_threshold: dict[str, float]
    qbi_phase_in: dict[str, float]
    limit_401k: float
    catchup_401k: float              # age 50+
    catchup_401k_60_63: float
    limit_ira: float
    catchup_ira: float
    limit_hsa_self: float
    limit_hsa_family: float
    catchup_hsa: float               # age 55+
    limit_sep: float                 # total defined-contribution limit (SEP, solo 401(k))
    roth_ira_phaseout: dict[str, tuple[float, float]]
    # Cash gifts deductible without itemizing (OBBBA, from 2026)
    nonitemizer_charity: dict[str, float] = field(default_factory=dict)


# Not inflation-indexed
NIIT_RATE = 0.038
NIIT_THRESHOLD = {"single": 200_000.0, "hoh": 200_000.0, "mfj": 250_000.0, "mfs": 125_000.0}
ADDL_MEDICARE_RATE = 0.009
ADDL_MEDICARE_THRESHOLD = NIIT_THRESHOLD
SS_RATE = 0.124
MEDICARE_RATE = 0.029
SE_EARNINGS_FACTOR = 0.9235
CAPITAL_LOSS_LIMIT = {"single": 3_000.0, "hoh": 3_000.0, "mfj": 3_000.0, "mfs": 1_500.0}
MEDICAL_AGI_FLOOR = 0.075
MORTGAGE_DEBT_LIMIT = 750_000.0
PASSIVE_ALLOWANCE = 25_000.0
PASSIVE_PHASEOUT_START = 100_000.0
PASSIVE_PHASEOUT_END = 150_000.0
SENIOR_PHASEOUT_RATE = 0.06
CHILD_CREDIT_PHASEOUT = {"single": 200_000.0, "hoh": 200_000.0, "mfs": 200_000.0, "mfj": 400_000.0}
QBI_RATE = 0.20
RESIDENTIAL_RECOVERY_YEARS = 27.5
COMMERCIAL_RECOVERY_YEARS = 39.0
HOME_OFFICE_RATE = 5.0               # simplified method, $ per sq ft
HOME_OFFICE_MAX_SQFT = 300
SAFE_HARBOR_HIGH_AGI = {"single": 150_000.0, "hoh": 150_000.0, "mfj": 150_000.0, "mfs": 75_000.0}


def _b(*caps_and_rates: tuple[float, float]) -> list[tuple[float, float]]:
    return list(caps_and_rates)


TABLES: dict[int, TaxYear] = {
    2025: TaxYear(
        year=2025,
        brackets={
            "single": _b((11_925, .10), (48_475, .12), (103_350, .22), (197_300, .24), (250_525, .32), (626_350, .35), (_INF, .37)),
            "mfj":    _b((23_850, .10), (96_950, .12), (206_700, .22), (394_600, .24), (501_050, .32), (751_600, .35), (_INF, .37)),
            "mfs":    _b((11_925, .10), (48_475, .12), (103_350, .22), (197_300, .24), (250_525, .32), (375_800, .35), (_INF, .37)),
            "hoh":    _b((17_000, .10), (64_850, .12), (103_350, .22), (197_300, .24), (250_500, .32), (626_350, .35), (_INF, .37)),
        },
        standard_deduction={"single": 15_750, "mfj": 31_500, "mfs": 15_750, "hoh": 23_625},
        additional_65={"single": 2_000, "hoh": 2_000, "mfj": 1_600, "mfs": 1_600},
        ltcg_0={"single": 48_350, "mfj": 96_700, "mfs": 48_350, "hoh": 64_750},
        ltcg_15={"single": 533_400, "mfj": 600_050, "mfs": 300_000, "hoh": 566_700},
        ss_wage_base=176_100,
        salt_cap={"single": 40_000, "mfj": 40_000, "hoh": 40_000, "mfs": 20_000},
        salt_phaseout_start={"single": 500_000, "mfj": 500_000, "hoh": 500_000, "mfs": 250_000},
        salt_floor={"single": 10_000, "mfj": 10_000, "hoh": 10_000, "mfs": 5_000},
        senior_deduction=6_000,
        senior_phaseout_start={"single": 75_000, "hoh": 75_000, "mfs": 75_000, "mfj": 150_000},
        child_credit=2_200,
        other_dependent_credit=500,
        qbi_threshold={"single": 197_300, "hoh": 197_300, "mfs": 197_300, "mfj": 394_600},
        qbi_phase_in={"single": 50_000, "hoh": 50_000, "mfs": 50_000, "mfj": 100_000},
        limit_401k=23_500, catchup_401k=7_500, catchup_401k_60_63=11_250,
        limit_ira=7_000, catchup_ira=1_000,
        limit_hsa_self=4_300, limit_hsa_family=8_550, catchup_hsa=1_000,
        limit_sep=70_000,
        roth_ira_phaseout={"single": (150_000, 165_000), "hoh": (150_000, 165_000), "mfj": (236_000, 246_000), "mfs": (0, 10_000)},
    ),
    2026: TaxYear(
        year=2026,
        brackets={
            "single": _b((12_400, .10), (50_400, .12), (105_700, .22), (201_775, .24), (256_225, .32), (640_600, .35), (_INF, .37)),
            "mfj":    _b((24_800, .10), (100_800, .12), (211_400, .22), (403_550, .24), (512_450, .32), (768_700, .35), (_INF, .37)),
            "mfs":    _b((12_400, .10), (50_400, .12), (105_700, .22), (201_775, .24), (256_225, .32), (384_350, .35), (_INF, .37)),
            "hoh":    _b((17_700, .10), (67_450, .12), (105_700, .22), (201_750, .24), (256_200, .32), (640_600, .35), (_INF, .37)),
        },
        standard_deduction={"single": 16_100, "mfj": 32_200, "mfs": 16_100, "hoh": 24_150},
        additional_65={"single": 2_050, "hoh": 2_050, "mfj": 1_650, "mfs": 1_650},
        ltcg_0={"single": 49_450, "mfj": 98_900, "mfs": 49_450, "hoh": 66_200},
        ltcg_15={"single": 545_500, "mfj": 613_700, "mfs": 306_850, "hoh": 579_600},
        ss_wage_base=184_500,
        salt_cap={"single": 40_400, "mfj": 40_400, "hoh": 40_400, "mfs": 20_200},
        salt_phaseout_start={"single": 505_000, "mfj": 505_000, "hoh": 505_000, "mfs": 252_500},
        salt_floor={"single": 10_000, "mfj": 10_000, "hoh": 10_000, "mfs": 5_000},
        senior_deduction=6_000,
        senior_phaseout_start={"single": 75_000, "hoh": 75_000, "mfs": 75_000, "mfj": 150_000},
        child_credit=2_200,
        other_dependent_credit=500,
        qbi_threshold={"single": 201_750, "hoh": 201_750, "mfs": 201_750, "mfj": 403_500},
        qbi_phase_in={"single": 75_000, "hoh": 75_000, "mfs": 75_000, "mfj": 150_000},
        limit_401k=24_500, catchup_401k=8_000, catchup_401k_60_63=11_250,
        limit_ira=7_500, catchup_ira=1_100,
        limit_hsa_self=4_400, limit_hsa_family=8_750, catchup_hsa=1_000,
        limit_sep=72_000,
        roth_ira_phaseout={"single": (153_000, 168_000), "hoh": (153_000, 168_000), "mfj": (242_000, 252_000), "mfs": (0, 10_000)},
        nonitemizer_charity={"single": 1_000, "hoh": 1_000, "mfs": 1_000, "mfj": 2_000},
    ),
}

LATEST_YEAR = max(TABLES)


def table_for(year: int) -> TaxYear:
    if year in TABLES:
        return TABLES[year]
    return TABLES[LATEST_YEAR] if year > LATEST_YEAR else TABLES[min(TABLES)]


# Top marginal (or flat) state income tax rate. A rough planning figure:
# progressive states tax most income below their top rate.
STATE_TAX_RATES: dict[str, float] = {
    "AL": 0.050, "AK": 0.000, "AZ": 0.025, "AR": 0.047, "CA": 0.093,
    "CO": 0.044, "CT": 0.065, "DE": 0.066, "FL": 0.000, "GA": 0.055,
    "HI": 0.110, "ID": 0.058, "IL": 0.0495, "IN": 0.0305, "IA": 0.060,
    "KS": 0.057, "KY": 0.045, "LA": 0.042, "ME": 0.075, "MD": 0.0575,
    "MA": 0.050, "MI": 0.0425, "MN": 0.0985, "MS": 0.047, "MO": 0.048,
    "MT": 0.069, "NE": 0.0684, "NV": 0.000, "NH": 0.000, "NJ": 0.1075,
    "NM": 0.059, "NY": 0.0685, "NC": 0.045, "ND": 0.025, "OH": 0.035,
    "OK": 0.0475, "OR": 0.099, "PA": 0.0307, "RI": 0.0599, "SC": 0.065,
    "SD": 0.000, "TN": 0.000, "TX": 0.000, "UT": 0.0485, "VT": 0.0875,
    "VA": 0.0575, "WA": 0.000, "WV": 0.065, "WI": 0.0765, "WY": 0.000,
    "DC": 0.0895,
}
STATE_TAX_RATE_DEFAULT = 0.05


# ─── Bracket math ────────────────────────────────────────────────────────────

def bracket_tax(taxable: float, brackets: list[tuple[float, float]]) -> float:
    tax, prev = 0.0, 0.0
    income = max(0.0, taxable)
    for cap, rate in brackets:
        if income <= prev:
            break
        tax += (min(income, cap) - prev) * rate
        prev = cap
    return tax


def bracket_position(taxable: float, brackets: list[tuple[float, float]]) -> dict:
    """The bracket taxable income falls in and how much more fits in it."""
    prev = 0.0
    income = max(0.0, taxable)
    for i, (cap, rate) in enumerate(brackets):
        if income < cap or cap == _INF:
            nxt = brackets[i + 1][1] if i + 1 < len(brackets) else None
            return {
                "rate": rate,
                "floor": prev,
                "ceiling": None if cap == _INF else cap,
                "room": None if cap == _INF else cap - income,
                "next_rate": nxt,
            }
        prev = cap
    return {"rate": brackets[-1][1], "floor": prev, "ceiling": None, "room": None, "next_rate": None}


def preferential_tax(ordinary_taxable: float, pref_income: float, t: TaxYear, status: str) -> float:
    """Tax on qualified dividends + net long-term gains stacked on top of ordinary income."""
    if pref_income <= 0:
        return 0.0
    start = max(0.0, ordinary_taxable)
    end = start + pref_income
    zero_top, fifteen_top = t.ltcg_0[status], t.ltcg_15[status]
    at_0 = max(0.0, min(end, zero_top) - start)
    at_15 = max(0.0, min(end, fifteen_top) - max(start, zero_top))
    at_20 = max(0.0, end - max(start, fifteen_top))
    return at_15 * 0.15 + at_20 * 0.20
