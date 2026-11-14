// Rozpočet pre ľudí — main application.
// Reads country data from data/<cc>/*.json and renders every view from it.
// Nothing here is specific to Slovakia except what the data files say.

import { setDict, t, money, moneyFull, pct, signedPct, date, monthGen, monthName, esc } from './format.js';
import { yearChart, historyChart, showTip, hideTip } from './charts.js';

const state = {
  lang: 'sk',
  country: null,
  countries: [],
  meta: null,
  monthly: null,
  annual: null,
  labels: null,
  year: null,
  scope: 'total',          // 'total' | 'type:<key>' | 'ch:<code>'
  unit: 'share',
  breakdown: 'chapters',   // 'chapters' | 'functions' | 'types'
  sort: 'budget',
  search: '',
  expanded: false,
};

const $ = id => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
};

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function loadLang(lang) {
  const dict = await getJSON(`i18n/${lang}.json`);
  setDict(dict);
  state.lang = lang;
  document.documentElement.lang = lang;
  store.set('lang', lang);
}

async function loadCountry(cc) {
  const base = `data/${cc}/`;
  const [meta, monthly, annual, labels] = await Promise.all([
    getJSON(base + 'meta.json'),
    getJSON(base + 'monthly.json').catch(() => null),
    getJSON(base + 'annual.json').catch(() => null),
    getJSON(base + 'labels.json').catch(() => ({})),
  ]);
  Object.assign(state, { country: cc, meta, monthly, annual, labels });
  const years = availableYears();
  const want = Number(new URLSearchParams(location.search).get('rok'));
  state.year = years.includes(want) ? want : (meta.currentYear ?? years.at(-1));
}

function availableYears() {
  const s = new Set([...(state.meta?.monthlyYears || []), ...(state.meta?.annualYears || [])]);
  return [...s].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Data access helpers (all values in euros; null = not published)
// ---------------------------------------------------------------------------

const M = y => state.monthly?.years?.[String(y)] || null;
const A = y => state.annual?.years?.[String(y)] || null;

/** Label for a key from labels.json, in the current language, falling back to the source text. */
function label(group, key, fallback) {
  const e = state.labels?.[group]?.[key];
  if (!e) return fallback ?? key;
  return (state.lang === 'en' ? e.en : e.sk) || e.sk || fallback || key;
}
function describe(group, key) {
  const e = state.labels?.[group]?.[key];
  if (!e) return '';
  return (state.lang === 'en' ? e.descEn : e.desc) || '';
}

function chapterName(c) { return label('chapters', c.code, c.name); }
function functionName(f) { return label('functions', f.code, f.name); }

/** The 12 cumulative values for the current scope in a year, or null. */
function cumulativeFor(year, scope = state.scope) {
  const m = M(year);
  if (scope.startsWith('ch:')) return chapterOf(year, scope.slice(3))?.monthly || null;
  if (!m) return null;
  if (scope === 'total') return m.expenditure.total?.cumulative || null;
  if (scope.startsWith('type:')) return m.expenditure[scope.slice(5)]?.cumulative || null;
  if (scope.startsWith('ch:')) return chapterOf(year, scope.slice(3))?.monthly || null;
  return null;
}
function chapterOf(year, code) { return A(year)?.chapters.find(c => c.code === code) || null; }
function budgetFor(year, scope = state.scope) {
  const m = M(year);
  if (scope === 'total') return m?.expenditure.total?.budget ?? A(year)?.total?.approved ?? null;
  if (scope.startsWith('type:')) return m?.expenditure[scope.slice(5)]?.budget ?? null;
  if (scope.startsWith('ch:')) {
    const c = chapterOf(year, scope.slice(3));
    return c ? (c.adjusted ?? c.approved) : null;
  }
  return null;
}
function lastMonthOf(year) { return M(year)?.lastMonth ?? (A(year) ? 12 : 0); }

/** Annual actual for a scope; for an unfinished year returns null. */
function annualActual(year, scope = state.scope) {
  if (scope.startsWith('ch:')) {
    if (A(year)?.month !== 12) return null;
    return chapterOf(year, scope.slice(3))?.actual ?? null;
  }
  const cum = cumulativeFor(year, scope);
  if (cum && cum[11] != null) return cum[11];
  if (scope === 'total') return A(year)?.total?.actual ?? null;
  return null;
}

function scopeName(scope = state.scope) {
  if (scope === 'total') return t('filters.all');
  if (scope.startsWith('type:')) return label('types', scope.slice(5));
  const code = scope.slice(3);
  const y = [...(state.meta.annualYears || [])].reverse().find(y => A(y)?.chapters.some(c => c.code === code));
  const c = y && A(y).chapters.find(c => c.code === code);
  return c ? chapterName(c) : code;
}

// ---------------------------------------------------------------------------
// i18n of static markup
// ---------------------------------------------------------------------------

function applyStaticText() {
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-attr]').forEach(el => {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':');
      el.setAttribute(attr, t(key));
    }
  });
  document.title = t('brand');
  const lt = $('lang-toggle');
  lt.textContent = state.lang === 'sk' ? 'EN' : 'SK';
  lt.setAttribute('aria-label', t('langToggle'));
  lt.setAttribute('lang', state.lang === 'sk' ? 'en' : 'sk');
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function fillSelect(sel, options, value) {
  sel.replaceChildren();
  for (const o of options) {
    if (o.group) {
      const g = document.createElement('optgroup');
      g.label = o.group;
      for (const c of o.options) g.append(new Option(c.label, c.value, false, c.value === value));
      sel.append(g);
    } else {
      sel.append(new Option(o.label, o.value, false, o.value === value));
    }
  }
}

