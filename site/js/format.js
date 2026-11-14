// Number and text formatting. All money values in data are plain euros.

let T = null; // current dictionary
export function setDict(dict) { T = dict; }
export function dict() { return T; }

/** Look up a dotted key and fill {placeholders}. */
export function t(key, vars = {}) {
  let v = key.split('.').reduce((o, k) => (o == null ? o : o[k]), T);
  if (v == null) return key;
  if (typeof v !== 'string') return v;
  return v.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}

function nf(opts) { return new Intl.NumberFormat(T.locale, opts); }

/** Compact money: 12,3 mld. € / 845 mil. € / 12 300 €. */
export function money(v, { precise = false } = {}) {
  if (v == null || Number.isNaN(v)) return t('common.na');
  const a = Math.abs(v);
  const u = T.units;
  if (a >= 1e9) return `${nf({ maximumFractionDigits: precise ? 2 : (a >= 1e10 ? 1 : 2) }).format(v / 1e9)} ${u.bn}`;
  if (a >= 1e6) return `${nf({ maximumFractionDigits: a >= 1e8 ? 0 : 1 }).format(v / 1e6)} ${u.m}`;
  if (a >= 1e4) return `${nf({ maximumFractionDigits: 0 }).format(v / 1e3)} ${u.k}`;
  return `${nf({ maximumFractionDigits: a >= 100 ? 0 : 2 }).format(v)} ${u.eur}`;
}

/** Full euros for tables: 1 234 567 €. */
export function moneyFull(v) {
  if (v == null || Number.isNaN(v)) return t('common.na');
  return `${nf({ maximumFractionDigits: 0 }).format(v)} ${T.units.eur}`;
}

/** Axis ticks in the unit that fits the domain. */
export function moneyTick(maxAbs) {
  const u = T.units;
  if (maxAbs >= 1e9) return v => `${nf({ maximumFractionDigits: 1 }).format(v / 1e9)} ${u.bn}`;
  if (maxAbs >= 1e6) return v => `${nf({ maximumFractionDigits: 0 }).format(v / 1e6)} ${u.m}`;
  return v => `${nf({ maximumFractionDigits: 0 }).format(v)} ${u.eur}`;
}

export function pct(v, digits = 0) {
  if (v == null || !Number.isFinite(v)) return t('common.na');
  return nf({ style: 'percent', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
}

export function signedPct(v) {
  if (v == null || !Number.isFinite(v)) return t('common.na');
  return nf({ style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(v);
}

export function int(v) { return v == null ? t('common.na') : nf({ maximumFractionDigits: 0 }).format(v); }

export function date(iso) {
  if (!iso) return t('common.na');
  const d = new Date(iso + 'T00:00:00');
  return new Intl.DateTimeFormat(T.locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

export function monthGen(i) { return T.monthsGen[i]; }
export function monthShort(i) { return T.monthsShort[i]; }
export function monthName(i) { return T.months[i]; }

/** Escape text for the few places a translated template is set as HTML. */
export function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
