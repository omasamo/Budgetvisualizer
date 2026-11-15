"""Download the budget of a self-governing city from the Ministry of Finance's Budget
Information System, rozpocet.sk (RIS), module "Samospráva" (SAM), through the same
public REST API the rozpocet.sk website uses. Cities report to RIS every quarter.

For every year it stores one file, data/raw/<code>/ris/<year>.json, holding the API
responses unchanged (plus the URL and time of each request):

  total      rozpocet/rozpocetSamOrg/<id>/<year>/<month>
             revenue and expenditure of the whole city, quarter by quarter (cumulative)
  orgs       rozpocet/rozpoctyPodorganizaciiSamOrg/<id>/<year>/<month>
             the city office and every city organisation, one response per quarter
  functions  rozpocet/polozkyRozpocetuFilterSamOrg/sk/<id>/<year>/SAM/false/FNC
             expenditure by purpose (functional classification, COFOG)
  economic   .../SAM/false/EKV   expenditure by kind (pay, purchases, transfers, investment…)
  revenue    .../SAM/true/EKP    revenue by kind (taxes, fees, grants…)
  population organizacia/pocetobyvatelov/<id>/<year>

A year whose data is final is not downloaded again once it is stored.

Usage: python pipeline/fetch_ris_sam.py <code> [first_year]     (code: ba)
"""
import json
import sys
import time

from fetch_ris import ROOT, get, now

CITIES = {
    # code: RIS organisation id of the municipality (its statistical code)
    "ba": {"id": 582000, "name": "Bratislava"},
}
QUARTERLY_YEARS = 5        # current year and the four before it get every quarter of every organisation
FNC = "FNC=01,02,03,04,05,06,07,08,09,10&EKV=SpoluV"
EKV = "EKV=610,620,630,640,650,690,710,720,810,820"
EKP = "EKP=110,120,130,140,150,160,170,190,210,220,230,240,250,290,310,320,330,340,410,420,430,440,450,510,520,530,540"


def main(code, first_year=2016):
    city = CITIES[code]
    oid = city["id"]
    out = ROOT / "data" / "raw" / code / "ris"
    out.mkdir(parents=True, exist_ok=True)
    stat = {k: get(f"rozpocet/poslednaAktualizacia/SAM/SAM/{k}")["response"]["payload"] for k in ("SKU", "UPR", "SCH")}
    current = max(s["rok"] for s in stat.values())
    actual = stat["SKU"]
    status = {"fetched": now(), "actual": actual, "adjusted": stat["UPR"], "approved": stat["SCH"], "currentYear": current}
    (out / "status.json").write_text(json.dumps(status, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"RIS SAM: actual to {actual['mesiac']}/{actual['rok']}")
    org = get(f"organizacia/info/sk/SAM/{oid}")
    (out / "organizations.json").write_text(json.dumps(org, ensure_ascii=False, separators=(",", ":")) + "\n", "utf-8")

    started = time.time()
    for year in range(current, first_year - 1, -1):
        if time.time() - started > 15 * 60:
            print("time budget used up; remaining years next run")
            break
        path = out / f"{year}.json"
        in_progress = year == current or (year == current - 1 and actual["rok"] < current)
        if path.exists() and not in_progress and json.loads(path.read_text("utf-8")).get("final"):
            print(f"{year}: stored, final")
            continue
        month = 12
        if year == current:
            month = max(s["mesiac"] for s in stat.values() if s["rok"] == current)
        print(f"{year}: to month {month}")
        base = f"rozpocet/polozkyRozpocetuFilterSamOrg/sk/{oid}/{year}/SAM"
        rec = {
            "year": year, "month": month, "final": not in_progress, "organizationId": oid,
            "total": get(f"rozpocet/rozpocetSamOrg/{oid}/{year}/{month}", required=False),
            "functions": get(f"{base}/false/FNC?{FNC}", required=False),
            "economic": get(f"{base}/false/EKV?{EKV}", required=False),
            "revenue": get(f"{base}/true/EKP?{EKP}", required=False),
            "population": get(f"organizacia/pocetobyvatelov/{oid}/{year}", required=False),
            "orgs": {},
        }
        quarters = [q for q in (3, 6, 9, 12) if q <= month] if year > current - QUARTERLY_YEARS else [month]
        for q in quarters:
            r = get(f"rozpocet/rozpoctyPodorganizaciiSamOrg/{oid}/{year}/{q}", required=False)
            if r is not None:
                rec["orgs"][str(q)] = r
        if any(rec[k] is None for k in ("total", "functions", "economic", "revenue")) or len(rec["orgs"]) < len(quarters):
            rec["final"] = False   # incomplete: fetch again next run
        path.write_text(json.dumps(rec, ensure_ascii=False, separators=(",", ":")) + "\n", "utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "ba", int(sys.argv[2]) if len(sys.argv) > 2 else 2016))