function renderControls() {
  fillSelect($('country-select'), state.countries.map(c => ({ value: c.code, label: c.flag ? `${c.flag} ${c.name[state.lang] || c.name.sk}` : (c.name[state.lang] || c.name.sk) })), state.country);
  $('country-select').hidden = state.countries.length < 2;

  fillSelect($('year-select'), availableYears().slice().reverse().map(y => ({ value: String(y), label: String(y) })), String(state.year));

  const types = Object.keys(M(state.year)?.expenditure || M(state.meta.currentYear)?.expenditure || {}).filter(k => k !== 'total');
  const chYear = chapterYear();
  const chapters = chYear ? A(chYear).chapters.slice().sort((a, b) => chapterName(a).localeCompare(chapterName(b), state.lang)) : [];
  const opts = [{ value: 'total', label: t('filters.all') }];
  if (types.length) opts.push({ group: t('filters.byType'), options: types.map(k => ({ value: `type:${k}`, label: label('types', k) })) });
  if (chapters.length) opts.push({ group: t('filters.byChapter'), options: chapters.map(c => ({ value: `ch:${c.code}`, label: chapterName(c) })) });
  fillSelect($('chapter-select'), opts, state.scope);

  for (const b of document.querySelectorAll('[data-unit]')) b.setAttribute('aria-checked', String(b.dataset.unit === state.unit));
  for (const b of document.querySelectorAll('[data-sort]')) b.setAttribute('aria-checked', String(b.dataset.sort === state.sort));
  for (const b of document.querySelectorAll('[data-breakdown]')) b.setAttribute('aria-checked', String(b.dataset.breakdown === state.breakdown));

  const lm = lastMonthOf(state.year);
  const m = M(state.year);
  $('as-of').textContent = m && lm < 12
    ? t('asOf', { date: date(endOfMonth(state.year, lm)) })
    : t('asOfFinal', { year: state.year });
}

