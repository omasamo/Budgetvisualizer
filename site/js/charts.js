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

/** True when the reader asked the system for less motion. */
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

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
export function yearChart(el, { series, unit, emptyText, height = 320, animate = false }) {
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
  const paths = g.selectAll('path.line').data(ordered).join('path')
    .attr('class', d => `line ${d.current ? 'current' : 'past'}`)
    .attr('d', d => line(d.values));
  // Draw the current year in, once, when the chart first comes into view.
  if (animate && !reducedMotion()) {
    paths.filter(d => d.current).each(function () {
      const len = this.getTotalLength();
      d3.select(this).attr('stroke-dasharray', `${len} ${len}`).attr('stroke-dashoffset', len)
        .transition().duration(1100).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0)
        .on('end', function () { d3.select(this).attr('stroke-dasharray', null); });
    });
    g.selectAll('path.area').attr('opacity', 0).transition().delay(500).duration(700).attr('opacity', 1);
  }

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
    .attr('tabindex', 0).attr('role', 'img').attr('aria-label', t('year.keyboardHint'));
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
export function historyChart(el, { items, emptyText, height = 280, animate = false }) {
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
  const every = Math.ceil(usable.length / Math.max(1, Math.floor(W / 44)));
  const lastYear = usable.at(-1).year;
  g.append('g').attr('transform', `translate(0,${H})`).call(d3.axisBottom(x).tickSize(0).tickPadding(10)
    .tickFormat(yr => ((lastYear - yr) % every === 0 ? (every > 1 ? `’${String(yr).slice(2)}` : yr) : '')));

  // Column with 4px rounded top, square at the baseline.
  const colPath = (x0, y0, w, h) => {
    const r = Math.min(4, w / 2, h);
    return `M${x0},${y0 + h}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + w - r}Q${x0 + w},${y0} ${x0 + w},${y0 + r}V${y0 + h}Z`;
  };
  const last = usable.at(-1);
  const cols = g.selectAll('g.col').data(usable).join('g').attr('class', 'col');
  const bars = cols.append('path')
    .attr('class', d => `bar ${d.kind === 'budget' ? 'inprogress' : ''}`)
    .attr('d', d => colPath(x(d.year) + (x.bandwidth() - bw) / 2, y(d.value), bw, H - y(d.value)));
  // Columns grow from the baseline, left to right, the first time they are seen.
  if (animate && !reducedMotion()) {
    bars.attr('d', d => colPath(x(d.year) + (x.bandwidth() - bw) / 2, H, bw, 0))
      .transition().delay((d, i) => i * 45).duration(650).ease(d3.easeCubicOut)
      .attr('d', d => colPath(x(d.year) + (x.bandwidth() - bw) / 2, y(d.value), bw, H - y(d.value)));
  }
  // Hit area = whole band, bigger than the mark.
  cols.append('rect').attr('class', 'bar-hit').attr('x', d => x(d.year)).attr('width', x.bandwidth())
    .attr('y', 0).attr('height', H).attr('tabindex', 0).attr('role', 'img')
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


/**
 * Diverging bars of change between two years, centred on zero.
 * rows: [{ id, name, diff, rel, prev, cur }] sorted top to bottom.
 * Increases point right in the "up" colour, decreases left in the "down" colour.
 */
export function changesChart(el, { rows, fmtLabel, onPick, tipRows, rowLabel, animate = false }) {
  el.replaceChildren();
  if (!rows.length) return;
  const width = Math.max(320, el.clientWidth || 720);
  const narrow = width < 640;
  const rowH = narrow ? 50 : 34;
  const nameW = narrow ? 0 : Math.min(380, width * 0.38);
  const m = { top: 6, right: 8, bottom: 6, left: 8 };
  const W = width - m.left - m.right - nameW;
  const height = m.top + m.bottom + rows.length * rowH + (rows.some(r => r.diff < 0) && rows.some(r => r.diff > 0) ? 14 : 0);
  const maxAbs = d3.max(rows, r => Math.abs(r.diff)) || 1;
  // Leave room on both sides for the value labels.
  // Wide: value labels sit beyond the bar end, so leave room on both sides.
  // Narrow: labels sit in the empty half across the zero line, so bars can use the full width.
  const x = d3.scaleLinear().domain([-maxAbs, maxAbs]).range(narrow ? [4, W - 4] : [150, W - 150]);

  const svg = d3.create('svg').attr('viewBox', `0 0 ${width} ${height}`).attr('role', 'list');
  const g = svg.append('g').attr('transform', `translate(${m.left + nameW},${m.top})`);
  let yPos = 0;
  const pos = rows.map((r, i) => {
    if (i > 0 && rows[i - 1].diff > 0 && r.diff < 0) yPos += 14; // gap between the two groups
    const p = yPos; yPos += rowH; return p;
  });
  g.append('line').attr('class', 'zero-line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', -4).attr('y2', yPos + 4);

  const bh = narrow ? 14 : 16;
  const rowsG = g.selectAll('g.chg').data(rows).join('g').attr('class', 'chg')
    .attr('transform', (d, i) => `translate(0,${pos[i]})`)
    .attr('role', 'listitem');
  const barY = narrow ? rowH - bh - 8 : (rowH - bh) / 2;
  const barPath = (d, scale = 1) => {
    const x0 = x(0), x1 = x(d.diff * scale);
    const left = Math.min(x0, x1), w = Math.max(Math.abs(x1 - x0), 1.5);
    const r = Math.min(4, w / 2);
    // Rounded at the data end only; square at zero.
    if (d.diff >= 0) return `M${left},${barY}H${left + w - r}Q${left + w},${barY} ${left + w},${barY + r}V${barY + bh - r}Q${left + w},${barY + bh} ${left + w - r},${barY + bh}H${left}Z`;
    return `M${left + w},${barY}H${left + r}Q${left},${barY} ${left},${barY + r}V${barY + bh - r}Q${left},${barY + bh} ${left + r},${barY + bh}H${left + w}Z`;
  };
  const bars = rowsG.append('path').attr('class', d => `chg-bar ${d.diff >= 0 ? 'up' : 'down'}`).attr('d', d => barPath(d));
  if (animate && !reducedMotion()) {
    bars.attr('d', d => barPath(d, 0)).transition().delay((d, i) => 80 + i * 40).duration(600).ease(d3.easeCubicOut).attr('d', d => barPath(d));
  }
  const across = narrow;
  rowsG.append('text').attr('class', 'chg-val')
    .attr('x', d => across ? x(0) + (d.diff >= 0 ? -6 : 6) : (d.diff >= 0 ? x(d.diff) + 6 : x(d.diff) - 6))
    .attr('text-anchor', d => (d.diff >= 0) !== across ? 'start' : 'end')
    .attr('y', barY + bh / 2 + 4)
    .text(fmtLabel);
  if (narrow) {
    rowsG.append('text').attr('class', 'chg-name').attr('x', 0).attr('y', 14).text(d => { const max = Math.floor((W + nameW) / 6.9); return d.name.length > max ? d.name.slice(0, max - 1) + '…' : d.name; });
  } else {
    rowsG.append('text').attr('class', 'chg-name').attr('x', -nameW + 4).attr('y', rowH / 2 + 4)
      .text(d => { const max = Math.floor(nameW / 6.9); return d.name.length > max ? d.name.slice(0, max - 1) + '…' : d.name; });
  }
  // Whole row is the hit target and a keyboard stop.
  rowsG.insert('rect', ':first-child').attr('class', 'chg-hit').attr('x', -nameW).attr('y', 0).attr('width', nameW + W).attr('height', rowH)
    .attr('tabindex', 0).attr('role', 'button').attr('aria-label', rowLabel)
    .on('pointermove focus', (evt, d) => showTip(evt, d.name, tipRows(d)))
    .on('pointerleave blur', hideTip)
    .on('click', (evt, d) => { hideTip(); onPick(d); })
    .on('keydown', (evt, d) => { if (evt.key === 'Enter' || evt.key === ' ') { evt.preventDefault(); hideTip(); onPick(d); } });
  el.append(svg.node());
}
