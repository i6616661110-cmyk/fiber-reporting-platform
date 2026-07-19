// Work-day dashboard + full-screen day editor: points, feet, notes, recorded units.
import { state, findDay, findPoint, findPointUnit, activeMap } from './state.js';
import { api } from './api.js';
import {
  h, icon, toast, showConfirm, clipCopy,
  formatDate, isThursday, todayStr, fmtMoney, pointTotal, dayTotal,
} from './ui.js';

const MAX_UNITS = 5;

// ─── Loading ───────────────────────────────────────────────────────────────────

export async function loadMap(mapId) {
  state.activeMapId = mapId;
  localStorage.setItem('activeMapId', mapId);
  try {
    [state.mapUnits, state.days] = await Promise.all([
      api('GET', `/api/maps/${mapId}/units`),
      api('GET', `/api/maps/${mapId}/work-days`),
    ]);
  } catch (e) {
    toast('error', e.message);
    return;
  }
  renderDashboard();
}

export async function loadPointNames() {
  try {
    state.pointNames = await api('GET', '/api/point-names');
  } catch (e) { /* autocomplete is best-effort */ }
}

function sortDays() {
  state.days.sort((a, b) =>
    a.work_date > b.work_date ? -1 : a.work_date < b.work_date ? 1 : b.id - a.id);
}

// ─── Dashboard (collapsed day cards) ───────────────────────────────────────────

export function renderDashboard() {
  const container = document.getElementById('days-container');
  const empty = document.getElementById('empty-state');
  const noMap = document.getElementById('no-map-state');
  const addBtn = document.getElementById('add-day-btn');
  const heading = document.getElementById('map-heading');
  const map = activeMap();

  if (!map) {
    container.replaceChildren();
    empty.style.display = 'none';
    noMap.style.display = '';
    addBtn.style.display = 'none';
    heading.textContent = 'Work Entries';
    return;
  }
  noMap.style.display = 'none';
  addBtn.style.display = '';
  heading.textContent = map.name;
  empty.style.display = state.days.length ? 'none' : '';
  container.replaceChildren(...state.days.map(dayCard));
}

function dayCard(day) {
  const pts = day.points.length;
  const units = day.points.reduce((s, p) => s + p.units.length, 0);
  return h('div', { class: `date-group${isThursday(day.work_date) ? ' thursday' : ''}` },
    h('div', { class: 'date-group-summary', 'data-action': 'open-day', 'data-id': day.id },
      h('span', { class: 'date-icon' }, icon('calendar', 20)),
      h('div', { class: 'date-group-summary-info' },
        h('div', { class: 'date-group-summary-date' }, formatDate(day.work_date)),
        h('div', { class: 'date-group-summary-meta' },
          `${pts} point${pts !== 1 ? 's' : ''} · ${units} unit${units !== 1 ? 's' : ''}`)),
      h('span', { class: 'date-group-summary-total' }, `$${fmtMoney(dayTotal(day))}`),
      h('div', { class: 'date-group-summary-actions' },
        h('button', { class: 'btn-icon', 'data-action': 'open-day', 'data-id': day.id, title: 'Edit day' }, icon('edit', 16)),
        h('button', { class: 'btn-icon delete', 'data-action': 'delete-day', 'data-id': day.id, title: 'Delete' }, icon('trash', 16)))));
}

// ─── Day editor modal ──────────────────────────────────────────────────────────

export function openEditDay(id) {
  state.editingDayId = id;
  renderEditBody();
  document.getElementById('edit-modal').style.display = '';
  document.body.style.overflow = 'hidden';
}

export function closeEditDay() {
  state.editingDayId = null;
  document.getElementById('edit-modal').style.display = 'none';
  document.body.style.overflow = '';
  renderDashboard();
}