function endOfMonth(y, m) {
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

/** Year whose chapter (or function) data is shown: the selected year if available, else the latest earlier one. */
function chapterYear(year = state.year, kind = 'chapters') {
  const ys = (state.meta.annualYears || []).filter(y => A(y)?.[kind]?.length);
  if (ys.includes(year)) return year;
  const earlier = ys.filter(y => y < year);
  return earlier.length ? earlier.at(-1) : (ys.at(-1) ?? null);
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function renderHero() {
  const y = state.year;
  const lm = lastMonthOf(y);
  const budget = budgetFor(y, 'total');
  const cum = cumulativeFor(y, 'total');
  const spent = cum ? cum[lm - 1] : A(y)?.total?.actual;
  const final = lm === 12;
  const share = budget && spent != null ? spent / budget : null;

  let sentence;
  if (final) sentence = t('hero.final', { year: y, spent: esc(money(spent)) });
  else if (budget) sentence = t('hero.inProgress', { year: y, budget: esc(money(budget)), month: monthGen(lm - 1), spent: esc(money(spent)) });
  else sentence = t('hero.noBudget', { year: y, month: monthGen(lm - 1), spent: esc(money(spent)) });
  $('hero-title').innerHTML = sentence;

  $('hero-figure').textContent = money(spent);
  const adjusted = A(y)?.total?.adjusted;
  $('hero-caption').textContent = final
    ? t('hero.captionFinal', { pct: pct(adjusted ? spent / adjusted : share) , budget: money(adjusted || budget) })
    : t('hero.captionInProgress', { month: monthGen(lm - 1), pct: pct(share) });

  // Meter: spent vs budget, with a marker for how much of the year has passed.
  const paceShare = lm / 12;
  const meterEl = $('hero-meter');
  meterEl.replaceChildren();
  if (budget) {
    meterEl.append(meter(share ?? 0, final ? null : paceShare, t('hero.meterLabel', { spent: money(spent), budget: money(budget), pct: pct(share), pace: pct(paceShare) })));
    const labels = document.createElement('div');
    labels.className = 'hero-meter-labels';
    const a = document.createElement('span'); a.textContent = t('hero.meterSpent', { pct: pct(share) });
    const b = document.createElement('span'); b.textContent = final ? t('hero.meterBudget', { budget: money(budget) }) : t('hero.meterPace', { pct: pct(paceShare) });
    labels.append(a, b);
    meterEl.append(labels);
  }

  // KPI tiles
  const k = $('kpi-row');
  k.replaceChildren();
  const prevCum = cumulativeFor(y - 1, 'total');
  const prevSame = prevCum ? prevCum[lm - 1] : null;
  k.append(
    kpi(t('kpi.approved'), budget, t('kpi.approvedNote')),
    kpi(t('kpi.adjusted'), adjusted ?? null, adjusted != null ? t('kpi.adjustedNote') : t('kpi.adjustedMissing')),
    kpi(t('kpi.actual'), spent, final ? t('kpi.actualNoteFinal') : t('kpi.actualNoteInProgress', { month: monthGen(lm - 1) })),
    kpiText(t('kpi.change'), prevSame ? signedPct(spent / prevSame - 1) : null, prevSame ? t('kpi.changeNote', { year: y - 1, amount: money(prevSame) }) : ''),
  );
}

function meter(share, pace, ariaLabel, tag = 'div') {
  const m = document.createElement(tag);
  m.className = 'meter';
  m.setAttribute('role', 'img');
  m.setAttribute('aria-label', ariaLabel);
  const f = document.createElement(tag);
  f.className = 'meter-fill';
  f.style.width = `${Math.max(0, Math.min(1, share)) * 100}%`;
  m.append(f);
  if (pace != null) {
    const p = document.createElement(tag);
    p.className = 'meter-pace';
    p.style.left = `calc(${pace * 100}% - 1px)`;
    m.append(p);
  }
  return m;
}

function kpi(labelText, value, note) {
  return kpiText(labelText, value == null ? null : money(value), note);
}
function kpiText(labelText, valueText, note) {
  const d = document.createElement('div');
  d.className = 'kpi';
  const l = document.createElement('div'); l.className = 'kpi-label'; l.textContent = labelText;
  const v = document.createElement('div'); v.className = 'kpi-value';
  if (valueText == null) { v.classList.add('missing'); v.textContent = t('kpi.missing'); } else v.textContent = valueText;
  const n = document.createElement('div'); n.className = 'kpi-note'; n.textContent = note || '';
  d.append(l, v, n);
  return d;
}

// --- Breakdown: chapters / purposes / types ---------------------------------

function breakdownRows() {
  const y = state.year;
  if (state.breakdown === 'types') {
    const m = M(y);
    if (!m) return { rows: [], year: y };
    const lm = m.lastMonth;
    const rows = Object.entries(m.expenditure).filter(([k]) => k !== 'total').map(([k, v]) => ({
      id: `type:${k}`, name: label('types', k), sub: describe('types', k),
      budget: v.budget, spent: lm ? v.cumulative[lm - 1] : null,
    })).filter(r => r.budget != null || r.spent != null);
    return { rows, year: y, pace: lm < 12 ? lm / 12 : null, inYear: true };
  }
  const cy = chapterYear(y, state.breakdown);
  const a = cy && A(cy);
  if (!a) return { rows: [], year: cy };
  if (state.breakdown === 'functions') {
    return {
      year: cy,
      rows: a.functions.map(f => ({ id: `fn:${f.code}`, name: functionName(f), sub: describe('functions', f.code), budget: f.adjusted ?? f.approved, approved: f.approved, adjusted: f.adjusted, spent: f.actual })),
    };
  }
  const partial = a.month < 12;
  return {
    year: cy,
    inYear: partial,
    month: a.month,
    pace: partial && a.month ? a.month / 12 : null,
    rows: a.chapters.map(c => ({ id: `ch:${c.code}`, code: c.code, name: chapterName(c), sub: describe('chapters', c.code), budget: c.adjusted ?? c.approved, approved: c.approved, adjusted: c.adjusted, spent: c.actual })),
  };
}

function renderBreakdown() {
  const { rows, year, pace, inYear, month } = breakdownRows();
  const list = $('chapter-list');
  list.replaceChildren();

  const ledeKey = { chapters: 'chapters.lede', functions: 'chapters.ledeFunctions', types: 'chapters.ledeTypes' }[state.breakdown];
  let lede = t(ledeKey, { n: rows.length, year });
  if (state.breakdown !== 'types' && year !== state.year) lede += ' ' + t('chapters.olderYear', { year, selected: state.year });
  if (state.breakdown === 'chapters' && inYear && month) lede += ' ' + t('chapters.asOfMonth', { month: monthGen(month - 1) });
  $('chapters-lede').textContent = lede;

  const legend = $('chapters-legend');
  const budgetLegend = state.breakdown === 'types' ? t('chapters.legendBudget') : t('chapters.legendAdjusted');
  legend.replaceChildren(
    legendItem('swatch', 'var(--accent)', inYear ? t('chapters.legendSpent') : t('chapters.legendActual')),
    legendItem('swatch', 'var(--track)', budgetLegend),
  );
  if (pace != null) legend.append(legendItem('swatch pace', null, t('chapters.legendPace')));

  const q = state.search.trim().toLowerCase();
  let shown = rows.filter(r => !q || r.name.toLowerCase().includes(q) || (r.code || '').includes(q));
  const ratio = r => (r.budget ? (r.spent ?? 0) / r.budget : -1);
  shown.sort(state.sort === 'pace' ? (a, b) => ratio(b) - ratio(a) : (a, b) => (Math.max(b.budget ?? 0, b.spent ?? 0)) - (Math.max(a.budget ?? 0, a.spent ?? 0)));

  if (!rows.length) {
    list.append(emptyLi(state.breakdown === 'types' ? t('chapters.noTypes') : t('chapters.noData')));
  } else if (!shown.length) {
    list.append(emptyLi(t('chapters.none')));
  }

  const LIMIT = 12;
  const total = shown.length;
  const visible = state.expanded || q ? shown : shown.slice(0, LIMIT);
  const maxVal = Math.max(...rows.map(r => Math.max(r.budget ?? 0, r.spent ?? 0)), 1);

  for (const r of visible) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'meter-row';
    const share = r.budget ? (r.spent ?? 0) / r.budget : null;
    btn.setAttribute('aria-label', t('chapters.rowLabel', { name: r.name, budget: money(r.budget), spent: money(r.spent), pct: pct(share) }));

    const name = document.createElement('span');
    name.className = 'meter-name';
    name.textContent = r.name;
    if (r.sub) { const s = document.createElement('small'); s.textContent = r.sub; name.append(s); }

    // Bar length is proportional to the row's size on a shared scale, so rows compare.
    const wrap = document.createElement('span');
    wrap.className = 'meter-wrap';
    const scaled = document.createElement('span');
    scaled.className = 'meter-scaled';
    const width = Math.max(r.budget ?? 0, r.spent ?? 0) / maxVal;
    const m = meter(r.budget ? Math.min(1, (r.spent ?? 0) / Math.max(r.budget, r.spent ?? 0)) : 1, pace != null ? pace * (r.budget ? Math.min(1, r.budget / Math.max(r.budget, r.spent ?? 0)) : 1) : null, '', 'span');
    m.removeAttribute('role'); m.removeAttribute('aria-label');
    m.style.width = `${Math.max(width * 100, 1.5)}%`;
    if (r.spent != null && r.budget != null && r.spent > r.budget) m.classList.add('over');
    scaled.append(m);
    wrap.append(scaled);

    const fig = document.createElement('span');
    fig.className = 'meter-fig';
    fig.textContent = money(r.spent);
    const p = document.createElement('span');
    p.className = 'pct';
    p.textContent = r.budget ? t('chapters.ofBudget', { pct: pct(share), budget: money(r.budget) }) : '';
    fig.append(p);

    btn.append(name, wrap, fig);
    btn.addEventListener('click', () => openDetail(r));
    btn.addEventListener('pointermove', e => showTip(e, r.name, tipRows(r, inYear)));
    btn.addEventListener('pointerleave', hideTip);
    li.append(btn);
    list.append(li);
  }

  const more = $('chapters-more');
  more.hidden = q || total <= LIMIT;
  more.textContent = state.expanded ? t('chapters.showLess') : t('chapters.showAll', { n: total });

  // Table view
  const head = inYear
    ? [t('common.item'), t('common.budget'), t('common.actualSoFar'), t('common.pct')]
    : [t('common.item'), t('common.approved'), t('common.adjusted'), t('common.actual'), t('common.pct')];
  const body = shown.map(r => inYear
    ? [r.name, moneyFull(r.budget), moneyFull(r.spent), pct(r.budget && r.spent != null ? r.spent / r.budget : null, 1)]
    : [r.name, moneyFull(r.approved), moneyFull(r.adjusted), moneyFull(r.spent), pct(r.adjusted ? r.spent / r.adjusted : null, 1)]);
  table($('chapters-table'), head, body);
}

function tipRows(r, inYear) {
  const rows = [];
  if (inYear) rows.push({ label: t('common.budget'), value: money(r.budget) });
  else {
    rows.push({ label: t('common.approved'), value: money(r.approved) });
    rows.push({ label: t('common.adjusted'), value: money(r.adjusted) });
  }
  rows.push({ label: inYear ? t('common.actualSoFar') : t('common.actual'), value: money(r.spent) });
  if (r.budget) rows.push({ label: t('common.pct'), value: pct((r.spent ?? 0) / r.budget, 1) });
  return rows;
}

function legendItem(cls, color, text) {
  const s = document.createElement('span');
  s.className = 'legend-item';
  const i = document.createElement('i');
  i.className = cls;
  if (color) i.style.background = color;
  s.append(i, document.createTextNode(text));
  return s;
}
function emptyLi(text) {
  const li = document.createElement('li');
  li.className = 'empty';
  li.textContent = text;
  return li;
}

function table(el, head, rows) {
  const tbl = document.createElement('table');
  const thead = tbl.createTHead().insertRow();
  for (const h of head) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = h; thead.append(th); }
  const tb = tbl.createTBody();
  for (const r of rows) {
    const tr = tb.insertRow();
    r.forEach((c, i) => {
      const cell = i === 0 ? document.createElement('th') : document.createElement('td');
      if (i === 0) cell.scope = 'row';
      cell.textContent = c;
      tr.append(cell);
    });
  }
  el.replaceChildren(tbl);
}

