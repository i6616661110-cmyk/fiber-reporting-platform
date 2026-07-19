// App bootstrap: auth, views, theme, account stats, and the delegated event wiring
// that connects data-action / data-change attributes to their handlers.
import { state } from './state.js';
import { api, setUnauthorizedHandler } from './api.js';
import { h, toast, fmtMoney, fmtShort } from './ui.js';
import * as workday from './workday.js';
import * as maps from './maps.js';
import * as report from './report.js';

let authMode = 'login';

// ─── Views ─────────────────────────────────────────────────────────────────────

const show = (id, visible) => { document.getElementById(id).style.display = visible ? '' : 'none'; };

function showAuth() {
  show('auth-view', true); show('dashboard-view', false); show('account-view', false);
}

function showDashboard() {
  show('auth-view', false); show('dashboard-view', true); show('account-view', false);
  document.getElementById('username-display').textContent = state.username || '';
}

// ─── Theme ─────────────────────────────────────────────────────────────────────

function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  document.getElementById('theme-icon-moon').style.display = t === 'dark' ? '' : 'none';
  document.getElementById('theme-icon-sun').style.display = t === 'light' ? '' : 'none';
}

function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  localStorage.setItem('theme', next);
  applyTheme(next);
}

// ─── Auth ──────────────────────────────────────────────────────────────────────

function switchAuthTab(mode) {
  authMode = mode;
  document.getElementById('tab-login').classList.toggle('active', mode === 'login');
  document.getElementById('tab-register').classList.toggle('active', mode === 'register');
  document.getElementById('auth-btn-text').textContent = mode === 'login' ? 'Sign In' : 'Create Account';
  show('auth-error', false);
}

async function handleAuth(e) {
  e.preventDefault();
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value;
  if (!username || !password) return;

  const errorEl = document.getElementById('auth-error');
  show('auth-error', false); show('auth-btn-text', false); show('auth-btn-loading', true);
  try {
    const data = await api('POST', `/api/auth/${authMode}`, { username, password });
    state.token = data.token;
    state.username = data.username;
    localStorage.setItem('token', data.token);
    localStorage.setItem('username', data.username);
    showDashboard();
    maps.loadMaps();
    report.initThursdayPulse();
    toast('success', `Welcome${authMode === 'register' ? '' : ' back'}, ${data.username}!`);
  } catch (err) {
    errorEl.textContent = err.message;
    show('auth-error', true);
  } finally {
    show('auth-btn-text', true); show('auth-btn-loading', false);
  }
}

function logout() {
  Object.assign(state, {
    token: null, username: null, maps: [], activeMapId: null,
    mapUnits: [], days: [], pointNames: [], editingDayId: null,
  });
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  workday.closeEditDay();
  showAuth();
  document.getElementById('auth-form').reset();
}

setUnauthorizedHandler(logout);

// ─── Account stats ─────────────────────────────────────────────────────────────

async function showAccount() {
  show('dashboard-view', false); show('account-view', true);
  document.getElementById('account-username').textContent = state.username || '';
  try {
    renderStats(await api('GET', '/api/stats'));
  } catch (e) { toast('error', e.message); }
}

function closeAccount() {
  show('account-view', false); show('dashboard-view', true);
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function statsRow(period, meta, total) {
  return h('div', { class: 'stats-row' },
    h('div', { class: 'stats-row-period' }, period),
    h('div', { class: 'stats-row-meta' }, meta),
    h('div', { class: 'stats-row-total' }, `$${fmtMoney(total)}`));
}

function renderStats({ monthly, weekly }) {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thisMonth = monthly.find(m => m.period === monthKey);
  const thisWeek = weekly[0] || null;
  const allTime = monthly.reduce((s, m) => s + (m.total || 0), 0);

  const card = (label, value, accent) =>
    h('div', { class: `stat-card${accent ? ' accent' : ''}` },
      h('div', { class: 'stat-label' }, label),
      h('div', { class: 'stat-value' }, `$${fmtMoney(value)}`));

  document.getElementById('stats-summary').replaceChildren(
    card('All Time', allTime),
    card('This Month', thisMonth ? thisMonth.total : 0, true),
    card('This Week', thisWeek ? thisWeek.total : 0));

  const plural = n => `${n} day${n !== 1 ? 's' : ''}`;
  document.getElementById('monthly-stats').replaceChildren(
    ...(monthly.length
      ? monthly.map(m => {
          const [y, mo] = m.period.split('-');
          return statsRow(`${MONTH_NAMES[+mo - 1]} ${y}`, `${plural(m.days)} · ${m.points} pts`, m.total);
        })
      : [h('p', { class: 'stats-empty' }, 'No data yet')]));

  document.getElementById('weekly-stats').replaceChildren(
    ...(weekly.length
      ? weekly.map(w =>
          statsRow(`${fmtShort(w.week_start)} – ${fmtShort(w.week_end)}`, `${plural(w.days)} · ${w.points} pts`, w.total))
      : [h('p', { class: 'stats-empty' }, 'No data yet')]));
}

// ─── Delegated event wiring ────────────────────────────────────────────────────

const actions = {
  ...workday.actions,
  ...maps.actions,
  ...report.actions,
  'toggle-theme': toggleTheme,
  'auth-tab': el => switchAuthTab(el.dataset.mode),
  logout,
  'show-account': showAccount,
  'close-account': closeAccount,
};

const changes = { ...workday.changes, ...report.changes };

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) return actions[el.dataset.action](el, e);
  // Clicks elsewhere close open popovers
  if (!e.target.closest('.point-name-wrapper')) workday.closeAllAutocomplete();
  if (!e.target.closest('.map-dropdown-wrap')) maps.closeMapDropdown();
});

document.addEventListener('change', e => {
  const el = e.target.closest('[data-change]');
  if (el && changes[el.dataset.change]) changes[el.dataset.change](el, e);
});

document.addEventListener('input', e => {
  if (e.target.matches('[data-input="point-ac"]')) workday.showAutocomplete(e.target);
});
document.addEventListener('focusin', e => {
  if (e.target.matches('[data-input="point-ac"]')) workday.showAutocomplete(e.target);
});
document.addEventListener('focusout', e => {
  if (e.target.matches('[data-input="point-ac"]')) setTimeout(workday.closeAllAutocomplete, 150);
});

// ─── Init ──────────────────────────────────────────────────────────────────────

applyTheme(localStorage.getItem('theme') || 'dark');
document.getElementById('auth-form').addEventListener('submit', handleAuth);

if (state.token) {
  showDashboard();
  maps.loadMaps();
  report.initThursdayPulse();
} else {
  showAuth();
}
