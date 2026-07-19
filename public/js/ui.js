// Shared UI helpers: DOM building, formatting, toasts, dialogs, clipboard.
// All dynamic rendering goes through h() — plain DOM nodes, no HTML strings,
// so user-entered text (point names, notes, map names) can never inject markup.

// ─── DOM building ──────────────────────────────────────────────────────────────

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'value') el.value = v;
      else if (k === 'disabled' || k === 'selected' || k === 'checked') el[k] = true;
      else el.setAttribute(k, v);
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

// Clone an icon from the SVG sprite defined in index.html.
const SVG_NS = 'http://www.w3.org/2000/svg';
export function icon(name, size = 16) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.appendChild(use);
  return svg;
}

// ─── Formatting ────────────────────────────────────────────────────────────────

export function fmtMoney(n) {
  return (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function formatDate(ds) {
  const [y, m, d] = ds.split('-');
  const dt = new Date(+y, +m - 1, +d);
  return `${DAY_NAMES[dt.getDay()]}, ${m}/${d}/${y}`;
}

export function fmtShort(ds) {
  if (!ds) return '';
  const [, m, d] = ds.split('-');
  return `${+m}/${+d}`;
}

export function isThursday(ds) {
  const [y, m, d] = ds.split('-');
  return new Date(+y, +m - 1, +d).getDay() === 4;
}

export function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const todayStr = () => toDateStr(new Date());

// Totals: recorded units carry name/price joined from the map's unit definitions.
export function pointTotal(pt) {
  return pt.units.reduce((s, u) => s + (u.price || 0) * u.quantity, 0);
}

export function dayTotal(day) {
  return day.points.reduce((s, p) => s + pointTotal(p), 0);
}

// ─── Toasts ────────────────────────────────────────────────────────────────────

export function toast(type, msg) {
  const t = h('div', { class: `toast ${type}` },
    h('span', { class: 'toast-icon' }, type === 'success' ? '✓' : '✕'),
    h('span', null, msg));
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => {
    t.classList.add('hide');
    setTimeout(() => t.remove(), 300);
  }, 3000);
}

// ─── Confirm dialog ────────────────────────────────────────────────────────────

export function showConfirm(title, msg, onOk) {
  const cancel = h('button', { class: 'btn btn-ghost btn-sm' }, 'Cancel');
  const ok = h('button', { class: 'btn btn-danger btn-sm' }, 'Delete');
  const ov = h('div', { class: 'confirm-overlay' },
    h('div', { class: 'confirm-dialog' },
      h('h3', null, title),
      h('p', null, msg),
      h('div', { class: 'confirm-actions' }, cancel, ok)));
  document.body.appendChild(ov);
  cancel.onclick = () => ov.remove();
  ok.onclick = () => { ov.remove(); onOk(); };
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
}

// ─── Clipboard ─────────────────────────────────────────────────────────────────

export async function clipCopy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}
