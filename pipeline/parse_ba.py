"""Convert the Bratislava city budget downloaded from rozpocet.sk (data/raw/ba/ris/)
into the JSON files the site reads (data/processed/ba/), in the same shape as the
state budget files, so the same page can show both.

What differs from the state budget, because the source differs:
  * cities report every quarter, so the "monthly" series has values for March, June,
    September and December only (null = not published, never zero);
  * the main breakdown is by purpose (functional classification): a city has no chapters;
  * organisations of the city (the city office, schools, homes for seniors, the zoo…)
    are a second breakdown. Their figures are each organisation's own budget and do not
    add up to the city total, so they are never summed.

The script refuses to publish data that does not add up: the breakdown by kind must sum
to the reported total, the breakdown by purpose plus financial operations must sum to it
too, and so must revenue.

Usage: python pipeline/parse_ba.py
"""
import datetime as dt
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CODE = "ba"
RAW = ROOT / "data" / "raw" / CODE / "ris"
OUT = ROOT / "data" / "processed" / CODE
TOL = 1.0  # euro: totals are published to the cent, sums of rounded parts may differ by cents

# Expenditure by kind (economic classification, first level) -> key used by the site.
EXP_KIND = {"610": "wages", "620": "insurance", "630": "goods", "640": "transfers", "650": "interest",
            "690": "other", "710": "capital", "720": "capital", "810": "debt", "820": "debt"}
EXP_ORDER = ["wages", "insurance", "goods", "transfers", "interest", "capital", "debt", "other"]
# Revenue by kind.
REV_KIND = {"110": "shared_tax", "120": "property_tax", "130": "local_tax",
            "210": "own", "220": "own", "240": "own", "290": "own",
            "230": "capital", "320": "capital", "340": "capital",
            "310": "grants", "330": "grants"}
REV_ORDER = ["shared_tax", "property_tax", "local_tax", "own", "grants", "capital", "financing"]
# Organisation types in RIS.
ORG_KIND = {1894990: "office", 1894984: "budgetary", 1894987: "contributory"}
FIN_OPS = "FO"   # pseudo-purpose: financial operations (mostly repayment of loans), outside the functional classification


def r2(v):
    return None if v is None else round(v)


def val(h, k):
    return None if h is None else h.get(k)


def top(rows):
    return [r for r in rows or [] if r.get("level") == 1]


def load_year(year):
    p = RAW / f"{year}.json"
    return json.loads(p.read_text("utf-8")) if p.exists() else None


def quarters(rec, idx):
    """{month: values} of the whole city for revenue (idx 0) or expenditure (idx 1)."""
    out = {}
    for rows in (rec["total"]["response"].get("payload") or {}).values():
        h = rows[idx]["hodnoty"]
        m = rows[idx]["mesiac"]
        if m <= 12 and h and h.get("SKUTOCNOST") is not None:
            out[m] = h
    return out


def series(by_month):
    cum = [None] * 12
    for m, h in by_month.items():
        cum[m - 1] = r2(h["SKUTOCNOST"])
    return cum


def group(rows, mapping, rest_key):
    """Sum first-level rows into site keys; anything unmapped goes to rest_key."""
    out = {}
    for r in top(rows):
        k = mapping.get(r["kod"], rest_key)
        g = out.setdefault(k, {"SCHVALENY": 0.0, "UPRAVENY": 0.0, "SKUTOCNOST": 0.0})
        for f in g:
            g[f] += r["hodnoty"].get(f) or 0.0
    return out