// --- Through the year -------------------------------------------------------

const COMPARE_YEARS = 5;

function yearSeries(scope = state.scope, unit = state.unit, year = state.year) {
  const pool = scope.startsWith('ch:') ? (state.meta.chapterMonthlyYears || []) : (state.meta.monthlyYears || []);
  const years = pool.filter(y => y <= year && y > year - 1 - COMPARE_YEARS);
  return years.map(y => {
    const cum = cumulativeFor(y, scope);
    if (!cum) return null;
    const b = budgetFor(y, scope);
    const values = cum.map(v => v == null ? null : (unit === 'share' ? (b ? v / b : null) : v));
    return { key: String(y), label: String(y), current: y === year, values };
  }).filter(Boolean);
}

function renderYearView() {
  const scopeHasMonthly = !state.scope.startsWith('ch:') || (state.meta.chapterMonthlyYears || []).includes(state.year);
  $('year-lede').textContent = t('year.lede', { year: state.year, scope: scopeName() });
  const series = scopeHasMonthly ? yearSeries() : [];
  const legend = $('year-legend');
  legend.replaceChildren();
  if (series.length > 1) legend.append(legendItem('swatch line', 'var(--accent)', String(state.year)), legendItem('swatch line', 'var(--past)', t('year.previous', { n: series.length - 1 })));
  yearChart($('year-chart'), { series, unit: state.unit, emptyText: scopeHasMonthly ? t('year.noMonthly') : t('year.noMonthlyChapter') });

  const head = [t('year.month'), ...series.map(s => s.label)];
  const body = [...Array(12).keys()].map(i => [monthName(i), ...series.map(s => s.values[i] == null ? t('common.na') : (state.unit === 'share' ? pct(s.values[i], 1) : moneyFull(s.values[i])))]);
  table($('year-table'), head, series.length ? body : []);
}

