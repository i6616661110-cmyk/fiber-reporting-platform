const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'fiber-reports.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ────────────────────────────────────────────────────────────────────
//
// maps + map_units are shared by the whole crew; user_maps subscribes a splicer
// to a map. Everything below user_maps (work days, points, recorded units) is
// personal. point_units reference map_units by id, so editing a unit's name or
// price retroactively updates every total and report.

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS maps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS map_units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    price REAL NOT NULL DEFAULT 0 CHECK(price >= 0),
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS user_maps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, map_id)
  );

  CREATE TABLE IF NOT EXISTS work_days (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_map_id INTEGER NOT NULL REFERENCES user_maps(id) ON DELETE CASCADE,
    work_date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_day_id INTEGER NOT NULL REFERENCES work_days(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'New Point',
    feet_in INTEGER NOT NULL DEFAULT 0,
    feet_out INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS point_units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    point_id INTEGER NOT NULL REFERENCES points(id) ON DELETE CASCADE,
    map_unit_id INTEGER NOT NULL REFERENCES map_units(id),
    quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity BETWEEN 1 AND 199),
    sort_order INTEGER DEFAULT 0
  );
`;
db.exec(SCHEMA);

// Unit list a splicer starts from when they have no maps yet.
const DEFAULT_UNITS = [
  { name: 'UNIT805', price: 42.19 },
  { name: 'UNIT806', price: 45.56 },
  { name: 'UNIT807', price: 64.12 },
  { name: 'UNIT808', price: 27.0 },
  { name: 'UNIT813', price: 9.11 },
  { name: 'UNIT838', price: 37.12 },
  { name: '96 LCP Placement', price: 135.0 },
  { name: '288 LCP Placement', price: 135.0 },
];

// ─── Prepared statements ───────────────────────────────────────────────────────

const stmt = {
  // Users
  createUser: db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)'),
  getUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),

  // Maps / subscriptions
  getUserMaps: db.prepare(`
    SELECT m.id, m.name, um.id AS user_map_id, COALESCE(pc.cnt, 0) AS point_count
    FROM user_maps um
    JOIN maps m ON m.id = um.map_id
    LEFT JOIN (
      SELECT wd.user_map_id AS umid, COUNT(p.id) AS cnt
      FROM work_days wd JOIN points p ON p.work_day_id = wd.id
      GROUP BY wd.user_map_id
    ) pc ON pc.umid = um.id
    WHERE um.user_id = ?
    ORDER BY um.id
  `),
  getCatalog: db.prepare(`
    SELECT m.id, m.name, m.created_at, u.username AS created_by,
           (SELECT COUNT(*) FROM user_maps s WHERE s.map_id = m.id) AS subscribers
    FROM maps m
    LEFT JOIN users u ON u.id = m.created_by
    WHERE m.id NOT IN (SELECT map_id FROM user_maps WHERE user_id = ?)
    ORDER BY m.id DESC
  `),
  createMap: db.prepare('INSERT INTO maps (name, created_by) VALUES (?, ?)'),
  renameMap: db.prepare('UPDATE maps SET name = ? WHERE id = ?'),
  subscribe: db.prepare('INSERT INTO user_maps (user_id, map_id) VALUES (?, ?)'),
  getSubscription: db.prepare('SELECT * FROM user_maps WHERE user_id = ? AND map_id = ?'),
  deleteSubscription: db.prepare('DELETE FROM user_maps WHERE user_id = ? AND map_id = ?'),
  getMap: db.prepare('SELECT * FROM maps WHERE id = ?'),
  getLatestUserMap: db.prepare('SELECT map_id FROM user_maps WHERE user_id = ? ORDER BY id DESC LIMIT 1'),

  // Map units
  getMapUnits: db.prepare('SELECT id, name, price FROM map_units WHERE map_id = ? ORDER BY sort_order, id'),
  createMapUnit: db.prepare('INSERT INTO map_units (map_id, name, price, sort_order) VALUES (?, ?, ?, ?)'),
  updateMapUnit: db.prepare('UPDATE map_units SET name = ?, price = ?, sort_order = ? WHERE id = ? AND map_id = ?'),
  deleteMapUnit: db.prepare('DELETE FROM map_units WHERE id = ? AND map_id = ?'),
  mapUnitUseCount: db.prepare('SELECT COUNT(*) AS count FROM point_units WHERE map_unit_id = ?'),
  getMapUnit: db.prepare('SELECT * FROM map_units WHERE id = ?'),

  // Work days
  getWorkDays: db.prepare('SELECT id, work_date FROM work_days WHERE user_map_id = ? ORDER BY work_date DESC, id DESC'),
  createWorkDay: db.prepare('INSERT INTO work_days (user_map_id, work_date) VALUES (?, ?)'),
  updateWorkDay: db.prepare('UPDATE work_days SET work_date = ? WHERE id = ?'),
  deleteWorkDay: db.prepare('DELETE FROM work_days WHERE id = ?'),
  workDayOwner: db.prepare(`
    SELECT um.user_id, um.map_id FROM work_days wd
    JOIN user_maps um ON wd.user_map_id = um.id WHERE wd.id = ?
  `),

  // Points
  getPointsByDay: db.prepare('SELECT * FROM points WHERE work_day_id = ? ORDER BY sort_order, id'),
  createPoint: db.prepare('INSERT INTO points (work_day_id, name) VALUES (?, ?)'),
  updatePointName: db.prepare('UPDATE points SET name = ? WHERE id = ?'),
  updatePointFeet: db.prepare('UPDATE points SET feet_in = ?, feet_out = ? WHERE id = ?'),
  updatePointNote: db.prepare('UPDATE points SET note = ? WHERE id = ?'),
  deletePoint: db.prepare('DELETE FROM points WHERE id = ?'),
  pointOwner: db.prepare(`
    SELECT um.user_id, um.map_id FROM points p
    JOIN work_days wd ON p.work_day_id = wd.id
    JOIN user_maps um ON wd.user_map_id = um.id
    WHERE p.id = ?
  `),
  distinctPointNames: db.prepare(`
    SELECT DISTINCT p.name FROM points p
    JOIN work_days wd ON p.work_day_id = wd.id
    JOIN user_maps um ON wd.user_map_id = um.id
    WHERE um.user_id = ? AND p.name != 'New Point'
    ORDER BY p.name
  `),

  // Point units (recorded work, joined with shared unit definitions)
  getPointUnits: db.prepare(`
    SELECT pu.id, pu.point_id, pu.map_unit_id, pu.quantity, mu.name, mu.price
    FROM point_units pu JOIN map_units mu ON mu.id = pu.map_unit_id
    WHERE pu.point_id = ? ORDER BY pu.sort_order, pu.id
  `),
  createPointUnit: db.prepare('INSERT INTO point_units (point_id, map_unit_id, quantity) VALUES (?, ?, ?)'),
  updatePointUnit: db.prepare('UPDATE point_units SET map_unit_id = ?, quantity = ? WHERE id = ?'),
  deletePointUnit: db.prepare('DELETE FROM point_units WHERE id = ?'),
  pointUnitCount: db.prepare('SELECT COUNT(*) AS count FROM point_units WHERE point_id = ?'),
  pointUnitOwner: db.prepare(`
    SELECT um.user_id, um.map_id, pu.point_id FROM point_units pu
    JOIN points p ON pu.point_id = p.id
    JOIN work_days wd ON p.work_day_id = wd.id
    JOIN user_maps um ON wd.user_map_id = um.id
    WHERE pu.id = ?
  `),

  // Team view: every subscriber's work days on a map
  getTeamDays: db.prepare(`
    SELECT wd.id, wd.work_date, u.username
    FROM work_days wd
    JOIN user_maps um ON wd.user_map_id = um.id
    JOIN users u ON u.id = um.user_id
    WHERE um.map_id = ?
    ORDER BY wd.work_date DESC, wd.id DESC
  `),

  // Stats (per user, across all maps)
  monthlyStats: db.prepare(`
    SELECT strftime('%Y-%m', wd.work_date) AS period,
           COUNT(DISTINCT wd.id) AS days,
           COUNT(DISTINCT p.id) AS points,
           COALESCE(SUM(pu.quantity * mu.price), 0) AS total
    FROM work_days wd
    JOIN user_maps um ON wd.user_map_id = um.id
    JOIN points p ON p.work_day_id = wd.id
    LEFT JOIN point_units pu ON pu.point_id = p.id
    LEFT JOIN map_units mu ON mu.id = pu.map_unit_id
    WHERE um.user_id = ?
    GROUP BY period ORDER BY period DESC LIMIT 12
  `),
  weeklyStats: db.prepare(`
    SELECT strftime('%Y-W%W', wd.work_date) AS period,
           MIN(wd.work_date) AS week_start,
           MAX(wd.work_date) AS week_end,
           COUNT(DISTINCT wd.id) AS days,
           COUNT(DISTINCT p.id) AS points,
           COALESCE(SUM(pu.quantity * mu.price), 0) AS total
    FROM work_days wd
    JOIN user_maps um ON wd.user_map_id = um.id
    JOIN points p ON p.work_day_id = wd.id
    LEFT JOIN point_units pu ON pu.point_id = p.id
    LEFT JOIN map_units mu ON mu.id = pu.map_unit_id
    WHERE um.user_id = ?
    GROUP BY period ORDER BY period DESC LIMIT 12
  `),
};

// ─── Composite helpers ─────────────────────────────────────────────────────────

function pointWithUnits(point) {
  return { ...point, units: stmt.getPointUnits.all(point.id) };
}

// Full tree of one user's work on one map: days → points → units.
function getWorkTree(userId, mapId) {
  const sub = stmt.getSubscription.get(userId, mapId);
  if (!sub) return null;
  return stmt.getWorkDays.all(sub.id).map(day => ({
    ...day,
    points: stmt.getPointsByDay.all(day.id).map(pointWithUnits),
  }));
}

// Atomically create a shared map with its unit list and subscribe the creator.
const createMapWithUnits = db.transaction((userId, name, units) => {
  const mapId = stmt.createMap.run(name, userId).lastInsertRowid;
  units.forEach((u, i) => stmt.createMapUnit.run(mapId, u.name, u.price, i));
  stmt.subscribe.run(userId, mapId);
  return mapId;
});

// Apply a full edit of a map (rename + unit list diff) in one transaction.
// Throws a user-facing error if a removed unit is still referenced by recorded work.
const updateMapWithUnits = db.transaction((mapId, name, units) => {
  stmt.renameMap.run(name, mapId);
  const existing = stmt.getMapUnits.all(mapId);
  const keptIds = new Set(units.filter(u => u.id).map(u => u.id));
  for (const old of existing) {
    if (keptIds.has(old.id)) continue;
    const used = stmt.mapUnitUseCount.get(old.id).count;
    if (used > 0) {
      const err = new Error(`Unit "${old.name}" is used in ${used} recorded entr${used === 1 ? 'y' : 'ies'} and can't be removed`);
      err.isUserError = true;
      throw err;
    }
    stmt.deleteMapUnit.run(old.id, mapId);
  }
  units.forEach((u, i) => {
    if (u.id) stmt.updateMapUnit.run(u.name, u.price, i, u.id, mapId);
    else stmt.createMapUnit.run(mapId, u.name, u.price, i);
  });
});

