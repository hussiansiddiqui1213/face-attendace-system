"""Request models for the HTTP API."""

from typing import List, Literal

from pydantic import BaseModel, Field


class Login(BaseModel):
    password: str = Field(min_length=1, max_length=256)


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=12, max_length=256)


class Person(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    role: Literal["Student", "Faculty", "Office staff"]
    descriptor: List[float]
    center: str = Field(default="", max_length=120)
    group_name: str = Field(default="", max_length=120)
    consent_recorded: bool = False


class Scan(BaseModel):
    descriptor: List[float]


class ManualEntry(BaseModel):
    person_id: str = Field(min_length=1, max_length=64)
    date: str
    type: Literal["Present", "Check-in", "Check-out"]
    note: str = Field(min_length=3, max_length=500)


class RosterUpload(BaseModel):
    csv_text: str = Field(min_length=1, max_length=1_000_000)