// --- Over the years ---------------------------------------------------------

function historyItems(scope = state.scope) {
  const years = availableYears();
  const items = [];
  for (const y of years) {
    const act = annualActual(y, scope);
    if (act != null) items.push({ year: y, value: act, kind: 'actual' });
    else if (y === state.meta.currentYear && (lastMonthOf(y) < 12 || (scope.startsWith('ch:') && A(y)?.month < 12))) {
      const b = budgetFor(y, scope);
      if (b != null) items.push({ year: y, value: b, kind: 'budget' });
    }
  }
  return items;
}

function renderHistory() {
  const items = historyItems();
  $('history-lede').textContent = t('history.lede', { scope: scopeName() });
  historyChart($('history-chart'), { items, emptyText: t('history.noData') });
  table($('history-table'), [t('common.year'), t('common.amount'), t('history.change')],
    items.map((d, i) => [String(d.year) + (d.kind === 'budget' ? ` (${t('history.budget')})` : ''), moneyFull(d.value),
      i > 0 && items[i - 1].value ? signedPct(d.value / items[i - 1].value - 1) : t('common.na')]));
}

// --- Revenue ----------------------------------------------------------------

function renderRevenue() {
  const m = M(state.year);
  const list = $('revenue-list');
  list.replaceChildren();
  const legend = $('revenue-legend');
  legend.replaceChildren();
  if (!m?.revenue?.total) { list.append(emptyLi(t('revenue.noData'))); $('revenue-lede').textContent = ''; return; }
  const lm = m.lastMonth;
  const tot = m.revenue.total;
  const spent = m.expenditure.total.cumulative[lm - 1];
  const got = tot.cumulative[lm - 1];
  $('revenue-lede').textContent = t(lm < 12 ? 'revenue.ledeInProgress' : 'revenue.ledeFinal', {
    year: state.year, month: monthGen(lm - 1), revenue: money(got), gap: money(Math.abs(spent - got)),
    budget: money(tot.budget),
  }) + ' ' + t(spent > got ? 'revenue.deficit' : 'revenue.surplus', { gap: money(Math.abs(spent - got)) });
  legend.append(legendItem('swatch', 'var(--accent)', t('revenue.legendGot')), legendItem('swatch', 'var(--track)', t('revenue.legendBudget')));
  if (lm < 12) legend.append(legendItem('swatch pace', null, t('chapters.legendPace')));

  const keys = ['vat', 'personal', 'corporate', 'excise', 'nontax', 'eu'];
  const rows = keys.map(k => m.revenue[k] && ({ key: k, name: label('revenue', k), sub: describe('revenue', k), budget: m.revenue[k].budget, got: m.revenue[k].cumulative[lm - 1] })).filter(Boolean);
  const maxVal = Math.max(...rows.map(r => Math.max(r.budget ?? 0, r.got ?? 0)), 1);
  for (const r of rows) {
    const li = document.createElement('li');
    li.className = 'meter-row static';
    const name = document.createElement('div'); name.className = 'meter-name'; name.textContent = r.name;
    if (r.sub) { const s = document.createElement('small'); s.textContent = r.sub; name.append(s); }
    const wrap = document.createElement('div'); wrap.className = 'meter-wrap';
    const scaled = document.createElement('div'); scaled.className = 'meter-scaled';
    const big = Math.max(r.budget ?? 0, r.got ?? 0);
    const mt = meter(big ? (r.got ?? 0) / big : 0, lm < 12 && r.budget ? (lm / 12) * (r.budget / big) : null, t('chapters.rowLabel', { name: r.name, budget: money(r.budget), spent: money(r.got), pct: pct(r.budget ? r.got / r.budget : null) }));
    mt.style.width = `${Math.max(big / maxVal * 100, 1.5)}%`;
    scaled.append(mt); wrap.append(scaled);
    const fig = document.createElement('div'); fig.className = 'meter-fig'; fig.textContent = money(r.got);
    const p = document.createElement('span'); p.className = 'pct'; p.textContent = r.budget ? t('chapters.ofBudget', { pct: pct(r.got / r.budget), budget: money(r.budget) }) : '';
    fig.append(p);
    li.append(name, wrap, fig);
    li.addEventListener('pointermove', e => showTip(e, r.name, [{ label: t('common.budget'), value: money(r.budget) }, { label: t('revenue.legendGot'), value: money(r.got) }]));
    li.addEventListener('pointerleave', hideTip);
    list.append(li);
  }
  table($('revenue-table'), [t('common.item'), t('common.budget'), t('revenue.legendGot'), t('common.pct')],
    [[t('revenue.total'), moneyFull(tot.budget), moneyFull(got), pct(tot.budget ? got / tot.budget : null, 1)],
      ...rows.map(r => [r.name, moneyFull(r.budget), moneyFull(r.got), pct(r.budget ? r.got / r.budget : null, 1)])]);
}