// Unsubscribing deletes only the user's own work on the map (cascade through
// user_maps → work_days → points → point_units). The shared map entry stays.
function unsubscribe(userId, mapId) {
  return stmt.deleteSubscription.run(userId, mapId);
}

// Unit list to prefill the New Map dialog: the user's most recent map, or defaults.
function getStarterUnits(userId) {
  const latest = stmt.getLatestUserMap.get(userId);
  if (latest) {
    const units = stmt.getMapUnits.all(latest.map_id);
    if (units.length) return units.map(u => ({ name: u.name, price: u.price }));
  }
  return DEFAULT_UNITS;
}

// Team view: all subscribers' days on a map, newest first.
function getTeamTree(mapId) {
  return stmt.getTeamDays.all(mapId).map(day => ({
    ...day,
    points: stmt.getPointsByDay.all(day.id).map(pointWithUnits),
  }));
}

// One user's days on one map within [start, end], oldest first (for reports).
function getReportTree(userId, mapId, start, end) {
  const tree = getWorkTree(userId, mapId);
  if (!tree) return null;
  return tree
    .filter(d => d.work_date >= start && d.work_date <= end)
    .sort((a, b) => (a.work_date > b.work_date ? 1 : -1));
}

module.exports = {
  db,
  stmt,
  DEFAULT_UNITS,
  getWorkTree,
  createMapWithUnits,
  updateMapWithUnits,
  unsubscribe,
  getStarterUnits,
  getTeamTree,
  getReportTree,
};
