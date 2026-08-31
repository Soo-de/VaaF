"""
models.py — Pydantic request/response modals
"""
import re
from pydantic import BaseModel, Field, field_validator

_NAME_RE = re.compile(r"^[a-z][a-z0-9-]{2,49}$")
_ENV_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class DeployRequest(BaseModel):
    name: str = Field(..., min_length=3, max_length=50)
    language: str = Field(default="python")
    code: str = Field(..., min_length=5)
    is_update: bool = False
    environment: dict[str, str] = Field(default_factory=dict)

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        if not _NAME_RE.match(v):
            raise ValueError("Fonksiyon adı küçük harfle başlamalı; sadece küçük harf, rakam ve tire içermelidir.")
        return v

    @field_validator("environment")
    @classmethod
    def validate_environment(cls, v: dict[str, str]) -> dict[str, str]:
        for key in v.keys():
            if not _ENV_KEY_RE.match(key):
                raise ValueError(f"Geçersiz ortam değişkeni adı: '{key}'. Yalnızca harf, rakam ve alt çizgi içerebilir.")
        return v


class ProxyRequest(BaseModel):
    url: str
    method: str = "POST"
    headers: dict[str, str] = Field(default_factory=dict)
    body: dict = Field(default_factory=dict)


class DeleteResponse(BaseModel):
    message: str
    function_name: str
