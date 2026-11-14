"""Download the official source files listed in pipeline/sources/<country>.json.

Files are stored unchanged under data/raw/<country>/<path>. A lock file records the
download time, size and SHA-256 of each file so every change is visible in git.
A file is only replaced when the download looks valid (right file type, not an
HTML error page), so a temporary outage never overwrites good data.

Usage: python pipeline/fetch.py sk
"""
import datetime as dt
import hashlib
import json
import pathlib
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
UA = "Mozilla/5.0 (compatible; budget-visualizer; +https://github.com/omasamo/Budgetvisualizer)"

MAGIC = {".xlsx": b"PK\x03\x04", ".xls": b"\xd0\xcf\x11\xe0", ".pdf": b"%PDF"}


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def main(country: str) -> int:
    manifest = json.loads((ROOT / "pipeline" / "sources" / f"{country}.json").read_text("utf-8"))
    raw_dir = ROOT / "data" / "raw" / country
    lock_path = raw_dir / "sources.lock.json"
    lock = json.loads(lock_path.read_text("utf-8")) if lock_path.exists() else {}
    failures = 0
    for src in manifest["sources"]:
        dest = raw_dir / src["path"]
        try:
            data = fetch(src["url"])
        except Exception as e:  # network or HTTP error: keep the old file
            print(f"FAIL {src['id']}: {e}")
            failures += 1
            continue
        magic = MAGIC.get(dest.suffix)
        if magic and not data.startswith(magic):
            print(f"FAIL {src['id']}: response is not a {dest.suffix} file (got {data[:20]!r})")
            failures += 1
            continue
        sha = hashlib.sha256(data).hexdigest()
        prev = lock.get(src["id"], {})
        if prev.get("sha256") == sha and dest.exists():
            print(f"same {src['id']}")
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        lock[src["id"]] = {
            "url": src["url"],
            "path": src["path"],
            "bytes": len(data),
            "sha256": sha,
            "downloaded": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        print(f"new  {src['id']} ({len(data)} bytes)")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path.write_text(json.dumps(lock, indent=2, ensure_ascii=False) + "\n", "utf-8")
    # Only fail the job if nothing usable exists for a source.
    missing = [s["id"] for s in manifest["sources"] if not (raw_dir / s["path"]).exists()]
    if missing:
        print("missing:", ", ".join(missing))
        return 1
    return 0 if failures == 0 else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "sk"))