function renderEditBody() {
  const day = findDay(state.editingDayId);
  if (!day) return;
  document.getElementById('edit-modal-map').textContent = activeMap()?.name || '';
  document.getElementById('edit-modal-date').textContent = formatDate(day.work_date);
  document.getElementById('edit-modal-body').replaceChildren(
    h('div', { class: 'edit-date-row' },
      h('span', { class: 'date-icon' }, icon('calendar', 18)),
      h('input', { type: 'date', class: 'date-input', value: day.work_date, 'data-change': 'day-date', 'data-id': day.id })),
    ...day.points.map((pt, i) => pointCard(day, pt, i)),
    h('button', { class: 'add-point-btn', 'data-action': 'add-point', 'data-id': day.id }, icon('plus', 16), ' Add Point'),
    h('div', { class: 'edit-modal-footer' },
      h('div', { class: 'daily-total' },
        h('span', { class: 'daily-total-label' }, 'Daily Total:'),
        h('span', { class: 'daily-total-value' }, `$${fmtMoney(dayTotal(day))}`)),
      h('button', { class: 'copy-excel-btn', 'data-action': 'copy-day-excel', 'data-id': day.id },
        icon('copy', 16), ' Copy for Excel')));
}

function unitRow(u) {
  return h('div', { class: 'unit-row' },
    h('select', { 'data-change': 'unit-type', 'data-id': u.id, title: 'Type' },
      state.mapUnits.map(mu =>
        h('option', { value: mu.id, selected: mu.id === u.map_unit_id }, mu.name))),
    h('select', { 'data-change': 'unit-qty', 'data-id': u.id, title: 'Qty' },
      Array.from({ length: 199 }, (_, i) =>
        h('option', { value: i + 1, selected: i + 1 === u.quantity }, i + 1))),
    h('button', { class: 'btn-icon delete', 'data-action': 'delete-unit', 'data-id': u.id, title: 'Remove' }, icon('x', 14)));
}

function pointCard(day, pt, idx) {
  const canAdd = pt.units.length < MAX_UNITS;
  return h('div', { class: 'point-card', 'data-point-id': pt.id },
    h('div', { class: 'point-header' },
      h('span', { class: 'point-number' }, `#${idx + 1}`),
      h('span', { class: 'point-icon' }, icon('pin', 16)),
      h('div', { class: 'point-name-wrapper' },
        h('input', {
          type: 'text', class: 'point-name-input', value: pt.name,
          placeholder: 'Point name', autocomplete: 'off',
          'data-change': 'point-name', 'data-input': 'point-ac', 'data-id': pt.id,
        })),
      h('button', { class: 'copy-name-btn', 'data-action': 'copy-point-name', 'data-id': pt.id, title: 'Copy name' }, icon('copy', 14)),
      h('div', { class: 'point-actions' },
        h('button', { class: 'btn-icon delete', 'data-action': 'delete-point', 'data-id': pt.id, title: 'Delete point' }, icon('trash', 16)))),
    h('div', { class: 'feet-row' },
      h('span', { class: 'feet-label' }, 'Feet:'),
      h('input', { type: 'number', class: 'feet-input', value: pt.feet_in || '', min: 0, max: 99999, placeholder: 'In', title: 'Feet In', 'data-change': 'feet-in', 'data-id': pt.id }),
      h('span', { class: 'feet-sep' }, '/'),
      h('input', { type: 'number', class: 'feet-input', value: pt.feet_out || '', min: 0, max: 99999, placeholder: 'Out', title: 'Feet Out', 'data-change': 'feet-out', 'data-id': pt.id })),
    h('div', { class: 'units-container' },
      pt.units.map(unitRow),
      h('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap' },
        h('button', { class: `add-unit-btn${canAdd ? '' : ' disabled'}`, disabled: !canAdd, 'data-action': 'add-unit', 'data-id': pt.id },
          icon('plus', 14), canAdd ? ' Add Unit' : ` Max ${MAX_UNITS}`),
        h('button', { class: 'copy-point-btn', 'data-action': 'copy-point', 'data-id': pt.id, title: 'Copy point details' },
          icon('copy', 14), ' Copy Point'))),
    h('div', { class: 'note-row' },
      h('textarea', { class: 'note-input', maxlength: 300, placeholder: 'Add a note...', 'data-change': 'point-note', 'data-id': pt.id }, pt.note || '')),
    h('div', { class: 'point-total' },
      h('span', { class: 'point-total-label' }, 'Point Total:'),
      ` $${fmtMoney(pointTotal(pt))}`));
}

// ─── Day CRUD ──────────────────────────────────────────────────────────────────

async function addDay() {
  if (!state.activeMapId) return toast('error', 'Select or create a map first');
  try {
    const day = await api('POST', '/api/work-days', { map_id: state.activeMapId, work_date: todayStr() });
    state.days.unshift(day);
    sortDays();
    renderDashboard();
    openEditDay(day.id);
    toast('success', 'Work day added');
  } catch (e) { toast('error', e.message); }
}

