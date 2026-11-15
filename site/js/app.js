// Rozpočet pre ľudí — main application.
// Reads country data from data/<cc>/*.json and renders every view from it.
// Nothing here is specific to Slovakia except what the data files say.

import { setDict, t, money, moneyFull, pct, signedPct, date, monthGen, monthName, esc } from './format.js';
import { yearChart, historyChart, changesChart, showTip, hideTip, reducedMotion } from './charts.js';

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
  if (scope === 'total' && A(year)?.month === 12) return A(year)?.total?.actual ?? null;
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

function renderHero(animate = false) {
  const y = state.year;
  const lm = lastMonthOf(y);
  const budget = budgetFor(y, 'total');
  const cum = cumulativeFor(y, 'total');
  const spent = cum ? cum[lm - 1] : A(y)?.total?.actual;
  const final = lm === 12;
  const share = budget && spent != null ? spent / budget : null;

  $('hero-eyebrow').textContent = final ? t('hero.eyebrowFinal', { year: y }) : t('hero.eyebrowInProgress', { year: y, month: monthGen(lm - 1) });

  let sentence;
  if (final) sentence = t('hero.final', { year: y, spent: esc(money(spent)) });
  else if (budget) sentence = t('hero.inProgress', { year: y, budget: esc(money(budget)), month: monthGen(lm - 1), spent: esc(money(spent)) });
  else sentence = t('hero.noBudget', { year: y, month: monthGen(lm - 1), spent: esc(money(spent)) });
  $('hero-title').innerHTML = sentence;

  $('hero-figure-sr').textContent = money(spent);
  countUp($('hero-figure'), spent, animate);
  const adjusted = A(y)?.total?.adjusted;
  $('hero-caption').textContent = final
    ? t('hero.captionFinal', { pct: pct(adjusted ? spent / adjusted : share) , budget: money(adjusted || budget) })
    : t('hero.captionInProgress', { month: monthGen(lm - 1), pct: pct(share) });

  // Meter: spent vs budget, with a marker for how much of the year has passed.
  const paceShare = lm / 12;
  const meterEl = $('hero-meter');
  meterEl.replaceChildren();
  if (budget) {
    const m = meter(share ?? 0, final ? null : paceShare, t('hero.meterLabel', { spent: money(spent), budget: money(budget), pct: pct(share), pace: pct(paceShare) }));
    m.classList.add('months');
    if (animate && !reducedMotion()) growMeter(m);
    meterEl.append(m);
    const labels = document.createElement('div');
    labels.className = 'hero-meter-labels';
    const a = document.createElement('span'); a.textContent = t('hero.meterSpent', { pct: pct(share) });
    const b = document.createElement('span'); b.textContent = final ? t('hero.meterBudget', { budget: money(budget) }) : t('hero.meterPace', { pct: pct(paceShare) });
    labels.append(a, b);
    meterEl.append(labels);
  }

  renderRate(y, lm, spent, final);

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

/** Animate a hero number from zero to its value, keeping the final unit throughout. */
let countRaf = 0;
function countUp(el, value, animate) {
  cancelAnimationFrame(countRaf);
  const finalText = money(value);
  if (!animate || value == null || reducedMotion()) { el.textContent = finalText; return; }
  const m = finalText.match(/^(-?[\d\s .,]+)(.*)$/);
  if (!m) { el.textContent = finalText; return; }
  const scale = Math.abs(value) >= 1e9 ? 1e9 : Math.abs(value) >= 1e6 ? 1e6 : Math.abs(value) >= 1e4 ? 1e3 : 1;
  const nf = new Intl.NumberFormat(t('locale'), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const t0 = performance.now(), dur = 1100;
  const step = now => {
    const k = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = k < 1 ? `${nf.format(value * e / scale)}${m[2]}` : finalText;
    if (k < 1) countRaf = requestAnimationFrame(step);
  };
  countRaf = requestAnimationFrame(step);
}

function growMeter(m) {
  const f = m.querySelector('.meter-fill');
  const w = f.style.width;
  f.style.width = '0%';
  requestAnimationFrame(() => requestAnimationFrame(() => { f.style.width = w; }));
}

/** "Every second" side panel: a perspective that turns billions into a rate people can feel. */
let tickTimer = 0;
function renderRate(y, lm, spent, final) {
  clearInterval(tickTimer);
  const side = $('hero-side');
  const ticker = $('ticker');
  if (spent == null || !lm) { side.hidden = true; return; }
  side.hidden = false;
  const start = Date.UTC(y, 0, 1), end = Date.UTC(y, lm, 1);
  const seconds = (end - start) / 1000;
  const perSecond = spent / seconds;
  const perDay = perSecond * 86400;
  const eur = v => `${new Intl.NumberFormat(t('locale'), { maximumFractionDigits: 0 }).format(v)} ${t('units.eur')}`;
  if (final) {
    $('rate-title').textContent = t('rate.titleFinal');
    $('rate-figure').textContent = money(perDay);
    $('rate-note').textContent = t('rate.noteFinal', { year: y, second: eur(perSecond) });
    ticker.hidden = true;
    return;
  }
  $('rate-title').textContent = t('rate.titleInProgress');
  $('rate-figure').textContent = eur(perSecond);
  $('rate-note').textContent = t('rate.noteInProgress', { year: y, month: monthGen(lm - 1), day: money(perDay) });
  ticker.hidden = false;
  $('ticker-label').textContent = t('rate.tickerLabel');
  const out = $('ticker-value');
  const tick = () => { out.textContent = eur(perSecond * (performance.now() - pageOpened) / 1000); };
  tick();
  tickTimer = setInterval(tick, reducedMotion() ? 1000 : 100);
}
const pageOpened = performance.now();

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
  // Remember where each row was, so re-sorting animates rows to their new place.
  const before = new Map([...list.children].filter(li => li.dataset.id).map(li => [li.dataset.id, li.getBoundingClientRect().top]));
  const sameKind = list.dataset.kind === state.breakdown;
  list.dataset.kind = state.breakdown;
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
    li.dataset.id = r.id;
    list.append(li);
  }
  flip(list, before, sameKind);

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

/** FLIP: rows that stayed slide from their old place; a new set of rows fades in. */
function flip(list, before, sameKind) {
  if (reducedMotion()) return;
  if (!sameKind || !before.size) {
    list.classList.remove('list-enter'); void list.offsetWidth; list.classList.add('list-enter');
    return;
  }
  for (const li of list.children) {
    const old = before.get(li.dataset.id);
    if (old == null) continue;
    const dy = old - li.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) continue;
    li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.2,.7,.2,1)' });
  }
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

