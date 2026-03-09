import hashlib


def hash_text(text: str) -> str:
    """Return first 16 hex chars of SHA-256 of text."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def hash_file(path: str) -> str:
    """Return first 16 hex chars of SHA-256 of file contents."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(65536), b""):
            h.update(block)
    return h.hexdigest()[:16]
