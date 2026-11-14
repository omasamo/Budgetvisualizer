"""Download state budget figures by chapter (kapitola) from the Ministry of Finance's
Budget Information System, rozpocet.sk (RIS), through the public REST API that the
rozpocet.sk website itself uses.

For every year it stores one file, data/raw/sk/ris/<year>.json, holding the API
responses unchanged (plus the URL and time of each request):

  chapters   rozpocet/rozpoctyPodorganizaciiVSOrg/0/<year>/<month>
             approved, adjusted and actual revenue and expenditure of every chapter
  total      rozpocet/rozpocetVSOrg/0/<year>/<month>       (recent years only)
             the whole state budget, month by month
  monthly    rozpocet/rozpocetVSOrg/<chapterId>/<year>/<month> (recent years only)
             each chapter, month by month (cumulative)

A year whose data is final is not downloaded again once it is stored.

Usage: python pipeline/fetch_ris.py [first_year]
"""
import datetime as dt
import json
import pathlib
import sys
import time
import functools
import urllib.request

print = functools.partial(print, flush=True)  # show progress live in CI logs

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "raw" / "sk" / "ris"
API = "https://rozpocet.sk/rest/api/"
UA = "Mozilla/5.0 (compatible; budget-visualizer; +https://github.com/omasamo/Budgetvisualizer)"
MONTHLY_YEARS = 4          # current year and the three before it get month-by-month chapter data
PAUSE = 0.6                # seconds between requests, to be gentle with the server


def now():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def get(path, required=True):
    url = API + path
    t0 = time.time()
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=45) as r:
                body = r.read()
            data = json.loads(body)
            time.sleep(PAUSE)
            return {"url": url, "fetched": now(), "response": data}
        except Exception as e:  # retry with backoff, then give up on this request
            wait = 3 * (attempt + 1)
            print(f"  retry {path} in {wait}s ({type(e).__name__}: {str(e)[:80]}) after {time.time() - t0:.0f}s")
            time.sleep(wait)
    if required:
        raise RuntimeError(f"failed: {url}")
    print(f"  SKIP {path}")
    return None


def main(first_year=2016):
    OUT.mkdir(parents=True, exist_ok=True)
    sku = get("rozpocet/poslednaAktualizacia/SR/VS/SKU")["response"]["payload"]
    upr = get("rozpocet/poslednaAktualizacia/SR/VS/UPR")["response"]["payload"]
    sch = get("rozpocet/poslednaAktualizacia/SR/VS/SCH")["response"]["payload"]
    current = max(sku["rok"], upr["rok"], sch["rok"])
    status = {"fetched": now(), "actual": sku, "adjusted": upr, "approved": sch, "currentYear": current}
    (OUT / "status.json").write_text(json.dumps(status, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"RIS: actual to {sku['mesiac']}/{sku['rok']}, adjusted to {upr['mesiac']}/{upr['rok']}")

    started = time.time()
    for year in range(current, first_year - 1, -1):   # newest first: it matters most
        if time.time() - started > 20 * 60:
            print("time budget used up; remaining years next run")
            break
        path = OUT / f"{year}.json"
        in_progress = year == current or (year == current - 1 and sku["rok"] < current)
        if path.exists() and not in_progress:
            old = json.loads(path.read_text("utf-8"))
            if old.get("final") and (year < current - MONTHLY_YEARS + 1 or old.get("monthly")):
                print(f"{year}: stored, final")
                continue
        month = 12
        if year == current:
            month = max(m["mesiac"] for m in (sku, upr, sch) if m["rok"] == current)
        print(f"{year}: chapters to month {month}")
        rec = {"year": year, "month": month, "final": not in_progress,
               "chapters": get(f"rozpocet/rozpoctyPodorganizaciiVSOrg/0/{year}/{month}")}
        if year > current - MONTHLY_YEARS:
            rec["total"] = get(f"rozpocet/rozpocetVSOrg/0/{year}/{month}")
            # Chapter ids for this year (the API addresses chapters by internal id).
            orgs = get(f"organizacie/info/sk/VS/0/{year}/2")
            rec["organizations"] = orgs
            rec["monthly"] = {}
            for ch in orgs["response"]["payload"].get("podurovne") or []:
                if ch.get("uroven") != "KAPITOLA":
                    continue
                r = get(f"rozpocet/rozpocetVSOrg/{ch['id']}/{year}/{month}", required=False)
                if r is not None:
                    rec["monthly"][ch["kod"]] = r
            n_ch = sum(1 for ch in orgs["response"]["payload"].get("podurovne") or [] if ch.get("uroven") == "KAPITOLA")
            if len(rec["monthly"]) < n_ch:
                rec["final"] = False  # incomplete: fetch again next run
            print(f"  monthly for {len(rec['monthly'])} of {n_ch} chapters")
        path.write_text(json.dumps(rec, ensure_ascii=False, separators=(",", ":")) + "\n", "utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(int(sys.argv[1]) if len(sys.argv) > 1 else 2016))