// --- Every 100 € (icon array) ------------------------------------------------

const WAFFLE_SLOTS = 6;

/** Split 100 into whole euros by largest remainder, so the squares always add up to 100. */
function toHundred(values) {
  const sum = values.reduce((a, b) => a + b, 0) || 1;
  const raw = values.map(v => v / sum * 100);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { out[i]++; left--; } });
  return out;
}

function hundredRows() {
  const cy = chapterYear(state.year, 'chapters');
  const a = cy && A(cy);
  if (!a) return null;
  const final = a.month === 12;
  const val = c => final ? c.actual : (c.adjusted ?? c.approved);
  const chapters = a.chapters.filter(c => val(c) > 0).sort((x, y) => val(y) - val(x));
  const top = chapters.slice(0, WAFFLE_SLOTS);
  const rest = chapters.slice(WAFFLE_SLOTS);
  const items = top.map((c, i) => ({
    key: `ch:${c.code}`, slot: i + 1, name: chapterName(c), sub: describe('chapters', c.code), amount: val(c),
    row: { id: `ch:${c.code}`, code: c.code, name: chapterName(c), sub: describe('chapters', c.code), budget: c.adjusted ?? c.approved, approved: c.approved, adjusted: c.adjusted, spent: c.actual, inYear: !final },
  }));
  if (rest.length) items.push({ key: 'other', slot: 0, name: t('hundred.other', { n: rest.length }), sub: t('hundred.otherSub'), amount: rest.reduce((s, c) => s + val(c), 0) });
  const euros = toHundred(items.map(i => i.amount));
  items.forEach((it, i) => { it.euros = euros[i]; });
  return { year: cy, final, items };
}

