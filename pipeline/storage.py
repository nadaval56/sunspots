"""Storage abstraction (BRIEF §3): `local` writes to ./media-local, `r2` uses R2's S3 API."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Protocol

from . import config


class Storage(Protocol):
    def put(self, key: str, data: bytes, content_type: str, cache_control: str | None = None) -> None: ...
    def get(self, key: str) -> bytes | None: ...
    def list(self, prefix: str) -> list[str]: ...
    def delete(self, key: str) -> None: ...


class LocalStorage:
    def __init__(self, root: Path | str | None = None):
        self.root = Path(root or config.LOCAL_MEDIA_DIR)
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if self.root.resolve() not in p.parents and p != self.root.resolve():
            raise ValueError(f"key escapes storage root: {key}")
        return p

    def put(self, key, data, content_type, cache_control=None):
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def get(self, key):
        p = self._path(key)
        return p.read_bytes() if p.exists() else None

    def list(self, prefix):
        base = self.root
        out = []
        for p in base.rglob("*"):
            if p.is_file():
                k = p.relative_to(base).as_posix()
                if k.startswith(prefix):
                    out.append(k)
        return sorted(out)

    def delete(self, key):
        p = self._path(key)
        if p.exists():
            p.unlink()


class R2Storage:
    def __init__(self):
        import boto3  # imported lazily so local mode needs no credentials

        if not (config.R2_ACCOUNT_ID and config.R2_ACCESS_KEY_ID and config.R2_SECRET_ACCESS_KEY):
            raise RuntimeError("R2 credentials missing; set STORAGE=local or add secrets (docs/HUMAN_TODO.md)")
        self.bucket = config.R2_BUCKET
        self.s3 = boto3.client(
            "s3",
            endpoint_url=f"https://{config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
            aws_access_key_id=config.R2_ACCESS_KEY_ID,
            aws_secret_access_key=config.R2_SECRET_ACCESS_KEY,
            region_name="auto",
        )

    def put(self, key, data, content_type, cache_control=None):
        extra = {"ContentType": content_type}
        if cache_control:
            extra["CacheControl"] = cache_control
        self.s3.put_object(Bucket=self.bucket, Key=key, Body=data, **extra)

    def get(self, key):
        try:
            return self.s3.get_object(Bucket=self.bucket, Key=key)["Body"].read()
        except self.s3.exceptions.NoSuchKey:
            return None

    def list(self, prefix):
        keys = []
        for page in self.s3.get_paginator("list_objects_v2").paginate(Bucket=self.bucket, Prefix=prefix):
            keys.extend(o["Key"] for o in page.get("Contents", []))
        return sorted(keys)

    def delete(self, key):
        self.s3.delete_object(Bucket=self.bucket, Key=key)


def get_storage() -> Storage:
    if config.STORAGE == "r2":
        return R2Storage()
    return LocalStorage()


def put_json(storage: Storage, key: str, obj, cache_control: str = "max-age=300") -> None:
    data = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode()
    storage.put(key, data, "application/json; charset=utf-8", cache_control)


def get_json(storage: Storage, key: str, default=None):
    raw = storage.get(key)
    return json.loads(raw) if raw else default