async function changeDayDate(el) {
  const id = +el.dataset.id;
  if (!el.value) return;
  try {
    await api('PUT', `/api/work-days/${id}`, { work_date: el.value });
    const day = findDay(id);
    if (day) day.work_date = el.value;
    sortDays();
    if (state.editingDayId === id) renderEditBody();
  } catch (e) { toast('error', e.message); }
}

function confirmDeleteDay(el) {
  const id = +el.dataset.id;
  showConfirm('Delete Work Day?', 'This will permanently delete all points and units for this day.', async () => {
    try {
      await api('DELETE', `/api/work-days/${id}`);
      state.days = state.days.filter(d => d.id !== id);
      if (state.editingDayId === id) closeEditDay();
      renderDashboard();
      toast('success', 'Work day deleted');
    } catch (e) { toast('error', e.message); }
  });
}

// ─── Point CRUD ────────────────────────────────────────────────────────────────

async function addPoint(el) {
  const dayId = +el.dataset.id;
  try {
    const pt = await api('POST', `/api/work-days/${dayId}/points`, { name: 'New Point' });
    const day = findDay(dayId);
    if (day) day.points.push(pt);
    if (state.editingDayId === dayId) {
      renderEditBody();
      const input = document.querySelector(`[data-point-id="${pt.id}"] .point-name-input`);
      if (input) { input.focus(); input.select(); }
    }
  } catch (e) { toast('error', e.message); }
}

async function renamePoint(pointId, name) {
  try {
    await api('PUT', `/api/points/${pointId}`, { name });
    const found = findPoint(pointId);
    if (found) found.point.name = name;
    if (name && name !== 'New Point' && !state.pointNames.includes(name)) state.pointNames.push(name);
    if (state.editingDayId) renderEditBody();
  } catch (e) { toast('error', e.message); }
}

function confirmDeletePoint(el) {
  const id = +el.dataset.id;
  showConfirm('Delete Point?', 'This will permanently delete this point and all its units.', async () => {
    try {
      await api('DELETE', `/api/points/${id}`);
      const found = findPoint(id);
      if (found) found.day.points = found.day.points.filter(p => p.id !== id);
      if (state.editingDayId) renderEditBody();
      toast('success', 'Point deleted');
    } catch (e) { toast('error', e.message); }
  });
}

async function changeFeet(el, side) {
  const found = findPoint(+el.dataset.id);
  if (!found) return;
  const { point } = found;
  const clamped = Math.max(0, Math.min(99999, parseInt(el.value, 10) || 0));
  const feet = {
    feet_in: side === 'in' ? clamped : point.feet_in || 0,
    feet_out: side === 'out' ? clamped : point.feet_out || 0,
  };
  try {
    await api('PUT', `/api/points/${point.id}`, feet);
    Object.assign(point, feet);
  } catch (e) { toast('error', e.message); }
}

async function changeNote(el) {
  const found = findPoint(+el.dataset.id);
  if (!found) return;
  const note = (el.value || '').slice(0, 300);
  try {
    await api('PUT', `/api/points/${found.point.id}`, { note });
    found.point.note = note;
  } catch (e) { toast('error', e.message); }
}

// ─── Recorded units ────────────────────────────────────────────────────────────

async function addUnit(el) {
  const found = findPoint(+el.dataset.id);
  if (!found) return;
  if (!state.mapUnits.length) return toast('error', 'This map has no units defined — edit the map first');
  try {
    const unit = await api('POST', `/api/points/${found.point.id}/units`,
      { map_unit_id: state.mapUnits[0].id, quantity: 1 });
    found.point.units.push(unit);
    if (state.editingDayId) renderEditBody();
  } catch (e) { toast('error', e.message); }
}

async function changeUnit(el, field) {
  const found = findPointUnit(+el.dataset.id);
  if (!found) return;
  const { unit } = found;
  const payload = {
    map_unit_id: field === 'type' ? +el.value : unit.map_unit_id,
    quantity: field === 'qty' ? +el.value : unit.quantity,
  };
  try {
    const res = await api('PUT', `/api/point-units/${unit.id}`, payload);
    Object.assign(unit, payload, { name: res.name, price: res.price });
    if (state.editingDayId) renderEditBody();
  } catch (e) { toast('error', e.message); }
}

