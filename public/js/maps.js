// Shared maps: dropdown picker, map editor (name + unit prices), catalog, team view.
import { state } from './state.js';
import { api } from './api.js';
import { h, icon, toast, showConfirm, formatDate, fmtMoney, pointTotal, dayTotal } from './ui.js';
import { loadMap, renderDashboard, loadPointNames, closeEditDay } from './workday.js';

// ─── Loading & selection ───────────────────────────────────────────────────────

export async function loadMaps(selectId) {
  try {
    state.maps = await api('GET', '/api/maps');
    if (state.maps.length) {
      const saved = selectId ?? Number(localStorage.getItem('activeMapId'));
      const target = state.maps.find(m => m.id === saved) || state.maps[0];
      await loadMap(target.id);
    } else {
      state.activeMapId = null;
      state.days = [];
      state.mapUnits = [];
      renderDashboard();
    }
    renderTriggerLabel();
    loadPointNames();
  } catch (e) { toast('error', e.message); }
}

function renderTriggerLabel() {
  const map = state.maps.find(m => m.id === state.activeMapId);
  document.getElementById('map-trigger-label').textContent = map ? map.name : 'Maps';
}

async function selectMap(el) {
  closeMapDropdown();
  await loadMap(+el.dataset.id);
  renderTriggerLabel();
}

// ─── Dropdown ──────────────────────────────────────────────────────────────────

async function toggleDropdown() {
  const dd = document.getElementById('map-dropdown');
  if (dd.style.display !== 'none') return closeMapDropdown();
  try { state.maps = await api('GET', '/api/maps'); } catch (e) { /* show cached list */ }
  renderDropdownItems();
  dd.style.display = '';
}

export function closeMapDropdown() {
  document.getElementById('map-dropdown').style.display = 'none';
}

function renderDropdownItems() {
  const dd = document.getElementById('map-dropdown');
  dd.replaceChildren(
    ...state.maps.map(m =>
      h('div', { class: `map-dropdown-item${m.id === state.activeMapId ? ' active' : ''}`, 'data-action': 'select-map', 'data-id': m.id },
        h('span', null, h('span', { class: 'map-point-count' }, m.point_count || 0), m.name),
        h('span', { class: 'map-dropdown-item-actions' },
          h('button', { class: 'btn-icon', 'data-action': 'edit-map', 'data-id': m.id, title: 'Edit map & units' }, icon('edit', 12)),
          h('button', { class: 'btn-icon', 'data-action': 'team-view', 'data-id': m.id, title: 'Team view' }, icon('team', 12)),
          h('button', { class: 'btn-icon delete', 'data-action': 'delete-map', 'data-id': m.id, title: 'Remove from my maps' }, icon('x', 12))))),
    h('div', { class: 'map-dropdown-add', 'data-action': 'new-map' }, icon('plus', 14), ' New Map'));
}

// ─── Map editor modal (create / edit name + unit list) ─────────────────────────

let modalMapId = null; // null while creating a new map

async function openMapModal(mapId) {
  modalMapId = mapId;
  closeMapDropdown();
  const isNew = mapId == null;
  document.getElementById('map-modal-title').textContent = isNew ? 'New Map' : 'Edit Map';
  document.getElementById('map-catalog-section').style.display = 'none';

  let units;
  try {
    units = await api('GET', isNew ? '/api/maps/starter-units' : `/api/maps/${mapId}/units`);
  } catch (e) { return toast('error', e.message); }

  const nameInput = document.getElementById('map-name-input');
  nameInput.value = isNew ? '' : (state.maps.find(m => m.id === mapId)?.name || '');
  document.getElementById('map-units-editor').replaceChildren(...units.map(unitEditorRow));

  if (isNew) {
    try {
      const catalog = await api('GET', '/api/maps/catalog');
      if (catalog.length) {
        document.getElementById('map-catalog-list').replaceChildren(...catalog.map(catalogItem));
        document.getElementById('map-catalog-section').style.display = '';
      }
    } catch (e) { /* catalog is optional */ }
  }

  document.getElementById('map-modal').style.display = '';
  nameInput.focus();
}

function closeMapModal() {
  document.getElementById('map-modal').style.display = 'none';
}

function unitEditorRow(u = { name: '', price: '' }) {
  return h('div', { class: 'map-unit-row', 'data-unit-id': u.id || '' },
    h('input', { type: 'text', class: 'map-unit-name', placeholder: 'Unit name', maxlength: 60, value: u.name }),
    h('input', { type: 'number', class: 'map-unit-price', placeholder: '0.00', min: 0, step: '0.01', value: u.price }),
    h('button', { class: 'btn-icon delete', 'data-action': 'map-unit-remove', title: 'Remove unit' }, icon('x', 14)));
}

