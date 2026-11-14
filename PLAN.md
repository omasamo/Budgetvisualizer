# Plan: Rozpočet pre ľudí — an interactive state budget visualizer

**Goal:** make the Slovak state budget understandable to an average person. Anyone
should be able to open the site and, within a minute, answer:

1. How much does the state plan to spend this year, and how much has it spent so far?
2. Which ministries and institutions (budget chapters, *kapitoly*) get the money?
3. Is spending this year running faster or slower than in previous years?
4. How has each chapter changed over the past years?
5. What does that mean for me, per person?

Slovakia is the first country. The code is written so another country can be added by
dropping a new data folder and a config file, without touching the charts.

This file is the living plan. Each stage has a status; when reality changes the plan,
the change is written down in the **Change log** at the bottom.

---

## 0. What we learned from existing solutions

| Site | What it does well | What we take |
|---|---|---|
| [rozpocet.sk](https://rozpocet.sk/web/#/prehlad) (MF SR, official Budget Information System) | Complete, official, down to individual institutions and municipalities | It is the reference for numbers, but it is built for specialists: tables, codes, no story. We aim at the layperson it does not serve. |
| [Where Your Money Goes](https://www.whereyourmoneygoes.gov.ie/en/about/) (Ireland, official) | Year selector, actual vs estimated spending, ten-year trends, drill-down by category, named sources per year | Clear labelling of *budget* vs *actual*; year comparison; sources stated per year |
| Where Does My Money Go? (UK, Open Knowledge Foundation) and OpenSpending | Treemap/bubble "where your tax goes"; per-taxpayer daily view | A personal "your share" view; one-glance part-to-whole |
| Czech per-person budget calculator (2026, F. Hráček) | Turns the national budget into a weekly per-person contribution | Per-person framing makes billions tangible |
| USAFacts / US Treasury "Your Guide to America's Finances" | Plain-language explainers next to every chart, glossary, "spent so far this year" | Plain-language captions; glossary; in-year progress |

Best-practice guidance used:

- International Budget Partnership, *The Power of Making It Simple: A Government Guide to
  Developing Citizens Budgets* — plain language, explain what the budget is, show
  comparisons with past years, publish data in reusable form.
- OECD, *The People and the Budget* (2025) and the OECD Budget Transparency Toolkit —
  timeliness (in-year reports), comparability across years, accessibility.
- IMF Fiscal Transparency Code — distinguish approved, adjusted and actual figures.
- WCAG 2.1 AA — contrast, keyboard access, screen-reader text, a table view for every chart.

**Design principles that follow from this**

- Lead with one plain sentence and one big number, then let people drill down.
- Always say which figure is which: *schválený rozpočet* (approved by parliament),
  *upravený rozpočet* (after changes during the year), *skutočnosť* (actually paid out).
- Never show a chart without a sentence saying what it shows.
- Every chart has a table view and works with keyboard; tooltips never hide information.
- Every number links back to its official source file.
- Compare like with like: nominal euros, with an optional "per person" view.

---

## 1. Data sources (official only)

All data comes from the Ministry of Finance of the Slovak Republic (MF SR). The MF SR
open data portal publishes under **CC BY 4.0**, which allows reuse with attribution.

| Need | Official source | Format | Status |
|---|---|---|---|
| Current year: monthly spending by chapter vs approved/adjusted budget | MF SR open data, *Plnenie štátneho rozpočtu SR v národnej metodike* (monthly) — `opendata.mfsr.sk/mi/opendata/download/plnenie-statneho-rozpoctu-sr-v-narodnej-metodike/1` | XLSX | to verify structure |
| Daily state budget account balance | MF SR open data, *Priebežné plnenie štátneho rozpočtu* | XLS | optional |
| Past years: actual spending by chapter | MF SR open data, *Tabuľky k hotovostnému čerpaniu ŠR v ŠZU* (state final account), 2020–2023 | XLSX | to verify structure |
| Past years: approved budget by chapter | State budget acts (*zákon o štátnom rozpočte*), annex "výdavky podľa kapitol", via Slov-Lex | PDF/HTML | fallback |
| Population for "per person" | Statistical Office of the SR (ŠÚ SR), DATAcube | CSV | later |

Every downloaded file is stored unchanged in `data/raw/sk/<source>/<date>/` together
with a `SOURCE.md` (URL, download date, licence). The processed files in
`data/processed/sk/` are generated from the raw files by scripts in `pipeline/`, so
anyone can check every number.

**Rule:** if a figure is not available from an official source, the site says it is
missing. It never estimates, interpolates or invents a value.

---

## 2. Architecture

```
data/
  raw/<country>/...            original official files, never edited
  processed/<country>/         small JSON files the site reads
    meta.json                  country, currency, years available, sources
    chapters.json              chapter id -> names (sk/en), group, plain description
    budget-<year>.json         per chapter: approved, adjusted, actual, monthly cumulative
pipeline/                      Python scripts: fetch -> parse -> validate -> write JSON
site/                          static website (HTML, CSS, vanilla JS + D3)
  countries.json               list of countries the site offers
.github/workflows/
  update-data.yml              monthly: download official files, rebuild JSON, commit
  pages.yml                    build and deploy site/ + data/processed to GitHub Pages
```

- **No server.** GitHub Pages serves static files; all interactivity is in the browser.
- **No framework build step.** Plain ES modules plus D3 (vendored, pinned version) keeps
  the project easy to maintain and fast to load.
- **Country-agnostic:** the site reads `countries.json`, then the country's `meta.json`.
  Chapter names, currency and language come from data, not code.
- **Bilingual:** Slovak first, English second; UI strings live in `site/i18n/*.json`.

### Data contract (`budget-<year>.json`)

```json
{
  "year": 2026,
  "status": "in-progress",          // or "final"
  "asOf": "2026-09-30",             // last month with actual data
  "unit": "EUR",
  "source": "sk-plnenie-narodna-2026-09",
  "totals": { "approved": 0, "adjusted": 0, "actual": 0 },
  "chapters": [
    { "id": "MPSVR", "approved": 0, "adjusted": 0, "actual": 0,
      "monthly": [ /* cumulative actual at end of Jan..Dec, null if not yet known */ ] }
  ]
}
```

`null` always means "not published", never zero.

---

## 3. Stages

### Stage 1 — Research and plan ✅
Existing solutions, best practices, official sources, this plan.

### Stage 2 — Site skeleton and design system ✅
- Page layout, typography, colour tokens for light and dark mode.
- Chart palette from the dataviz method, validated for colour-blind safety.
- Language switch (SK/EN), country switch (only SK for now), year switch.
- Empty states that say clearly when data is missing.

### Stage 3 — Interactive views ✅ (code), ⏳ (with real data)
1. **Headline**: "In 2026 the state plans to spend X €. By the end of <month> it has
   paid out Y € (Z %)." Big number plus a progress meter.
2. **Where the money goes**: every chapter as a ranked bar with budget vs spent so far;
   search box; click a chapter for its detail panel.
3. **Spending through the year**: cumulative monthly line for the selected year,
   with previous years in grey for comparison (emphasis form, one axis).
4. **Over the years**: per-chapter history of actual spending, chapter picker.
5. **Your share**: the budget per resident per year, month and day.
6. **Table view** for every chart, CSV download of the processed data.
7. **About the data**: sources, licence, definitions, glossary in plain language.

### Stage 4 — Data pipeline ⏳
- `pipeline/fetch.py`: downloads the files listed in `pipeline/sources/sk.json`,
  stores them in `data/raw/` with a `SOURCE.md`.
- `pipeline/parse_sk.py`: reads the MF SR spreadsheets, maps chapter rows to stable ids,
  writes `data/processed/sk/*.json`.
- `pipeline/validate.py`: checks that chapters sum to the published total, monthly
  values never decrease, every year has a source. The build fails if a check fails.
- Blocked until the official files can be downloaded (see Change log, 2026-11-14).

### Stage 5 — Automation and hosting ⏳
- `pages.yml`: deploy to GitHub Pages on every push to `main`.
- `update-data.yml`: on the 20th of each month (MF SR publishes monthly execution
  around mid-month) download the new files, rebuild JSON and open a commit.
- Repository setting needed once: *Settings → Pages → Source: GitHub Actions*.

### Stage 6 — Quality pass ⏳
- Accessibility audit (WCAG 2.1 AA): contrast, keyboard, screen readers, reduced motion.
- Design critique of hierarchy and copy; test with a few non-economists.
- Performance: under 300 KB of JS+data on first load; works on phones.

### Stage 7 — More countries (later)
- Add `data/processed/<cc>/` + entry in `site/countries.json` + a parser.
- Candidates with good official open data: Czechia (Monitor státní pokladny), Ireland.

---

## Change log

- **2026-11-14** — Plan written. Research found official data on the MF SR open data
  portal (CC BY 4.0). The development environment cannot reach `mfsr.sk`,
  `opendata.mfsr.sk` or `rozpocet.sk`, so the download step is moved to a GitHub
  Actions workflow (which also serves as the monthly update job), pending the owner's
  approval. Site and pipeline are built against the data contract above in the meantime.
