"""Turn the official MF SR spreadsheets into the small JSON files the website reads.

Inputs  (data/raw/sk/, downloaded by fetch.py, never edited):
  plnenie-narodna/*.xlsx   monthly cumulative state budget execution, 2008 onwards
  szu/szu-<year>.xlsx      state final account tables (chapters, functions)

Outputs (data/processed/sk/):
  monthly.json   per year: budget and cumulative actual by month, total and by type
  annual.json    per year: chapters and functions with approved, adjusted, actual
  meta.json      what is available, as-of dates, sources

All money values are written in whole euros. Missing values are null, never 0.

Usage: python pipeline/parse_sk.py
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib
import re
import sys
import unicodedata

import openpyxl

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "sk"
OUT = ROOT / "data" / "processed" / "sk"

MONTHS_SK = ["január", "február", "marec", "apríl", "máj", "jún", "júl", "august",
             "september", "október", "november", "december"]


def norm(s) -> str:
    """Lowercase, strip accents and collapse whitespace for robust label matching."""
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s).strip().lower()


def clean(s) -> str:
    return re.sub(r"\s+", " ", str(s).replace("\xa0", " ")).strip()


def eur_from_mil(v):
    return None if v is None else round(float(v) * 1_000_000)


def eur_from_thousands(v):
    return None if v is None else round(float(v) * 1_000)


# ---------------------------------------------------------------------------
# Monthly execution (Plnenie štátneho rozpočtu SR v národnej metodike)
# ---------------------------------------------------------------------------

# key -> regex on the normalised label. Order matters only for readability.
EXPENDITURE_ROWS = {
    "total": r"^celkove vydavky",
    "wages": r"^1\. mzdy",
    "insurance": r"^2\. poistne",
    "goods": r"^3\. tovary a sluzby",
    "transfers": r"^4\. bezne transfery",
    "interest": r"^5\. uroky",
    "capital": r"^b\. kapitalove vydavky",
}
REVENUE_ROWS = {
    "total": r"^celkove prijmy",
    "tax": r"^a\. danove prijmy",
    "vat": r"^- dan z pridanej hodnoty",
    "corporate": r"^- dan z prijmov pravnickych osob",
    "personal": r"^- dan z prijmov fyzickych osob",
    "excise": r"^- spotrebne dane",
    "nontax": r"^b\. nedanove prijmy",
    "grants": r"^c\. granty a transfery",
    "eu": r"^3\. zahranicne transfery - z eu",
}


def parse_block(rows, start, patterns):
    """Read rows after a section header until the next blank-title section."""
    found = {}
    for r in rows[start:]:
        label = r[0]
        if label is None:
            continue
        n = norm(label)
        if n.startswith("plnenie statneho rozpoctu") and found:
            break
        for key, pat in patterns.items():
            if key not in found and re.search(pat, n):
                budget = r[1] if isinstance(r[1], (int, float)) else None
                months = [v if isinstance(v, (int, float)) else None for v in r[2:14]]
                months += [None] * (12 - len(months))
                found[key] = {
                    "budget": eur_from_mil(budget),
                    "cumulative": [eur_from_mil(v) for v in months],
                }
    return found


def parse_monthly():
    path = RAW / "plnenie-narodna" / "plnenie-statneho-rozpoctu-sr-v-narodnej-metodike.xlsx"
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    years = {}
    for ws in wb.worksheets:
        if not re.fullmatch(r"\d{4}", ws.title.strip()):
            continue
        year = int(ws.title)
        rows = list(ws.iter_rows(values_only=True))
        idx_rev = next(i for i, r in enumerate(rows) if r[0] and norm(r[0]) == "prijmy")
        idx_exp = next(i for i, r in enumerate(rows) if r[0] and norm(r[0]) == "vydavky")
        rev = parse_block(rows, idx_rev, REVENUE_ROWS)
        exp = parse_block(rows, idx_exp, EXPENDITURE_ROWS)
        if "total" not in exp:
            raise ValueError(f"{year}: total expenditure row not found")
        cum = exp["total"]["cumulative"]
        last = max((i for i, v in enumerate(cum) if v is not None), default=-1)
        years[str(year)] = {
            "lastMonth": last + 1,  # 1..12, 0 if nothing published yet
            "expenditure": exp,
            "revenue": rev,
        }
    return years


# ---------------------------------------------------------------------------
# State final account (ŠZÚ) tables
# ---------------------------------------------------------------------------

def find_sheet(wb, title_pattern):
    for ws in wb.worksheets:
        for i, r in enumerate(ws.iter_rows(values_only=True)):
            if i > 6:
                break
            if any(isinstance(c, str) and re.search(title_pattern, norm(c)) for c in r):
                return ws
    return None


def parse_chapters(wb, year):
    """'Prehľad vzťahu jednotlivých kapitol ŠR k štátnemu rozpočtu': per chapter
    approved / adjusted / actual for revenue, expenditure and balance (thousand EUR)."""
    ws = find_sheet(wb, r"prehlad vztahu jednotlivych kapitol")
    if ws is None:
        raise ValueError(f"{year}: chapter overview table not found")
    rows = list(ws.iter_rows(values_only=True))
    chapters, total = [], None
    for r in rows:
        cells = list(r)
        # Locate the chapter code: a 4-digit number starting with 21.
        code_idx = next((i for i, c in enumerate(cells[:3])
                         if c is not None and re.fullmatch(r"21\d\d", str(c).strip())), None)
        name = cells[0]
        if name is None:
            continue
        nums_from = (code_idx + 1) if code_idx is not None else 1
        nums = [c for c in cells[nums_from:] if c is not None and not isinstance(c, str)]
        is_total = norm(name).replace(" ", "") == "spolu"
        if code_idx is None and not is_total:
            continue
        if len(nums) < 9:
            continue
        # Column order: approved (rev, exp, bal), adjusted (rev, exp, bal), actual (rev, exp, bal)
        rec = {
            "approved": eur_from_thousands(nums[1]),
            "adjusted": eur_from_thousands(nums[4]),
            "actual": eur_from_thousands(nums[7]),
            "revenue": {
                "approved": eur_from_thousands(nums[0]),
                "adjusted": eur_from_thousands(nums[3]),
                "actual": eur_from_thousands(nums[6]),
            },
        }
        if is_total:
            total = rec
        else:
            rec = {"code": str(cells[code_idx]).strip(), "name": clean(name), **rec}
            chapters.append(rec)
    if total is None:
        raise ValueError(f"{year}: chapter total row not found")
    return chapters, total


FUNCTION_TOP = re.compile(r"^(0\d|10) ")


def parse_functions(wb, year):
    """'Výdavky štátneho rozpočtu podľa funkčnej klasifikácie': top-level COFOG
    divisions 01..10, total expenditure columns (approved, adjusted, actual)."""
    ws = find_sheet(wb, r"vydavky statneho rozpoctu podla funkcnej klasifikacie")
    if ws is None:
        raise ValueError(f"{year}: functional classification table not found")
    rows = list(ws.iter_rows(values_only=True))
    out, total = [], None
    for r in rows:
        cells = [c for c in r if c is not None]
        if not cells or not isinstance(cells[0], str):
            continue
        label = clean(cells[0])
        nums = [c for c in cells[1:] if isinstance(c, (int, float))]
        if len(nums) < 11:
            continue
        # Columns: current (appr, adj, act, %), capital (appr, adj, act, %), total (appr, adj, act, %)
        rec = {"approved": eur_from_thousands(nums[8]), "adjusted": eur_from_thousands(nums[9]),
               "actual": eur_from_thousands(nums[10])}
        if norm(label).replace(" ", "") == "spolu":
            total = rec
            continue
        m = re.match(r"^(\d{2})\s+(.*)$", label)
        if m and FUNCTION_TOP.match(label):
            out.append({"code": m.group(1), "name": m.group(2).strip().capitalize(), **rec})
    return out, total


def parse_annual():
    years = {}
    for path in sorted((RAW / "szu").glob("szu-*.xlsx")):
        year = int(re.search(r"(\d{4})", path.name).group(1))
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        chapters, ch_total = parse_chapters(wb, year)
        functions, fn_total = parse_functions(wb, year)
        years[str(year)] = {
            "source": f"szu-{year}",
            "total": ch_total,
            "chapters": chapters,
            "functions": functions,
            "functionsTotal": fn_total,
        }
    return years


# ---------------------------------------------------------------------------
# Validation: refuse to publish numbers that do not add up.
# ---------------------------------------------------------------------------

def validate(monthly, annual):
    problems = []
    for y, d in annual.items():
        for kind in ("approved", "adjusted", "actual"):
            s = sum(c[kind] or 0 for c in d["chapters"])
            t = d["total"][kind]
            if t and abs(s - t) > 5_000 * len(d["chapters"]):  # rounding in thousands
                problems.append(f"{y} chapters {kind}: sum {s} != total {t}")
            fs = sum(f[kind] or 0 for f in d["functions"])
            ft = d["functionsTotal"][kind] if d["functionsTotal"] else None
            if ft and abs(fs - ft) > 5_000 * 10:
                problems.append(f"{y} functions {kind}: sum {fs} != total {ft}")
        # The final account and the monthly series should agree on the annual actual.
        m = monthly.get(y)
        if m and m["lastMonth"] == 12:
            dec = m["expenditure"]["total"]["cumulative"][11]
            act = d["total"]["actual"]
            if abs(dec - act) > 0.001 * act:
                problems.append(f"{y}: monthly December {dec} vs final account {act}")
    for y, d in monthly.items():
        cum = [v for v in d["expenditure"]["total"]["cumulative"] if v is not None]
        if any(b < a * 0.98 for a, b in zip(cum, cum[1:])):
            problems.append(f"{y}: cumulative expenditure decreases")
    return problems


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((ROOT / "pipeline" / "sources" / "sk.json").read_text("utf-8"))
    lock = json.loads((RAW / "sources.lock.json").read_text("utf-8"))

    monthly = parse_monthly()
    annual = parse_annual()
    problems = validate(monthly, annual)
    if problems:
        print("VALIDATION FAILED:\n  " + "\n  ".join(problems))
        return 1

    current = max(int(y) for y in monthly)
    last_month = monthly[str(current)]["lastMonth"]
    as_of = None
    if last_month:
        nxt = dt.date(current + (last_month == 12), last_month % 12 + 1, 1)
        as_of = (nxt - dt.timedelta(days=1)).isoformat()

    sources = []
    for s in manifest["sources"]:
        sources.append({
            "id": s["id"], "title": s["title"], "titleEn": s["titleEn"], "page": s["page"],
            "url": s["url"], "downloaded": lock.get(s["id"], {}).get("downloaded"),
        })

    meta = {
        "country": "sk",
        "currency": "EUR",
        "publisher": manifest["publisher"],
        "licence": manifest["licence"],
        "licenceUrl": manifest["licenceUrl"],
        "currentYear": current,
        "currentLastMonth": last_month,
        "asOf": as_of,
        "monthlyYears": sorted(int(y) for y in monthly),
        "annualYears": sorted(int(y) for y in annual),
        "population": None,  # added once an official ŠÚ SR figure is in data/raw
        "sources": sources,
        "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    def write(name, obj):
        (OUT / name).write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n", "utf-8")

    write("monthly.json", {"unit": "EUR", "source": "plnenie-narodna", "years": monthly})
    write("annual.json", {"unit": "EUR", "years": annual})
    (OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print(f"ok: monthly {meta['monthlyYears'][0]}-{current} (to month {last_month}), "
          f"annual {meta['annualYears']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
