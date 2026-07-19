// Report modal: review any date range and copy it as TSV for the Excel report.
// Defaults to the crew's reporting week (Friday → Thursday, reports due Thursday).
import { state, activeMap } from './state.js';
import { api } from './api.js';
import { h, icon, toast, clipCopy, formatDate, fmtShort, fmtMoney, toDateStr, dayTotal } from './ui.js';
import { dayToTsv } from './workday.js';

// Current reporting week: the Friday–Thursday window containing today.
function defaultRange() {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday … 4 = Thursday
  const thu = new Date(now);
  thu.setDate(now.getDate() + (day <= 4 ? 4 - day : 11 - day));
  const fri = new Date(thu);
  fri.setDate(thu.getDate() - 6);
  return { start: toDateStr(fri), end: toDateStr(thu) };
}

const getRange = () => ({
  start: document.getElementById('wr-start').value,
  end: document.getElementById('wr-end').value,
});

function openReport() {
  if (!state.activeMapId) return toast('error', 'Select a map first');
  const { start, end } = defaultRange();
  document.getElementById('wr-start').value = start;
  document.getElementById('wr-end').value = end;
  document.getElementById('weekly-report-modal').style.display = '';
  document.body.style.overflow = 'hidden';
  loadReport();
}

function closeReport() {
  document.getElementById('weekly-report-modal').style.display = 'none';
  document.body.style.overflow = '';
}

async function loadReport() {
  const { start, end } = getRange();
  if (!start || !end) return;
  if (start > end) return toast('error', '"From" date is after "To" date');
  document.getElementById('wr-map-name').textContent = activeMap()?.name || '';
  try {
    const days = await api('GET', `/api/maps/${state.activeMapId}/report?start=${start}&end=${end}`);
    renderReport(days, start, end);
  } catch (e) { toast('error', e.message); }
}

// Shift both dates by the length of the current range (a week by default).
function shiftRange(dir) {
  const { start, end } = getRange();
  if (!start || !end) return;
  const s = new Date(start + 'T00:00');
  const e = new Date(end + 'T00:00');
  const len = Math.round((e - s) / 86400000) + 1;
  s.setDate(s.getDate() + dir * len);
  e.setDate(e.getDate() + dir * len);
  document.getElementById('wr-start').value = toDateStr(s);
  document.getElementById('wr-end').value = toDateStr(e);
  loadReport();
}

function renderReport(days, start, end) {
  const body = document.getElementById('wr-body');
  if (!days.length) {
    return body.replaceChildren(
      h('div', { class: 'empty-state' },
        h('h3', null, 'No work entries in this range'),
        h('p', null, `No points recorded from ${fmtShort(start)} to ${fmtShort(end)}`)));
  }

  let rangeTotal = 0, totalPoints = 0, totalUnits = 0;
  const nodes = [];
  for (const day of days) {
    const total = dayTotal(day);
    rangeTotal += total;
    nodes.push(h('div', { class: 'wr-day-header' }, formatDate(day.work_date)));
    for (const pt of day.points) {
      totalPoints++;
      totalUnits += pt.units.length;
      nodes.push(h('div', { class: 'wr-point' },
        h('span', { class: 'wr-point-name' }, pt.name),
        pt.units.length > 0 && h('div', { class: 'wr-units' },
          pt.units.map(u => h('span', { class: 'wr-unit' }, `${u.name} ×${u.quantity}`)))));
    }
    nodes.push(h('div', { class: 'wr-day-total' }, `Day: $${fmtMoney(total)}`));
  }
  nodes.push(
    h('div', { class: 'wr-footer' },
      h('div', { class: 'wr-summary' }, `${totalPoints} points · ${totalUnits} units`),
      h('div', { class: 'wr-week-total' }, `Total: $${fmtMoney(rangeTotal)}`)),
    h('button', { class: 'copy-excel-btn wr-copy-btn', 'data-action': 'wr-copy' },
      icon('copy', 16), ' Copy All for Excel'));
  body.replaceChildren(...nodes);
}

async function copyReport() {
  const { start, end } = getRange();
  try {
    const days = await api('GET', `/api/maps/${state.activeMapId}/report?start=${start}&end=${end}`);
    await clipCopy(days.map(dayToTsv).join(''));
    toast('success', 'Report copied to clipboard!');
  } catch (e) { toast('error', e.message); }
}

// Pulse the report button on Thursdays — report-due day.
export function initThursdayPulse() {
  const btn = document.getElementById('weekly-report-btn');
  if (btn && new Date().getDay() === 4) btn.classList.add('thursday-pulse');
}

export const actions = {
  'open-report': openReport,
  'close-report': closeReport,
  'wr-prev': () => shiftRange(-1),
  'wr-next': () => shiftRange(1),
  'wr-copy': copyReport,
};

export const changes = {
  'wr-range': loadReport,
};