def build(years, org_types):
    monthly, annual, problems = {}, {}, []
    for year in years:
        rec = load_year(year)
        if not rec or not rec.get("total"):
            continue
        exp_q, rev_q = quarters(rec, 1), quarters(rec, 0)
        if not exp_q:
            continue
        last = max(exp_q)
        exp, rev = exp_q[last], rev_q.get(last)

        def check(name, parts, total):
            for f in ("SCHVALENY", "UPRAVENY", "SKUTOCNOST"):
                s = sum(p[f] for p in parts)
                if total.get(f) is not None and abs(s - total[f]) > TOL:
                    problems.append(f"{year}: {name} {f} sums to {s:.2f}, total is {total[f]:.2f}")

        # --- by kind, by month -------------------------------------------------
        kinds = group(rec["economic"]["response"].get("payload"), EXP_KIND, "other")
        check("expenditure by kind", kinds.values(), exp)
        m_exp = {"total": {"budget": r2(exp["SCHVALENY"]), "adjusted": r2(exp["UPRAVENY"]), "cumulative": series(exp_q)}}
        for k in EXP_ORDER:
            if k in kinds and any(kinds[k].values()):
                cum = [None] * 12
                cum[last - 1] = r2(kinds[k]["SKUTOCNOST"])
                m_exp[k] = {"budget": r2(kinds[k]["SCHVALENY"]), "adjusted": r2(kinds[k]["UPRAVENY"]), "cumulative": cum}
        m_rev = {}
        if rev:
            rk = group(rec["revenue"]["response"].get("payload"), REV_KIND, "financing")
            check("revenue by kind", rk.values(), rev)
            m_rev["total"] = {"budget": r2(rev["SCHVALENY"]), "adjusted": r2(rev["UPRAVENY"]), "cumulative": series(rev_q)}
            for k in REV_ORDER:
                if k in rk and any(rk[k].values()):
                    cum = [None] * 12
                    cum[last - 1] = r2(rk[k]["SKUTOCNOST"])
                    m_rev[k] = {"budget": r2(rk[k]["SCHVALENY"]), "adjusted": r2(rk[k]["UPRAVENY"]), "cumulative": cum}
        monthly[str(year)] = {"lastMonth": last, "expenditure": m_exp, "revenue": m_rev}

        # --- by purpose (functional classification, second level = group) -------
        fn = rec["functions"]["response"].get("payload") or []
        areas = []
        for r in fn:
            if r.get("level") != 2:
                continue
            h = r["hodnoty"]
            if not any(h.get(f) for f in ("SCHVALENY", "UPRAVENY", "SKUTOCNOST")):
                continue
            areas.append({"code": r["kod"], "name": r["nazov"].strip(), "approved": r2(h.get("SCHVALENY")),
                          "adjusted": r2(h.get("UPRAVENY")), "actual": r2(h.get("SKUTOCNOST"))})
        fn_top = top(fn)
        for f in ("SCHVALENY", "UPRAVENY", "SKUTOCNOST"):   # groups must add up to their divisions
            a = sum(r["hodnoty"].get(f) or 0 for r in fn if r.get("level") == 2)
            b = sum(r["hodnoty"].get(f) or 0 for r in fn_top)
            if abs(a - b) > TOL:
                problems.append(f"{year}: purpose groups {f} sum to {a:.2f}, divisions to {b:.2f}")
        debt = kinds.get("debt", {"SCHVALENY": 0.0, "UPRAVENY": 0.0, "SKUTOCNOST": 0.0})
        check("expenditure by purpose + financial operations",
              [{f: sum(r["hodnoty"].get(f) or 0 for r in fn_top) for f in debt}, debt], exp)
        if any(debt.values()):
            areas.append({"code": FIN_OPS, "name": "Výdavkové finančné operácie", "approved": r2(debt["SCHVALENY"]),
                          "adjusted": r2(debt["UPRAVENY"]), "actual": r2(debt["SKUTOCNOST"])})

        # --- organisations ------------------------------------------------------
        orgs = {}
        for q, resp in sorted(rec.get("orgs", {}).items(), key=lambda kv: int(kv[0])):
            for code, rows in (resp["response"].get("payload") or {}).items():
                kind = ORG_KIND.get(org_types.get(code))
                h = rows[1]["hodnoty"]
                if not kind or not h or h.get("SKUTOCNOST") is None:
                    continue
                o = orgs.setdefault(code, {"code": code, "name": rows[1]["nazovOrganizacie"].strip(), "kind": kind,
                                           "monthly": [None] * 12})
                o["monthly"][int(q) - 1] = r2(h["SKUTOCNOST"])
                if int(q) == last:
                    o.update(approved=r2(h.get("SCHVALENY")), adjusted=r2(h.get("UPRAVENY")), actual=r2(h["SKUTOCNOST"]))
        org_list = [o for o in orgs.values() if "actual" in o]
        for o in org_list:
            if sum(v is not None for v in o["monthly"]) < 2 and last > 3:
                del o["monthly"]   # only the latest quarter stored for this year: no series
        annual[str(year)] = {
            "source": "ris", "month": last,
            "total": {"approved": r2(exp["SCHVALENY"]), "adjusted": r2(exp["UPRAVENY"]), "actual": r2(exp["SKUTOCNOST"])},
            "chapters": areas,
            "orgs": sorted(org_list, key=lambda o: -(o["actual"] or 0)),
        }
        pop = (rec.get("population") or {}).get("response", {}).get("payload")
        if isinstance(pop, (int, float)) and pop > 0:
            annual[str(year)]["population"] = int(pop)
    return monthly, annual, problems


