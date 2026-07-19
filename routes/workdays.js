const express = require('express');
const db = require('../db');
const { stmt } = db;

const MAX_UNITS_PER_POINT = 5;

const router = express.Router();

// ─── Ownership guards ──────────────────────────────────────────────────────────

function ownWorkDay(req, res, id) {
  const owner = stmt.workDayOwner.get(Number(id));
  if (!owner || owner.user_id !== req.userId) {
    res.status(404).json({ error: 'Work day not found' });
    return null;
  }
  return owner;
}

function ownPoint(req, res, id) {
  const owner = stmt.pointOwner.get(Number(id));
  if (!owner || owner.user_id !== req.userId) {
    res.status(404).json({ error: 'Point not found' });
    return null;
  }
  return owner;
}

function ownPointUnit(req, res, id) {
  const owner = stmt.pointUnitOwner.get(Number(id));
  if (!owner || owner.user_id !== req.userId) {
    res.status(404).json({ error: 'Unit not found' });
    return null;
  }
  return owner;
}

const clampFeet = v => Math.max(0, Math.min(99999, parseInt(v, 10) || 0));

// ─── Work days ─────────────────────────────────────────────────────────────────

// Full tree of the user's work on one map: days → points → units
router.get('/maps/:mapId/work-days', (req, res) => {
  const tree = db.getWorkTree(req.userId, Number(req.params.mapId));
  if (!tree) return res.status(404).json({ error: 'Map not found' });
  res.json(tree);
});

router.post('/work-days', (req, res) => {
  const { map_id, work_date } = req.body;
  if (!work_date) return res.status(400).json({ error: 'Date is required' });
  const sub = stmt.getSubscription.get(req.userId, Number(map_id));
  if (!sub) return res.status(404).json({ error: 'Map not found' });

  const result = stmt.createWorkDay.run(sub.id, work_date);
  res.status(201).json({ id: result.lastInsertRowid, work_date, points: [] });
});

router.put('/work-days/:id', (req, res) => {
  const { work_date } = req.body;
  if (!work_date) return res.status(400).json({ error: 'Date is required' });
  if (!ownWorkDay(req, res, req.params.id)) return;
  stmt.updateWorkDay.run(work_date, Number(req.params.id));
  res.json({ success: true });
});

router.delete('/work-days/:id', (req, res) => {
  if (!ownWorkDay(req, res, req.params.id)) return;
  stmt.deleteWorkDay.run(Number(req.params.id));
  res.json({ success: true });
});

// ─── Points ────────────────────────────────────────────────────────────────────

router.post('/work-days/:id/points', (req, res) => {
  if (!ownWorkDay(req, res, req.params.id)) return;
  const name = String(req.body.name || 'New Point').slice(0, 100);
  const result = stmt.createPoint.run(Number(req.params.id), name);
  res.status(201).json({
    id: result.lastInsertRowid,
    work_day_id: Number(req.params.id),
    name, feet_in: 0, feet_out: 0, note: '', units: [],
  });
});

// Partial update: any of name, feet_in/feet_out, note
router.put('/points/:id', (req, res) => {
  if (!ownPoint(req, res, req.params.id)) return;
  const id = Number(req.params.id);
  const { name, feet_in, feet_out, note } = req.body;

  if (name !== undefined) stmt.updatePointName.run(String(name).slice(0, 100), id);
  if (feet_in !== undefined || feet_out !== undefined) {
    stmt.updatePointFeet.run(clampFeet(feet_in), clampFeet(feet_out), id);
  }
  if (note !== undefined) stmt.updatePointNote.run(String(note).slice(0, 300), id);
  res.json({ success: true });
});

router.delete('/points/:id', (req, res) => {
  if (!ownPoint(req, res, req.params.id)) return;
  stmt.deletePoint.run(Number(req.params.id));
  res.json({ success: true });
});

// Distinct point names for autocomplete
router.get('/point-names', (req, res) => {
  res.json(stmt.distinctPointNames.all(req.userId).map(r => r.name));
});

// ─── Recorded units on a point ─────────────────────────────────────────────────

function validUnitForPoint(res, mapId, mapUnitId) {
  const unit = stmt.getMapUnit.get(Number(mapUnitId));
  if (!unit || unit.map_id !== mapId) {
    res.status(400).json({ error: 'Unknown unit type for this map' });
    return null;
  }
  return unit;
}

const clampQty = v => Math.max(1, Math.min(199, parseInt(v, 10) || 1));

router.post('/points/:id/units', (req, res) => {
  const owner = ownPoint(req, res, req.params.id);
  if (!owner) return;
  const pointId = Number(req.params.id);
  if (stmt.pointUnitCount.get(pointId).count >= MAX_UNITS_PER_POINT) {
    return res.status(400).json({ error: `Maximum ${MAX_UNITS_PER_POINT} units per point` });
  }
  const unit = validUnitForPoint(res, owner.map_id, req.body.map_unit_id);
  if (!unit) return;

  const quantity = clampQty(req.body.quantity);
  const result = stmt.createPointUnit.run(pointId, unit.id, quantity);
  res.status(201).json({
    id: result.lastInsertRowid,
    point_id: pointId,
    map_unit_id: unit.id,
    quantity,
    name: unit.name,
    price: unit.price,
  });
});

router.put('/point-units/:id', (req, res) => {
  const owner = ownPointUnit(req, res, req.params.id);
  if (!owner) return;
  const unit = validUnitForPoint(res, owner.map_id, req.body.map_unit_id);
  if (!unit) return;

  const quantity = clampQty(req.body.quantity);
  stmt.updatePointUnit.run(unit.id, quantity, Number(req.params.id));
  res.json({ success: true, name: unit.name, price: unit.price });
});

router.delete('/point-units/:id', (req, res) => {
  if (!ownPointUnit(req, res, req.params.id)) return;
  stmt.deletePointUnit.run(Number(req.params.id));
  res.json({ success: true });
});

module.exports = router;
