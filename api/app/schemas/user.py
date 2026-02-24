import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator


def _validate_password(v: str) -> str:
    errors = []
    if len(v) < 12:
        errors.append("at least 12 characters")
    if not any(c.isupper() for c in v):
        errors.append("one uppercase letter")
    if not any(c.islower() for c in v):
        errors.append("one lowercase letter")
    if not any(c.isdigit() for c in v):
        errors.append("one digit")
    if not any(c in "!@#$%^&*()_+-=[]{}|;':\",./<>?" for c in v):
        errors.append("one special character")
    if errors:
        raise ValueError("Password must contain: " + ", ".join(errors))
    return v


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12)
    full_name: str
    household_name: str | None = None  # if creating new household

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return _validate_password(v)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    role: str
    household_id: uuid.UUID
    is_active: bool
    phone: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    city: str | None = None
    state: str | None = None
    zip_code: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class UserProfileUpdate(BaseModel):
    full_name: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    city: str | None = None
    state: str | None = None
    zip_code: str | None = None


class UserPasswordChange(BaseModel):
    current_password: str
    new_password: str



class HouseholdResponse(BaseModel):
    id: uuid.UUID
    name: str
    created_at: datetime

    model_config = {"from_attributes": True}


class HouseholdMemberCreate(BaseModel):
    full_name: str
    email: EmailStr
    password: str = Field(min_length=12)
    role: str = "member"  # owner | member

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return _validate_password(v)


class HouseholdMemberUpdate(BaseModel):
    full_name: str | None = None
    email: EmailStr | None = None
    role: str | None = None