// --- Per person -------------------------------------------------------------

function renderShare() {
  const pop = state.meta.population;
  const sec = $('podiel');
  if (!pop?.value) { sec.hidden = true; return; }
  sec.hidden = false;
  const y = state.year;
  const total = annualActual(y, 'total') ?? budgetFor(y, 'total');
  const basis = annualActual(y, 'total') != null ? t('share.basisActual', { year: y }) : t('share.basisBudget', { year: y });
  $('share-lede').textContent = t('share.lede', { pop: new Intl.NumberFormat(state.lang === 'en' ? 'en-GB' : 'sk-SK').format(pop.value), popSource: pop.label || '' });
  const row = $('share-row');
  row.replaceChildren(
    kpi(t('share.perYear'), total / pop.value, basis),
    kpi(t('share.perMonth'), total / pop.value / 12, basis),
    kpi(t('share.perDay'), total / pop.value / (y % 4 === 0 ? 366 : 365), basis),
  );
}

// --- About ------------------------------------------------------------------

function renderAbout() {
  $('about-body').innerHTML = t('about.body');
  const gl = $('glossary');
  gl.replaceChildren();
  for (const [term, def] of t('glossary')) {
    const dt = document.createElement('dt'); dt.textContent = term;
    const dd = document.createElement('dd'); dd.textContent = def;
    gl.append(dt, dd);
  }
  const ul = $('sources');
  ul.replaceChildren();
  for (const s of state.meta.sources || []) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = s.page || s.url;
    a.textContent = state.lang === 'en' ? (s.titleEn || s.title) : s.title;
    a.rel = 'noopener';
    li.append(a, document.createTextNode(` — ${state.meta.publisher}${s.downloaded ? `, ${t('about.downloaded', { date: date(s.downloaded.slice(0, 10)) })}` : ''}`));
    ul.append(li);
  }
  const lic = document.createElement('li');
  const la = document.createElement('a');
  la.href = state.meta.licenceUrl; la.textContent = state.meta.licence; la.rel = 'noopener';
  lic.append(document.createTextNode(t('about.licence') + ' '), la);
  ul.append(lic);

  const dl = $('downloads');
  dl.replaceChildren();
  dl.append(document.createTextNode(t('about.downloads') + ' '));
  ['meta.json', 'monthly.json', 'annual.json'].forEach((f, i) => {
    if (i) dl.append(document.createTextNode(', '));
    const a = document.createElement('a'); a.href = `data/${state.country}/${f}`; a.textContent = f; a.download = f;
    dl.append(a);
  });
  dl.append(document.createTextNode('.'));

  $('footer-text').replaceChildren(document.createTextNode(t('footer', { publisher: state.meta.publisher, licence: state.meta.licence }) + ' '));
  const gh = document.createElement('a');
  gh.href = 'https://github.com/omasamo/Budgetvisualizer';
  gh.textContent = 'GitHub';
  $('footer-text').append(gh);
}

