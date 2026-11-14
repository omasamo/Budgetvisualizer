// Charts drawn with D3 (global `d3` from the vendored script).
// Specs follow the dataviz method: 2px lines, hairline solid grid, 4px rounded
// column caps, one axis, emphasis colour for the current year, grey for context,
// a crosshair tooltip on lines and a per-mark tooltip on columns.

import { t, money, moneyTick, pct, monthShort, monthName } from './format.js';

const tip = () => document.getElementById('tooltip');

export function showTip(evt, title, rows) {
  const el = tip();
  el.replaceChildren();
  const h = document.createElement('div');
  h.className = 'tt-title';
  h.textContent = title;
  el.append(h);
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'tt-row';
    const l = document.createElement('span');
    if (r.color) {
      const k = document.createElement('i');
      k.className = 'swatch line';
      k.style.background = r.color;
      l.append(k);
    }
    l.append(document.createTextNode(r.label));
    const v = document.createElement('strong');
    v.textContent = r.value;
    row.append(l, v);
    el.append(row);
  }
  el.hidden = false;
  placeTip(evt);
}

export function placeTip(evt) {
  const el = tip();
  let x, y;
  if (evt && 'clientX' in evt && evt.clientX) { x = evt.clientX; y = evt.clientY; }
  else if (evt && evt.target && evt.target.getBoundingClientRect) {
    const r = evt.target.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top;
  } else return;
  const w = el.offsetWidth, h = el.offsetHeight;
  let left = x + 14, top = y - h - 12;
  if (left + w > window.innerWidth - 8) left = x - w - 14;
  if (left < 8) left = 8;
  if (top < 8) top = y + 18;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

export function hideTip() { tip().hidden = true; }

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function emptyNote(el, text) {
  el.replaceChildren();
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = text;
  el.append(p);
}

/**
 * Cumulative spending through the year.
 * series: [{ key, label, current, values: [12 numbers|null] }] — values already in the chosen unit
 * unit: 'share' (0..1+) or 'eur'
 */
export function yearChart(el, { series, unit, emptyText, height = 320 }) {
  const usable = series.filter(s => s.values.some(v => v != null));
  if (!usable.length) return emptyNote(el, emptyText);
  el.replaceChildren();

  const width = Math.max(320, el.clientWidth || 720);
  const narrow = width < 520;
  const m = { top: 16, right: narrow ? 56 : 76, bottom: 30, left: narrow ? 48 : 64 };
  const W = width - m.left - m.right, H = height - m.top - m.bottom;

  const all = usable.flatMap(s => s.values.filter(v => v != null));
  const maxV = Math.max(d3.max(all), unit === 'share' ? 1 : 0);
  const x = d3.scalePoint().domain(d3.range(12)).range([0, W]);
  const y = d3.scaleLinear().domain([0, maxV]).nice(5).range([H, 0]);
  const fmtTick = unit === 'share' ? (v => pct(v)) : moneyTick(maxV);
  const fmtVal = unit === 'share' ? (v => pct(v, 1)) : (v => money(v));

  const svg = d3.create('svg').attr('viewBox', `0 0 ${width} ${height}`).attr('role', 'img')
    .attr('aria-label', usable.map(s => `${s.label}: ${s.values.map((v, i) => v == null ? null : `${monthShort(i)} ${fmtVal(v)}`).filter(Boolean).join(', ')}`).join('; '));
  const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

  g.append('g').attr('class', 'grid')
    .selectAll('line').data(y.ticks(5)).join('line')
    .attr('x1', 0).attr('x2', W).attr('y1', d => y(d)).attr('y2', d => y(d));
  g.append('g').attr('class', 'axis-y').call(d3.axisLeft(y).ticks(5).tickFormat(fmtTick).tickSize(0).tickPadding(8));
  g.append('g').attr('class', 'axis-x').attr('transform', `translate(0,${H})`)
    .call(d3.axisBottom(x).tickFormat(i => (narrow && i % 2) ? '' : monthShort(i)).tickSize(0).tickPadding(10));
  g.append('line').attr('class', 'baseline').attr('x1', 0).attr('x2', W).attr('y1', H).attr('y2', H);

  // 100 % of budget reference
  if (unit === 'share') {
    g.append('line').attr('class', 'pace-line').attr('x1', 0).attr('x2', W).attr('y1', y(1)).attr('y2', y(1));
  }

  const line = d3.line().defined(d => d != null).x((d, i) => x(i)).y(d => y(d));
  const ordered = [...usable].sort((a, b) => (a.current === b.current ? 0 : a.current ? 1 : -1));
  const cur = usable.find(s => s.current);

  if (cur) {
    const area = d3.area().defined(d => d != null).x((d, i) => x(i)).y0(H).y1(d => y(d));
    g.append('path').attr('class', 'area current').attr('d', area(cur.values));
  }
  g.selectAll('path.line').data(ordered).join('path')
    .attr('class', d => `line ${d.current ? 'current' : 'past'}`)
    .attr('d', d => line(d.values));

  // End labels: the current series, plus the most recent past year.
  const lastIdx = s => { for (let i = 11; i >= 0; i--) if (s.values[i] != null) return i; return -1; };
  const labelled = [cur, usable.filter(s => !s.current).at(-1)].filter(Boolean);
  const placed = [];
  for (const s of labelled) {
    const i = lastIdx(s);
    if (i < 0) continue;
    let ly = y(s.values[i]);
    if (placed.some(p => Math.abs(p - ly) < 14)) continue; // avoid collisions; legend + tooltip carry it
    placed.push(ly);
    g.append('circle').attr('class', `dot ${s.current ? 'current' : 'past'}`).attr('r', 4.5).attr('cx', x(i)).attr('cy', ly);
    g.append('text').attr('class', s.current ? 'label-strong' : '').attr('x', x(i) + 9).attr('y', ly + 4)
      .text(i === 11 ? s.label : `${s.label}`);
  }

  // Crosshair + tooltip
  const cross = g.append('line').attr('class', 'crosshair').attr('y1', 0).attr('y2', H).style('display', 'none');
  const accent = cssVar('--accent'), past = cssVar('--past-strong');
  const overlay = g.append('rect').attr('width', W).attr('height', H).attr('fill', 'transparent')
    .attr('tabindex', 0).attr('aria-label', t('year.month'));
  let focusIdx = -1;
  function show(i, evt) {
    cross.style('display', null).attr('x1', x(i)).attr('x2', x(i));
    const rows = [...usable].sort((a, b) => (b.current - a.current) || (b.key > a.key ? 1 : -1))
      .map(s => ({ label: s.label, value: fmtVal(s.values[i]), color: s.current ? accent : past }));
    showTip(evt, monthName(i), rows);
  }
  overlay.on('pointermove', evt => {
    const [px] = d3.pointer(evt);
    const i = Math.max(0, Math.min(11, Math.round(px / (W / 11))));
    show(i, evt);
  }).on('pointerleave', () => { cross.style('display', 'none'); hideTip(); })
    .on('keydown', evt => {
      if (evt.key === 'ArrowRight' || evt.key === 'ArrowLeft') {
        focusIdx = Math.max(0, Math.min(11, (focusIdx < 0 ? 0 : focusIdx + (evt.key === 'ArrowRight' ? 1 : -1))));
        const r = overlay.node().getBoundingClientRect();
        show(focusIdx, { clientX: r.left + (x(focusIdx) / W) * r.width, clientY: r.top + 20 });
        evt.preventDefault();
      }
    }).on('blur', () => { cross.style('display', 'none'); hideTip(); focusIdx = -1; });

  el.append(svg.node());
}

/**
 * Annual columns. items: [{ year, value, kind: 'actual'|'budget' }]
 */
export function historyChart(el, { items, emptyText, height = 280 }) {
  const usable = items.filter(d => d.value != null);
  if (!usable.length) return emptyNote(el, emptyText);
  el.replaceChildren();

  const width = Math.max(320, el.clientWidth || 720);
  const m = { top: 24, right: 8, bottom: 30, left: width < 520 ? 48 : 64 };
  const W = width - m.left - m.right, H = height - m.top - m.bottom;
  const x = d3.scaleBand().domain(usable.map(d => d.year)).range([0, W]).paddingInner(0.3).paddingOuter(0.15);
  const maxV = d3.max(usable, d => d.value);
  const y = d3.scaleLinear().domain([0, maxV]).nice(4).range([H, 0]);
  const bw = Math.min(40, x.bandwidth());

  const svg = d3.create('svg').attr('viewBox', `0 0 ${width} ${height}`).attr('role', 'img')
    .attr('aria-label', usable.map(d => `${d.year}: ${money(d.value)}${d.kind === 'budget' ? ` (${t('history.budget')})` : ''}`).join(', '));
  const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);
  g.append('g').attr('class', 'grid').selectAll('line').data(y.ticks(4)).join('line')
    .attr('x1', 0).attr('x2', W).attr('y1', d => y(d)).attr('y2', d => y(d));
  g.append('g').call(d3.axisLeft(y).ticks(4).tickFormat(moneyTick(maxV)).tickSize(0).tickPadding(8));
  g.append('g').attr('transform', `translate(0,${H})`).call(d3.axisBottom(x).tickSize(0).tickPadding(10));

  // Column with 4px rounded top, square at the baseline.
  const colPath = (x0, y0, w, h) => {
    const r = Math.min(4, w / 2, h);
    return `M${x0},${y0 + h}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + w - r}Q${x0 + w},${y0} ${x0 + w},${y0 + r}V${y0 + h}Z`;
  };
  const last = usable.at(-1);
  const cols = g.selectAll('g.col').data(usable).join('g').attr('class', 'col');
  cols.append('path')
    .attr('class', d => `bar ${d.kind === 'budget' ? 'inprogress' : ''}`)
    .attr('d', d => colPath(x(d.year) + (x.bandwidth() - bw) / 2, y(d.value), bw, H - y(d.value)));
  // Hit area = whole band, bigger than the mark.
  cols.append('rect').attr('class', 'bar-hit').attr('x', d => x(d.year)).attr('width', x.bandwidth())
    .attr('y', 0).attr('height', H).attr('tabindex', 0)
    .attr('aria-label', d => `${d.year}: ${money(d.value)}`)
    .on('pointermove focus', (evt, d) => {
      const i = usable.indexOf(d);
      const prev = usable[i - 1];
      const rows = [{ label: d.kind === 'budget' ? t('history.budget') : t('history.actual'), value: money(d.value) }];
      if (prev && prev.value) rows.push({ label: t('history.change'), value: `${d.value >= prev.value ? '+' : ''}${pct(d.value / prev.value - 1, 1)}` });
      showTip(evt, String(d.year), rows);
    })
    .on('pointerleave blur', hideTip);

  // Direct label only on the latest column and the maximum.
  const maxItem = usable.reduce((a, b) => (b.value > a.value ? b : a));
  const lastI = usable.indexOf(last), maxI = usable.indexOf(maxItem);
  // Label the latest column; also the maximum if it is far enough not to collide.
  const toLabel = Math.abs(lastI - maxI) >= 3 || (x.bandwidth() > 70 && lastI !== maxI) ? [last, maxItem] : [last];
  for (const d of toLabel) {
    g.append('text').attr('x', x(d.year) + x.bandwidth() / 2).attr('y', y(d.value) - 6)
      .attr('text-anchor', 'middle').attr('class', d === last ? 'label-strong' : '').text(money(d.value));
  }
  el.append(svg.node());
}
