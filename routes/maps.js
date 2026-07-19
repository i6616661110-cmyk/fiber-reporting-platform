const express = require('express');
const db = require('../db');
const { stmt } = db;

const router = express.Router();

// Parse and validate a [{id?, name, price}] unit list from the client.
// Returns null if anything is malformed.
function parseUnits(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 30) return null;
  const units = [];
  for (const u of raw) {
    const name = String(u.name || '').trim();
    const price = Math.round(parseFloat(u.price) * 100) / 100;
    if (!name || name.length > 60) return null;
    if (!Number.isFinite(price) || price < 0 || price > 99999) return null;
    units.push({ id: u.id ? Number(u.id) : null, name, price });
  }
  return units;
}

function requireSubscription(req, res, mapId) {
  const sub = stmt.getSubscription.get(req.userId, Number(mapId));
  if (!sub) res.status(404).json({ error: 'Map not found' });
  return sub;
}

// The user's own maps
router.get('/', (req, res) => {
  res.json(stmt.getUserMaps.all(req.userId));
});

// Shared catalog: maps the user hasn't added yet, newest first
router.get('/catalog', (req, res) => {
  res.json(stmt.getCatalog.all(req.userId));
});

// Unit list to prefill the New Map dialog
router.get('/starter-units', (req, res) => {
  res.json(db.getStarterUnits(req.userId));
});

// Create a shared map with its unit list, subscribing the creator
router.post('/', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Map name is required' });
  const units = parseUnits(req.body.units);
  if (!units) return res.status(400).json({ error: 'Each unit needs a name and a valid price' });

  const mapId = db.createMapWithUnits(req.userId, name, units);
  res.status(201).json({ id: mapId, name, units: stmt.getMapUnits.all(mapId) });
});

// Adopt an existing map from the catalog
router.post('/:id/subscribe', (req, res) => {
  const mapId = Number(req.params.id);
  if (!stmt.getMap.get(mapId)) return res.status(404).json({ error: 'Map not found' });
  if (stmt.getSubscription.get(req.userId, mapId)) {
    return res.status(409).json({ error: 'Map already added' });
  }
  stmt.subscribe.run(req.userId, mapId);
  res.status(201).json({ success: true });
});

// Edit a map: rename + full unit list (any subscriber may edit; changes are shared)
router.put('/:id', (req, res) => {
  const mapId = Number(req.params.id);
  if (!requireSubscription(req, res, mapId)) return;
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Map name is required' });
  const units = parseUnits(req.body.units);
  if (!units) return res.status(400).json({ error: 'Each unit needs a name and a valid price' });

  db.updateMapWithUnits(mapId, name, units);
  res.json({ id: mapId, name, units: stmt.getMapUnits.all(mapId) });
});

// Remove a map from the user's list: deletes only their own work days on it
router.delete('/:id', (req, res) => {
  const result = db.unsubscribe(req.userId, Number(req.params.id));
  if (result.changes === 0) return res.status(404).json({ error: 'Map not found' });
  res.json({ success: true });
});

// Unit definitions of one map
router.get('/:id/units', (req, res) => {
  const mapId = Number(req.params.id);
  if (!requireSubscription(req, res, mapId)) return;
  res.json(stmt.getMapUnits.all(mapId));
});

// Team view: every subscriber's work on this map, newest days first
router.get('/:id/team', (req, res) => {
  const mapId = Number(req.params.id);
  if (!requireSubscription(req, res, mapId)) return;
  res.json(db.getTeamTree(mapId));
});

module.exports = router;
