"""
Unit tests for inbox_parser — pure functions, no DB, no filesystem.

Run with:
    docker exec myfintech-api-1 bash -c \\
        "export PYTHONPATH=/app && cd /app && python -m pytest tests/services/test_inbox_parser.py -v"
"""
from pathlib import Path, PurePosixPath

import pytest

from app.services.inbox_parser import (
    FinancialImport,
    ParseError,
    PropertyImport,
    parse_inbox_path,
    slugify,
    match_property_slug,
)


# ── slugify ──────────────────────────────────────────────────────────────────

class TestSlugify:
    def test_basic_address(self):
        assert slugify("123 Main St") == "123-main-st"

    def test_full_address(self):
        assert slugify("456 Oak Avenue, Chicago IL 60601") == "456-oak-avenue-chicago-il-60601"

    def test_already_lowercase(self):
        assert slugify("my-house") == "my-house"

    def test_trailing_leading_spaces(self):
        assert slugify("  Main St  ") == "main-st"

    def test_special_chars_stripped(self):
        assert slugify("123 Main St. #2") == "123-main-st-2"

    def test_consecutive_hyphens_collapsed(self):
        assert slugify("123  Main   St") == "123-main-st"


# ── parse_inbox_path — financial ─────────────────────────────────────────────

class TestParseFinancial:
    def test_with_year(self):
        result = parse_inbox_path(PurePosixPath("financial/tax/2024/W2.pdf"))
        assert isinstance(result, FinancialImport)
        assert result.document_type == "tax"
        assert result.reference_year == 2024

    def test_without_year(self):
        result = parse_inbox_path(PurePosixPath("financial/insurance/policy.pdf"))
        assert isinstance(result, FinancialImport)
        assert result.document_type == "insurance"
        assert result.reference_year is None

    def test_investment_with_year(self):
        result = parse_inbox_path(PurePosixPath("financial/investment/2023/statement.pdf"))
        assert isinstance(result, FinancialImport)
        assert result.document_type == "investment"
        assert result.reference_year == 2023

    def test_retirement_no_year(self):
        result = parse_inbox_path(PurePosixPath("financial/retirement/401k.pdf"))
        assert isinstance(result, FinancialImport)
        assert result.reference_year is None

    def test_all_valid_types(self):
        types = ["tax", "investment", "retirement", "insurance", "banking", "income", "estate", "other"]
        for t in types:
            result = parse_inbox_path(PurePosixPath(f"financial/{t}/file.pdf"))
            assert isinstance(result, FinancialImport), f"Expected FinancialImport for type {t}"

    def test_unknown_type_returns_error(self):
        result = parse_inbox_path(PurePosixPath("financial/crypto/file.pdf"))
        assert isinstance(result, ParseError)
        assert "crypto" in result.reason

    def test_year_out_of_range_low(self):
        result = parse_inbox_path(PurePosixPath("financial/tax/1800/W2.pdf"))
        assert isinstance(result, ParseError)
        assert "1800" in result.reason

    def test_year_out_of_range_high(self):
        result = parse_inbox_path(PurePosixPath("financial/tax/2200/W2.pdf"))
        assert isinstance(result, ParseError)
        assert "2200" in result.reason

    def test_year_not_four_digits_treated_as_no_year(self):
        # "current" is not a 4-digit year → treated as no-year gracefully
        result = parse_inbox_path(PurePosixPath("financial/tax/current/W2.pdf"))
        assert isinstance(result, FinancialImport)
        assert result.reference_year is None

    def test_path_too_shallow_returns_error(self):
        result = parse_inbox_path(PurePosixPath("financial/W2.pdf"))
        assert isinstance(result, ParseError)

    def test_case_insensitive_type(self):
        result = parse_inbox_path(PurePosixPath("financial/TAX/2024/W2.pdf"))
        assert isinstance(result, FinancialImport)
        assert result.document_type == "tax"


# ── parse_inbox_path — properties ────────────────────────────────────────────

class TestParseProperty:
    def test_with_category(self):
        result = parse_inbox_path(PurePosixPath("properties/123-main-st/deed/sale.pdf"))
        assert isinstance(result, PropertyImport)
        assert result.property_slug == "123-main-st"
        assert result.category == "deed"

    def test_without_category_defaults_other(self):
        result = parse_inbox_path(PurePosixPath("properties/123-main-st/photo.jpg"))
        assert isinstance(result, PropertyImport)
        assert result.category == "other"

    def test_all_valid_categories(self):
        cats = ["deed", "insurance", "inspection", "permits", "photos", "maintenance", "legal", "other"]
        for cat in cats:
            result = parse_inbox_path(PurePosixPath(f"properties/my-house/{cat}/file.pdf"))
            assert isinstance(result, PropertyImport)
            assert result.category == cat

    def test_unknown_category_defaults_other(self):
        result = parse_inbox_path(PurePosixPath("properties/my-house/random-folder/file.pdf"))
        assert isinstance(result, PropertyImport)
        assert result.category == "other"

    def test_slug_preserved_as_is(self):
        result = parse_inbox_path(PurePosixPath("properties/456-oak-ave-chicago/deed/doc.pdf"))
        assert isinstance(result, PropertyImport)
        assert result.property_slug == "456-oak-ave-chicago"

    def test_path_too_shallow_returns_error(self):
        result = parse_inbox_path(PurePosixPath("properties/my-house"))
        assert isinstance(result, ParseError)


# ── parse_inbox_path — unknown root ──────────────────────────────────────────

class TestParseUnknownRoot:
    def test_unknown_root(self):
        result = parse_inbox_path(PurePosixPath("crypto/bitcoin/file.pdf"))
        assert isinstance(result, ParseError)
        assert "crypto" in result.reason.lower()

    def test_too_shallow(self):
        result = parse_inbox_path(PurePosixPath("file.pdf"))
        assert isinstance(result, ParseError)

    def test_system_folders_produce_error(self):
        # System folders start with _ and should never be passed to the parser,
        # but if they are, the parser returns an error
        result = parse_inbox_path(PurePosixPath("_processed/2024-01-01/file.pdf"))
        assert isinstance(result, ParseError)


# ── match_property_slug ───────────────────────────────────────────────────────

class TestMatchPropertySlug:
    class _FakeProp:
        def __init__(self, address: str):
            self.address = address

    def test_exact_slug_match(self):
        props = [self._FakeProp("123 Main St"), self._FakeProp("456 Oak Ave")]
        result = match_property_slug("123-main-st", props)
        assert result is not None
        assert result.address == "123 Main St"

    def test_no_match_returns_none(self):
        props = [self._FakeProp("123 Main St")]
        result = match_property_slug("999-unknown", props)
        assert result is None

    def test_case_insensitive_folder_name(self):
        props = [self._FakeProp("123 Main St")]
        result = match_property_slug("123-MAIN-ST", props)
        # slugify lowercases the folder name
        assert result is not None

    def test_empty_properties_list(self):
        assert match_property_slug("any-slug", []) is None