def main() -> int:
    status = json.loads((RAW / "status.json").read_text("utf-8"))
    org_info = json.loads((RAW / "organizations.json").read_text("utf-8"))["response"]["payload"]
    org_types = {o["kod"]: o["typOrganizacie"] for o in org_info.get("podurovne") or []}
    years = sorted(int(p.stem) for p in RAW.glob("2*.json"))
    monthly, annual, problems = build(years, org_types)
    if not monthly:
        problems.append("no usable year")
    if problems:
        print("VALIDATION FAILED:\n  " + "\n  ".join(problems))
        return 1

    current = max(int(y) for y in monthly)
    last = monthly[str(current)]["lastMonth"]
    nxt = dt.date(current + (last == 12), last % 12 + 1, 1)
    pop_year = max((int(y) for y in annual if annual[y].get("population")), default=None)
    meta = {
        "country": CODE,
        "kind": "city",
        "periodicity": "quarter",
        "currency": "EUR",
        "publisher": "Ministerstvo financií SR, Rozpočtový informačný systém; údaje vykazuje Hlavné mesto SR Bratislava",
        "publisherEn": "Ministry of Finance of the Slovak Republic, Budget Information System; data reported by the City of Bratislava",
        "licence": "verejné údaje MF SR",
        "licenceEn": "public data of MF SR",
        "licenceUrl": "https://rozpocet.sk/web/#/prehlad",
        "currentYear": current,
        "currentLastMonth": last,
        "asOf": (nxt - dt.timedelta(days=1)).isoformat(),
        "monthlyYears": sorted(int(y) for y in monthly),
        "annualYears": sorted(int(y) for y in annual),
        "functionYears": [],
        "chapterMonth": annual[str(current)]["month"],
        "chapterMonthlyYears": [],
        "orgMonthlyYears": sorted(int(y) for y in annual if any("monthly" in o for o in annual[y]["orgs"])),
        "population": ({"value": annual[str(pop_year)]["population"], "year": pop_year,
                        "label": "rozpocet.sk", "labelEn": "rozpocet.sk"} if pop_year else None),
        "sources": [
            {"id": "ris-sam", "title": "Rozpočtový informačný systém (rozpocet.sk), samospráva: Bratislava",
             "titleEn": "Budget Information System (rozpocet.sk), local government: Bratislava",
             "page": "https://rozpocet.sk/web/#/rozpocet/SAM/sam/0", "url": "https://rozpocet.sk/rest/api/",
             "downloaded": status["fetched"]},
            {"id": "ba-budget", "title": "Rozpočet a hospodárenie hlavného mesta (bratislava.sk): schválené rozpočty, zmeny a záverečné účty",
             "titleEn": "Budget and finances of the capital (bratislava.sk): approved budgets, amendments and final accounts",
             "page": "https://bratislava.sk/mesto-bratislava/transparentne-mesto/rozpocet-a-hospodarenie",
             "url": "https://bratislava.sk/mesto-bratislava/transparentne-mesto/rozpocet-a-hospodarenie", "downloaded": None,
             "reference": True},
        ],
        "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    OUT.mkdir(parents=True, exist_ok=True)

    def write(name, obj):
        (OUT / name).write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n", "utf-8")

    write("monthly.json", {"unit": "EUR", "source": "ris-sam", "years": monthly})
    write("annual.json", {"unit": "EUR", "years": annual})
    labels = json.loads((ROOT / "pipeline" / "labels" / f"{CODE}.json").read_text("utf-8"))
    labels.pop("_comment", None)
    write("labels.json", labels)
    (OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print(f"ok: {CODE} {meta['monthlyYears'][0]}-{current} (to month {last}), "
          f"{len(annual[str(current)]['chapters'])} purposes, {len(annual[str(current)]['orgs'])} organisations")
    return 0


if __name__ == "__main__":
    sys.exit(main())