function renderHundred() {
  const data = hundredRows();
  const sec = $('sto-eur');
  if (!data) { sec.hidden = true; return; }
  sec.hidden = false;
  const { year, final, items } = data;
  $('hundred-title').textContent = t(final ? 'hundred.titleActual' : 'hundred.titleBudget', { year });
  let lede = t('hundred.lede', { n: items.filter(i => i.slot).length });
  if (year !== state.year) lede += ' ' + t('chapters.olderYear', { year, selected: state.year });
  $('hundred-lede').textContent = lede;

  const waffle = $('waffle');
  waffle.replaceChildren();
  waffle.setAttribute('aria-label', t('hundred.aria', { list: items.map(i => `${i.name} ${i.euros} €`).join(', ') }));
  // Emphasis: the chosen item keeps its colour, everything else steps back.
  const setActive = k => {
    if (k) waffle.dataset.active = k; else delete waffle.dataset.active;
    for (const c of waffle.children) c.classList.toggle('is-active', c.dataset.key === k);
    for (const li of $('waffle-legend').children) li.classList.toggle('active', li.dataset.key === k);
  };
  let n = 0;
  for (const it of items) {
    for (let j = 0; j < it.euros; j++) {
      const c = document.createElement('span');
      c.className = `waffle-cell slot-${it.slot}`;
      c.dataset.key = it.key;
      c.style.setProperty('--i', n++);
      c.addEventListener('pointerenter', e => { setActive(it.key); showTip(e, it.name, [{ label: t('hundred.share'), value: `${it.euros} €` }, { label: t('hundred.amount'), value: money(it.amount) }]); });
      c.addEventListener('pointermove', e => showTip(e, it.name, [{ label: t('hundred.share'), value: `${it.euros} €` }, { label: t('hundred.amount'), value: money(it.amount) }]));
      c.addEventListener('pointerleave', () => { setActive(null); hideTip(); });
      c.addEventListener('click', () => pickHundred(it));
      waffle.append(c);
    }
  }

  const legend = $('waffle-legend');
  legend.replaceChildren();
  for (const it of items) {
    const li = document.createElement('li');
    li.dataset.key = it.key;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wl-item';
    const sw = document.createElement('i'); sw.className = `swatch slot-${it.slot}`;
    const nm = document.createElement('span'); nm.className = 'wl-name'; nm.textContent = it.name;
    const ct = document.createElement('span'); ct.className = 'wl-euros'; ct.textContent = `${it.euros} €`;
    const am = document.createElement('span'); am.className = 'wl-amount'; am.textContent = money(it.amount);
    b.append(sw, nm, ct, am);
    b.setAttribute('aria-label', `${it.name}: ${t('hundred.cents', { n: it.euros })}, ${money(it.amount)}`);
    b.addEventListener('pointerenter', () => setActive(it.key));
    b.addEventListener('pointerleave', () => setActive(null));
    b.addEventListener('focus', () => setActive(it.key));
    b.addEventListener('blur', () => setActive(null));
    b.addEventListener('click', () => pickHundred(it));
    li.append(b);
    legend.append(li);
  }
  table($('hundred-table'), [t('common.item'), t('hundred.share'), t('hundred.amount')], items.map(i => [i.name, `${i.euros} €`, moneyFull(i.amount)]));
}

function pickHundred(it) {
  hideTip();
  if (it.row) return openDetail(it.row);
  // "Other" leads to the full list of chapters.
  state.breakdown = 'chapters'; state.expanded = true; state.search = ''; $('chapter-search').value = '';
  renderControls(); renderBreakdown();
  $('kapitoly').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' });
}

// --- Biggest changes --------------------------------------------------------

const CHANGE_ROWS = 6;