// --- Detail dialog ----------------------------------------------------------

function openDetail(r) {
  const dlg = $('chapter-dialog');
  $('dlg-title').textContent = r.name;
  $('dlg-desc').textContent = r.sub || '';
  const k = $('dlg-kpis');
  k.replaceChildren();
  const { inYear } = breakdownRows();
  if (inYear) {
    k.append(kpi(t('common.budget'), r.budget, String(state.year)), kpi(t('common.actualSoFar'), r.spent, t('kpi.actualNoteInProgress', { month: monthGen(lastMonthOf(state.year) - 1) })));
  } else {
    k.append(kpi(t('common.approved'), r.approved, ''), kpi(t('common.adjusted'), r.adjusted, ''), kpi(t('common.actual'), r.spent, pct(r.adjusted ? r.spent / r.adjusted : null) + ' ' + t('common.ofAdjusted')));
  }
  dlg.showModal();

  // Charts need layout; draw after the dialog is visible.
  requestAnimationFrame(() => {
    const yc = $('dlg-year-chart');
    const yh = $('dlg-year-title');
    const series = (r.id.startsWith('type:') || r.id.startsWith('ch:')) ? yearSeries(r.id, 'share') : [];
    if (series.length) {
      yh.hidden = false; yc.hidden = false;
      yearChart(yc, { series, unit: 'share', emptyText: t('year.noMonthly'), height: 260 });
    } else { yh.hidden = true; yc.hidden = true; yc.replaceChildren(); }

    let items = [];
    if (r.id.startsWith('ch:') || r.id.startsWith('type:')) items = historyItems(r.id);
    else if (r.id.startsWith('fn:')) {
      const code = r.id.slice(3);
      items = (state.meta.annualYears || []).map(y => ({ year: y, value: A(y)?.functions.find(f => f.code === code)?.actual ?? null, kind: 'actual' }));
    }
    historyChart($('dlg-history-chart'), { items, emptyText: t('history.noData'), height: 240 });
  });
}