async function deleteUnit(el) {
  const id = +el.dataset.id;
  try {
    await api('DELETE', `/api/point-units/${id}`);
    const found = findPointUnit(id);
    if (found) found.point.units = found.point.units.filter(u => u.id !== id);
    if (state.editingDayId) renderEditBody();
  } catch (e) { toast('error', e.message); }
}

// ─── Copy to clipboard ─────────────────────────────────────────────────────────

async function copyPointName(el) {
  const found = findPoint(+el.dataset.id);
  if (!found) return;
  await clipCopy(found.point.name);
  const tip = h('span', { class: 'copy-tooltip' }, 'Copied!');
  el.appendChild(tip);
  setTimeout(() => tip.remove(), 1200);
}

// Plain-text summary of one point, pasted into the PDF redlines.
async function copyPointDetails(el) {
  const found = findPoint(+el.dataset.id);
  if (!found) return;
  const pt = found.point;
  let txt = pt.name + '\n';
  for (const u of pt.units) txt += `${u.name} - ${u.quantity}\n`;
  if (pt.feet_in > 0 || pt.feet_out > 0) txt += `${pt.feet_in || 0}/${pt.feet_out || 0}\n`;
  if (pt.note && pt.note.trim()) txt += pt.note.trim() + '\n';
  await clipCopy(txt.trim());
  toast('success', 'Point details copied!');
}

// One day as TSV (point / unit / qty), pasted straight into the Excel report.
export function dayToTsv(day) {
  let tsv = '';
  for (const pt of day.points) {
    if (!pt.units.length) { tsv += `${pt.name}\t\t\n`; continue; }
    pt.units.forEach((u, i) => {
      tsv += i === 0 ? `${pt.name}\t${u.name}\t${u.quantity}\n` : `\t${u.name}\t${u.quantity}\n`;
    });
  }
  return tsv;
}

async function copyDayExcel(el) {
  const day = findDay(+el.dataset.id);
  if (!day) return;
  await clipCopy(dayToTsv(day));
  toast('success', 'Copied to clipboard!');
}

// ─── Point-name autocomplete ───────────────────────────────────────────────────

export function showAutocomplete(el) {
  const wrapper = el.closest('.point-name-wrapper');
  let dd = wrapper.querySelector('.autocomplete-dropdown');
  if (!dd) {
    dd = h('div', { class: 'autocomplete-dropdown' });
    wrapper.appendChild(dd);
  }
  const q = el.value.toLowerCase();
  const matches = state.pointNames.filter(n => n.toLowerCase().includes(q) && n !== el.value);
  if (!matches.length) return dd.classList.remove('visible');

  dd.replaceChildren(...matches.slice(0, 12).map(name => {
    const item = h('div', { class: 'autocomplete-item' }, name);
    // mousedown fires before the input's blur, so the click isn't lost
    item.addEventListener('mousedown', () => {
      closeAllAutocomplete();
      el.value = name;
      renamePoint(+el.dataset.id, name);
    });
    return item;
  }));
  dd.classList.add('visible');
}

export function closeAllAutocomplete() {
  document.querySelectorAll('.autocomplete-dropdown').forEach(d => d.classList.remove('visible'));
}

// ─── Delegated handler tables (wired up in main.js) ────────────────────────────

export const actions = {
  'add-day': addDay,
  'open-day': el => openEditDay(+el.dataset.id),
  'delete-day': confirmDeleteDay,
  'close-edit': closeEditDay,
  'add-point': addPoint,
  'delete-point': confirmDeletePoint,
  'copy-point-name': copyPointName,
  'copy-point': copyPointDetails,
  'add-unit': addUnit,
  'delete-unit': deleteUnit,
  'copy-day-excel': copyDayExcel,
};

export const changes = {
  'day-date': changeDayDate,
  'point-name': el => renamePoint(+el.dataset.id, el.value),
  'feet-in': el => changeFeet(el, 'in'),
  'feet-out': el => changeFeet(el, 'out'),
  'point-note': changeNote,
  'unit-type': el => changeUnit(el, 'type'),
  'unit-qty': el => changeUnit(el, 'qty'),
};
