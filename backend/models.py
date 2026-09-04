"""
models.py — Pydantic request/response models
"""

import os
import re
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from config import SUPPORTED_LANGUAGES

_NAME_RE = re.compile(r"^[a-z][a-z0-9-]{2,49}$")
_ENV_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_FILE_SEGMENT_RE = re.compile(r"^[a-zA-Z0-9_.-]+$")

ALLOWED_EXTENSIONS = {
    ".py", ".json", ".yaml", ".yml", ".txt",
    ".sql", ".env", ".md", ".csv", ".ini", ".xml",
}
MAX_FILES = 20
MAX_FILE_SIZE_BYTES = 100 * 1024
MAX_TOTAL_SIZE_BYTES = 800 * 1024


def validate_file_path(path: str) -> None:
    """Validate a single file path for security and naming compliance."""
    if not path or not path.strip():
        raise ValueError("File path cannot be empty.")

    if path.startswith("/"):
        raise ValueError(f"Absolute paths are not allowed: '{path}'")

    if ".." in path:
        raise ValueError(f"Path traversal ('..') is not allowed: '{path}'")

    segments = path.split("/")
    for segment in segments:
        if not segment or segment in (".", ".."):
            raise ValueError(f"Path contains invalid segment: '{path}'")
        if not _FILE_SEGMENT_RE.match(segment):
            raise ValueError(
                f"Invalid characters in path segment '{segment}'. "
                f"Only [a-zA-Z0-9_.-] are allowed."
            )

    filename = segments[-1]
    if filename.startswith(".") and filename.count(".") == 1:
        ext = filename
    else:
        _, ext = os.path.splitext(filename)

    if not ext:
        raise ValueError(f"File must have an extension: '{path}'")
    if ext.lower() not in ALLOWED_EXTENSIONS:
        allowed = ", ".join(sorted(ALLOWED_EXTENSIONS))
        raise ValueError(f"Unsupported extension '{ext}'. Allowed: {allowed}")


def to_cm_key(path: str) -> str:
    """Convert file path to ConfigMap-safe key. 'utils/db.py' → 'utils__db.py'"""
    return path.replace("/", "__")


def to_file_path(key: str) -> str:
    """Convert ConfigMap key back to file path. 'utils__db.py' → 'utils/db.py'"""
    return key.replace("__", "/")


# Aliases for backward compatibility
path_to_configmap_key = to_cm_key
configmap_key_to_path = to_file_path


class DeployRequest(BaseModel):
    name: str = Field(..., min_length=3, max_length=50)
    language: str = Field(default="python")
    code: Optional[str] = Field(default=None, min_length=5)
    files: dict[str, str] = Field(default_factory=dict)
    is_update: bool = False
    environment: dict[str, str] = Field(default_factory=dict)

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        if not _NAME_RE.match(v):
            raise ValueError("Fonksiyon adı küçük harfle başlamalı; sadece küçük harf, rakam ve tire içermelidir.")
        return v

    @field_validator("language")
    @classmethod
    def validate_language(cls, v: str) -> str:
        if v not in SUPPORTED_LANGUAGES:
            supported = ", ".join(SUPPORTED_LANGUAGES)
            raise ValueError(f"Desteklenmeyen dil: '{v}'. Desteklenen diller: {supported}")
        return v

    @field_validator("environment")
    @classmethod
    def validate_environment(cls, v: dict[str, str]) -> dict[str, str]:
        for key in v.keys():
            if not _ENV_KEY_RE.match(key):
                raise ValueError(f"Geçersiz ortam değişkeni adı: '{key}'. Yalnızca harf, rakam ve alt çizgi içerebilir.")
        return v

    @model_validator(mode="after")
    def normalize_and_validate_files(self) -> "DeployRequest":
        """Backward-compatible normalization: single `code` → multi-file `files` dict."""
        if not self.files and self.code:
            self.files = {"handler.py": self.code}

        if not self.files:
            raise ValueError("At least one file (handler.py) is required.")

        if "handler.py" not in self.files:
            raise ValueError("Root-level 'handler.py' entry point is required.")

        if not self.files["handler.py"].strip():
            raise ValueError("Root-level 'handler.py' cannot be empty.")

        # Keep `code` in sync for backward compat
        self.code = self.files["handler.py"]

        if len(self.files) > MAX_FILES:
            raise ValueError(f"Maximum {MAX_FILES} files allowed per function.")

        total_bytes = 0
        for path, content in self.files.items():
            validate_file_path(path)
            file_bytes = len(content.encode("utf-8"))
            if file_bytes > MAX_FILE_SIZE_BYTES:
                raise ValueError(
                    f"File '{path}' ({file_bytes // 1024}KB) exceeds "
                    f"the {MAX_FILE_SIZE_BYTES // 1024}KB per-file limit."
                )
            total_bytes += file_bytes

        if total_bytes > MAX_TOTAL_SIZE_BYTES:
            raise ValueError(
                f"Total project size ({total_bytes // 1024}KB) exceeds "
                f"the {MAX_TOTAL_SIZE_BYTES // 1024}KB limit."
            )

        return self


class ProxyRequest(BaseModel):
    url: str
    method: str = "POST"
    headers: dict[str, str] = Field(default_factory=dict)
    body: dict = Field(default_factory=dict)


class DeleteResponse(BaseModel):
    message: str
    function_name: str