function catalogItem(m) {
  return h('div', { class: 'catalog-item', 'data-action': 'catalog-subscribe', 'data-id': m.id },
    h('div', null,
      h('div', { class: 'catalog-item-name' }, m.name),
      h('div', { class: 'catalog-item-meta' },
        `${m.subscribers} member${m.subscribers !== 1 ? 's' : ''}${m.created_by ? ` · by ${m.created_by}` : ''}`)),
    h('span', { class: 'catalog-item-add' }, '+ Add'));
}

async function saveMapModal() {
  const name = document.getElementById('map-name-input').value.trim();
  if (!name) return toast('error', 'Map name is required');

  const units = [...document.querySelectorAll('#map-units-editor .map-unit-row')].map(row => ({
    id: +row.dataset.unitId || undefined,
    name: row.querySelector('.map-unit-name').value.trim(),
    price: parseFloat(row.querySelector('.map-unit-price').value),
  }));
  if (!units.length) return toast('error', 'Add at least one unit');
  if (units.some(u => !u.name || !Number.isFinite(u.price) || u.price < 0)) {
    return toast('error', 'Each unit needs a name and a valid price');
  }

  try {
    if (modalMapId == null) {
      const created = await api('POST', '/api/maps', { name, units });
      closeMapModal();
      toast('success', 'Map created');
      await loadMaps(created.id);
    } else {
      await api('PUT', `/api/maps/${modalMapId}`, { name, units });
      closeMapModal();
      toast('success', 'Map updated');
      await loadMaps(modalMapId); // reload: renamed units/prices apply retroactively
    }
  } catch (e) { toast('error', e.message); }
}

async function subscribeFromCatalog(el) {
  try {
    await api('POST', `/api/maps/${+el.dataset.id}/subscribe`);
    closeMapModal();
    toast('success', 'Map added');
    await loadMaps(+el.dataset.id);
  } catch (e) { toast('error', e.message); }
}

function confirmRemoveMap(el) {
  const id = +el.dataset.id;
  closeMapDropdown();
  showConfirm('Remove Map?',
    'This deletes YOUR work days on this map. The shared map itself stays available to the team.',
    async () => {
      try {
        await api('DELETE', `/api/maps/${id}`);
        toast('success', 'Map removed');
        if (state.activeMapId === id) closeEditDay();
        localStorage.removeItem('activeMapId');
        await loadMaps();
      } catch (e) { toast('error', e.message); }
    });
}

// ─── Team view ─────────────────────────────────────────────────────────────────

async function openTeamView(el) {
  const mapId = +el.dataset.id || state.activeMapId;
  closeMapDropdown();
  if (!mapId) return toast('error', 'Select a map first');
  const map = state.maps.find(m => m.id === mapId);
  document.getElementById('team-map-name').textContent = map ? map.name : '';

  let days;
  try {
    days = await api('GET', `/api/maps/${mapId}/team`);
  } catch (e) { return toast('error', e.message); }

  renderTeam(days);
  document.getElementById('team-modal').style.display = '';
  document.body.style.overflow = 'hidden';
}

function closeTeamView() {
  document.getElementById('team-modal').style.display = 'none';
  document.body.style.overflow = '';
}

function renderTeam(days) {
  const body = document.getElementById('team-body');
  if (!days.length) {
    return body.replaceChildren(
      h('div', { class: 'empty-state' },
        h('h3', null, 'No work recorded yet'),
        h('p', null, 'Days logged by any crew member on this map will show up here.')));
  }

  let mapTotal = 0, totalPoints = 0, totalUnits = 0;
  const nodes = [];
  for (const day of days) {
    const total = dayTotal(day);
    mapTotal += total;
    nodes.push(h('div', { class: 'wr-day-header' },
      formatDate(day.work_date), ' — ', h('span', { class: 'team-user' }, day.username)));
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
  nodes.push(h('div', { class: 'wr-footer' },
    h('div', { class: 'wr-summary' }, `${totalPoints} points · ${totalUnits} units · all crew members`),
    h('div', { class: 'wr-week-total' }, `Map Total: $${fmtMoney(mapTotal)}`)));
  body.replaceChildren(...nodes);
}

// ─── Wiring ────────────────────────────────────────────────────────────────────

// Click outside the dialog closes the map editor.
document.getElementById('map-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('map-modal')) closeMapModal();
});

export const actions = {
  'toggle-map-dd': toggleDropdown,
  'select-map': selectMap,
  'new-map': () => openMapModal(null),
  'edit-map': el => openMapModal(+el.dataset.id),
  'delete-map': confirmRemoveMap,
  'team-view': openTeamView,
  'team-close': closeTeamView,
  'map-modal-close': closeMapModal,
  'map-modal-save': saveMapModal,
  'map-unit-add': () => document.getElementById('map-units-editor').appendChild(unitEditorRow()),
  'map-unit-remove': el => el.closest('.map-unit-row').remove(),
  'catalog-subscribe': subscribeFromCatalog,
};