function changeRows() {
  const y = chapterYear(state.year, 'chapters');
  const cur = y && A(y), prev = y && A(y - 1);
  if (!cur || !prev) return null;
  const prevBy = new Map(prev.chapters.map(c => [c.code, c]));
  const all = [];
  let unmatched = 0;
  for (const c of cur.chapters) {
    const p = prevBy.get(c.code);
    if (!p || !p.approved || c.approved == null) { unmatched++; continue; }
    prevBy.delete(c.code);
    all.push({ id: `ch:${c.code}`, code: c.code, name: chapterName(c), prev: p.approved, cur: c.approved, diff: c.approved - p.approved, rel: c.approved / p.approved - 1, c });
  }
  unmatched += prevBy.size;
  const ups = all.filter(r => r.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, CHANGE_ROWS);
  const downs = all.filter(r => r.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, CHANGE_ROWS).reverse();
  return { year: y, prevYear: y - 1, rows: [...ups, ...downs], all, unmatched, partial: cur.month < 12 };
}

const signedMoney = v => `${v >= 0 ? '+' : '−'}${money(Math.abs(v))}`;

function renderChanges(animate = false) {
  const data = changeRows();
  const chart = $('changes-chart');
  $('changes-title').textContent = t('changes.title');
  const legend = $('changes-legend');
  legend.replaceChildren();
  if (!data || !data.rows.length) {
    $('changes-lede').textContent = t('changes.none');
    chart.replaceChildren();
    table($('changes-table'), [], []);
    return;
  }
  const { year, prevYear, rows, all, unmatched } = data;
  let lede = t('changes.lede', { year, prev: prevYear, n: CHANGE_ROWS });
  if (year !== state.year) lede += ' ' + t('chapters.olderYear', { year, selected: state.year });
  if (unmatched) lede += ' ' + t('changes.unmatched', { n: unmatched });
  $('changes-lede').textContent = lede;
  legend.append(legendItem('swatch chg-up', null, t('changes.up')), legendItem('swatch chg-down', null, t('changes.down')));
  const toDetail = r => openDetail({ id: r.id, code: r.code, name: r.name, sub: describe('chapters', r.code), budget: r.c.adjusted ?? r.c.approved, approved: r.c.approved, adjusted: r.c.adjusted, spent: r.c.actual, inYear: data.partial });
  changesChart(chart, {
    rows, animate: animate && inView(chart),
    fmtLabel: r => `${signedMoney(r.diff)} (${signedPct(r.rel)})`,
    rowLabel: r => t('changes.rowLabel', { name: r.name, prev: money(r.prev), py: prevYear, cur: money(r.cur), cy: year, diff: signedMoney(r.diff), pct: signedPct(r.rel) }),
    tipRows: r => [
      { label: `${t('common.approved')} ${prevYear}`, value: money(r.prev) },
      { label: `${t('common.approved')} ${year}`, value: money(r.cur) },
      { label: t('changes.change'), value: `${signedMoney(r.diff)} (${signedPct(r.rel)})` },
    ],
    onPick: toDetail,
  });
  table($('changes-table'), [t('common.chapter'), `${t('common.approved')} ${prevYear}`, `${t('common.approved')} ${year}`, t('changes.change'), '%'],
    all.slice().sort((a, b) => b.diff - a.diff).map(r => [r.name, moneyFull(r.prev), moneyFull(r.cur), moneyFull(r.diff), signedPct(r.rel)]));
}