// ---------------------------------------------------------------------------
// Render all
// ---------------------------------------------------------------------------

function renderAll() {
  applyStaticText();
  renderControls();
  renderHero();
  renderBreakdown();
  renderYearView();
  renderHistory();
  renderRevenue();
  renderShare();
  renderAbout();
  const url = new URL(location.href);
  url.searchParams.set('rok', state.year);
  if (state.lang !== 'sk') url.searchParams.set('lang', state.lang); else url.searchParams.delete('lang');
  history.replaceState(null, '', url);
}

function showStatus(title, body) {
  const s = $('status');
  s.hidden = false;
  s.replaceChildren();
  const b = document.createElement('strong'); b.textContent = title;
  const p = document.createElement('span'); p.textContent = body;
  s.append(b, p);
  for (const sec of document.querySelectorAll('main > section')) sec.hidden = true;
}

function bind() {
  $('year-select').addEventListener('change', e => { state.year = Number(e.target.value); state.expanded = false; renderAll(); });
  $('chapter-select').addEventListener('change', e => { state.scope = e.target.value; renderAll(); });
  $('country-select').addEventListener('change', async e => { await loadCountry(e.target.value); state.scope = 'total'; renderAll(); });
  $('chapter-search').addEventListener('input', e => { state.search = e.target.value; renderBreakdown(); });
  $('chapters-more').addEventListener('click', () => { state.expanded = !state.expanded; renderBreakdown(); });
  for (const b of document.querySelectorAll('[data-sort]')) b.addEventListener('click', () => { state.sort = b.dataset.sort; renderControls(); renderBreakdown(); });
  for (const b of document.querySelectorAll('[data-unit]')) b.addEventListener('click', () => { state.unit = b.dataset.unit; renderControls(); renderYearView(); });
  for (const b of document.querySelectorAll('[data-breakdown]')) b.addEventListener('click', () => { state.breakdown = b.dataset.breakdown; state.expanded = false; state.search = ''; $('chapter-search').value = ''; renderControls(); renderBreakdown(); });
  // Arrow keys move between options of a segmented control (radio group pattern).
  for (const g of document.querySelectorAll('.seg')) {
    g.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const btns = [...g.querySelectorAll('button')];
      const i = btns.indexOf(document.activeElement);
      const n = btns[(i + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length];
      n.focus(); n.click(); e.preventDefault();
    });
  }
  $('lang-toggle').addEventListener('click', async () => { await loadLang(state.lang === 'sk' ? 'en' : 'sk'); renderAll(); });
  $('theme-toggle').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    store.set('theme', root.dataset.theme);
    renderYearView(); renderHistory();
  });
  let rt;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { renderYearView(); renderHistory(); }, 150); });
  $('chapter-dialog').addEventListener('close', hideTip);
}

async function init() {
  const params = new URLSearchParams(location.search);
  const lang = params.get('lang') || store.get('lang') || (navigator.language?.startsWith('sk') || navigator.language?.startsWith('cs') ? 'sk' : 'sk');
  await loadLang(['sk', 'en'].includes(lang) ? lang : 'sk');
  applyStaticText();
  bind();
  try {
    state.countries = (await getJSON('data/countries.json')).countries;
    const cc = params.get('krajina') || state.countries[0]?.code;
    await loadCountry(cc);
  } catch (e) {
    showStatus(t('noData.title'), t('noData.body'));
    console.error(e);
    return;
  }
  renderAll();
}

init();
