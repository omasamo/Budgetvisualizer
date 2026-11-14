# Rozpočet pre ľudí — Budget for People

An interactive website that shows, in plain language, how the Slovak state spends
its money: the whole budget, every budget chapter (*kapitola*), what the money is
for, how spending is going this year month by month, and how it compares with
previous years.

All numbers come from official sources of the Ministry of Finance of the Slovak
Republic and are refreshed automatically twice a month. The site never estimates or
fills in missing figures.

See [PLAN.md](PLAN.md) for the full development plan, research and change log.

## What is on the site

| View | Question it answers | Data |
|---|---|---|
| Headline | How much will the state spend this year, and how much has it paid out so far? | monthly execution |
| Where the money goes: *who spends* | Which ministries and institutions get the money, and how much they have used | chapters, 2016–current year |
| Where the money goes: *what for* | Education, defence, social protection… (COFOG) | final accounts 2020–2023 |
| Where the money goes: *how* | Wages, purchases, transfers, interest, investment | monthly execution |
| Through the year | Is spending faster or slower than in previous years? | monthly, 2008–current |
| Over the years | How has spending changed since 2008? | monthly + chapters |
| Where the money comes from | Taxes, EU money and other revenue | monthly execution |
| About the data | Sources, licence, glossary, downloads | — |

Every chart has a table view, works with the keyboard, and the site has Slovak and
English, light and dark themes.

## Data sources

| Source | Publisher | Licence | Used for |
|---|---|---|---|
| [Plnenie štátneho rozpočtu SR v národnej metodike](https://opendata.mfsr.sk/mi/opendata/show/plnenie-statneho-rozpoctu-sr-v-narodnej-metodike) | MF SR open data portal | CC BY 4.0 | Monthly cumulative revenue and spending, 2008 onwards |
| [Tabuľky k hotovostnému čerpaniu ŠR v ŠZÚ 2020–2023](https://opendata.mfsr.sk/mi/opendata/category/237-udaje-zo-zaverecneho-uctu-sr) | MF SR open data portal | CC BY 4.0 | Final accounts: chapters and functions |
| [Rozpočtový informačný systém, rozpocet.sk](https://rozpocet.sk/web/#/rozpocet/VS/kapitoly/0) | MF SR | public data of MF SR | Chapters: approved, adjusted and actual, 2016 onwards, monthly for recent years |

Original files are kept unchanged in `data/raw/sk/`, with download dates and
checksums in `data/raw/sk/sources.lock.json`.

## How it works

```
pipeline/fetch.py       download MF SR open data files  -> data/raw/sk/
pipeline/fetch_ris.py   download chapter data (rozpocet.sk API) -> data/raw/sk/ris/
pipeline/parse_sk.py    validate and convert -> data/processed/sk/*.json
pipeline/build_site.sh  site/ + data/processed -> _site/ (what GitHub Pages serves)
site/                   static HTML, CSS and JavaScript (D3 for charts), no build step
```

`parse_sk.py` refuses to publish data that does not add up: chapters must sum to
the official total, the monthly series must match the final account, and the
rozpocet.sk chapter figures must match both.

### Automation

- **Update official data** (`.github/workflows/update-data.yml`) runs on the 5th and
  20th of every month, downloads new files, rebuilds the JSON and commits it.
- **Deploy website** (`.github/workflows/pages.yml`) publishes to GitHub Pages on every
  push to `main` and after each data update.

One-time setup: in the repository go to **Settings → Pages** and set **Source** to
**GitHub Actions**.

### Run locally

```bash
pip install -r pipeline/requirements.txt
python pipeline/fetch.py sk          # needs internet access to opendata.mfsr.sk
python pipeline/fetch_ris.py 2016    # needs internet access to rozpocet.sk
python pipeline/parse_sk.py
bash pipeline/build_site.sh _site
python -m http.server -d _site 8000  # open http://localhost:8000
```

## Adding another country

1. Write `pipeline/sources/<cc>.json`, a parser that outputs the same files as
   `data/processed/sk/` (`meta.json`, `monthly.json`, `annual.json`, `labels.json`).
2. Add the country to `data/countries.json`.

The site code does not need to change; names, currency, years and sources all come
from the data files.

## Licence

Code: MIT. Data: © Ministry of Finance of the Slovak Republic, reused under the
terms of the original publication (CC BY 4.0 for the open data portal).