function inView(el) {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < innerHeight;
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

function renderYearView(animate = false) {
  const scopeHasMonthly = !state.scope.startsWith('ch:') || (state.meta.chapterMonthlyYears || []).includes(state.year);
  $('year-lede').textContent = t('year.lede', { year: state.year, scope: scopeName() });
  const series = scopeHasMonthly ? yearSeries() : [];
  const legend = $('year-legend');
  legend.replaceChildren();
  if (series.length > 1) legend.append(legendItem('swatch line', 'var(--accent)', String(state.year)), legendItem('swatch line', 'var(--past)', t('year.previous', { n: series.length - 1 })));
  yearChart($('year-chart'), { series, unit: state.unit, emptyText: scopeHasMonthly ? t('year.noMonthly') : t('year.noMonthlyChapter'), animate: animate && inView($('year-chart')) });
  yearInsight(scopeHasMonthly);

  const head = [t('year.month'), ...series.map(s => s.label)];
  const body = [...Array(12).keys()].map(i => [monthName(i), ...series.map(s => s.values[i] == null ? t('common.na') : (state.unit === 'share' ? pct(s.values[i], 1) : moneyFull(s.values[i])))]);
  table($('year-table'), head, series.length ? body : []);
}

/** A takeaway sentence: is money going out faster or slower than in past years at the same point? */
function yearInsight(ok) {
  const el = $('year-insight');
  el.hidden = true;
  if (!ok) return;
  const shares = yearSeries(state.scope, 'share');
  const cur = shares.find(s => s.current);
  if (!cur) return;
  let i = -1;
  for (let k = 11; k >= 0; k--) if (cur.values[k] != null) { i = k; break; }
  if (i < 0 || i === 11) return;
  const past = shares.filter(s => !s.current && s.values[i] != null).map(s => s.values[i]);
  if (past.length < 2) return;
  const avg = past.reduce((a, b) => a + b, 0) / past.length;
  const v = cur.values[i];
  const key = v - avg > 0.01 ? 'year.insightFaster' : avg - v > 0.01 ? 'year.insightSlower' : 'year.insightSame';
  el.innerHTML = t(key, { month: monthGen(i), pct: esc(pct(v)), avg: esc(pct(avg)), n: past.length });
  el.hidden = false;
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

function renderHistory(animate = false) {
  const items = historyItems();
  $('history-lede').textContent = t('history.lede', { scope: scopeName() });
  historyChart($('history-chart'), { items, emptyText: t('history.noData'), animate: animate && inView($('history-chart')) });
  const actual = items.filter(d => d.kind === 'actual');
  const ins = $('history-insight');
  ins.hidden = actual.length < 3;
  if (actual.length >= 3) {
    const a = actual[0], b = actual.at(-1);
    ins.innerHTML = t('history.insight', { from: a.year, to: b.year, a: esc(money(a.value)), b: esc(money(b.value)), pct: esc(signedPct(b.value / a.value - 1)) });
  }
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
  if (!m?.revenue?.total) { list.append(emptyLi(t('revenue.noData'))); $('revenue-lede').textContent = ''; $('balance').replaceChildren(); return; }
  const lm = m.lastMonth;
  const tot = m.revenue.total;
  const spent = m.expenditure.total.cumulative[lm - 1];
  const got = tot.cumulative[lm - 1];
  $('revenue-lede').textContent = t(lm < 12 ? 'revenue.ledeInProgress' : 'revenue.ledeFinal', {
    year: state.year, month: monthGen(lm - 1), revenue: money(got), gap: money(Math.abs(spent - got)),
    budget: money(tot.budget),
  }) + ' ' + t(spent > got ? 'revenue.deficit' : 'revenue.surplus', { gap: money(Math.abs(spent - got)) });
  renderBalance(spent, got);
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

/** Spending and revenue on one scale; the gap between them is the deficit. */
function renderBalance(spent, got) {
  const el = $('balance');
  el.replaceChildren();
  const max = Math.max(spent, got) || 1;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', t('revenue.balanceLabel', { spent: money(spent), got: money(got) }) + ' ' + t(spent > got ? 'revenue.gapDeficit' : 'revenue.gapSurplus', { gap: money(Math.abs(spent - got)) }));
  const row = (cls, labelText, v) => {
    const r = document.createElement('div'); r.className = `bal-row ${cls}`;
    const l = document.createElement('span'); l.className = 'bal-label'; l.textContent = labelText;
    const track = document.createElement('span'); track.className = 'bal-track';
    const bar = document.createElement('span'); bar.className = 'bal-bar'; bar.style.width = `${v / max * 100}%`;
    const fig = document.createElement('span'); fig.className = 'bal-fig'; fig.textContent = money(v);
    track.append(bar); r.append(l, track, fig);
    return r;
  };
  const gapRow = document.createElement('div'); gapRow.className = 'bal-row bal-gap-row';
  const spacer = document.createElement('span');
  const gTrack = document.createElement('span'); gTrack.className = 'bal-track';
  const gap = document.createElement('span'); gap.className = `bal-gap ${spent > got ? 'deficit' : 'surplus'}`;
  const lo = Math.min(spent, got);
  gap.style.left = `${lo / max * 100}%`; gap.style.width = `${Math.abs(spent - got) / max * 100}%`;
  gTrack.append(gap);
  const gFig = document.createElement('span'); gFig.className = 'bal-fig strong';
  gFig.textContent = t(spent > got ? 'revenue.gapDeficit' : 'revenue.gapSurplus', { gap: money(Math.abs(spent - got)) });
  gapRow.append(spacer, gTrack, gFig);
  el.append(row('spent', t('revenue.balanceSpent'), spent), row('got', t('revenue.balanceGot'), got), gapRow);
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
  const inYear = r.inYear ?? breakdownRows().inYear;
  if (inYear) {
    const mo = r.id.startsWith('ch:') ? (A(state.year)?.month ?? lastMonthOf(state.year)) : lastMonthOf(state.year);
    k.append(kpi(t('common.budget'), r.budget, r.id.startsWith('ch:') ? t('kpi.adjustedNote') : String(state.year)), kpi(t('common.actualSoFar'), r.spent, t('kpi.actualNoteInProgress', { month: monthGen(mo - 1) })));
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

function renderAll(animate = true) {
  applyStaticText();
  renderControls();
  renderHero(animate);
  renderHundred();
  renderBreakdown();
  renderChanges(animate);
  renderYearView(animate);
  renderHistory(animate);
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
  // The sticky filter bar sits right under the sticky header, whatever height the header wraps to.
  const header = $('site-header');
  const setH = () => document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`);
  setH();
  if ('ResizeObserver' in window) new ResizeObserver(setH).observe(header);
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
  $('lang-toggle').addEventListener('click', async () => { await loadLang(state.lang === 'sk' ? 'en' : 'sk'); renderAll(false); });
  $('theme-toggle').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    store.set('theme', root.dataset.theme);
    renderYearView(); renderHistory(); renderChanges();
  });
  let rt, lastW = innerWidth;
  addEventListener('resize', () => {
    if (innerWidth === lastW) return; // phones fire resize when the address bar hides
    lastW = innerWidth;
    clearTimeout(rt); rt = setTimeout(() => { renderYearView(); renderHistory(); renderChanges(); }, 150);
  });
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
  observeSections();
}

/** Reveal sections as they scroll into view, play their charts once, and mark the current section in the nav. */
function observeSections() {
  const sections = [...document.querySelectorAll('main > section.reveal')];
  const replay = { 'zmeny': () => renderChanges(true), 'pocas-roka': () => renderYearView(true), 'roky': () => renderHistory(true) };
  if ('IntersectionObserver' in window && !reducedMotion()) {
    document.documentElement.classList.add('js-reveal');
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
        replay[e.target.id]?.();
      }
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.05 });
    sections.forEach(s => (inView(s) ? s.classList.add('is-in') : io.observe(s)));
  } else sections.forEach(s => s.classList.add('is-in'));

  if (!('IntersectionObserver' in window)) return;
  const links = new Map([...document.querySelectorAll('.header-nav a')].map(a => [a.getAttribute('href').slice(1), a]));
  const spy = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      for (const [id, a] of links) { if (id === e.target.id) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); }
      // On phones the nav scrolls sideways: keep the current link in view without moving the page.
      const a = links.get(e.target.id), nav = a?.parentElement;
      if (a && nav && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: a.offsetLeft - (nav.clientWidth - a.offsetWidth) / 2, behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
  }, { rootMargin: '-35% 0px -60% 0px' });
  for (const id of links.keys()) { const s = $(id); if (s) spy.observe(s); }
}

init();
