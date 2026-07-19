const express = require('express');
const db = require('../db');
const { stmt } = db;

const router = express.Router();

const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

// Report for any date range: the user's days on one map, oldest first
router.get('/maps/:mapId/report', (req, res) => {
  const { start, end } = req.query;
  if (!isDate(start) || !isDate(end)) {
    return res.status(400).json({ error: 'start and end dates are required (YYYY-MM-DD)' });
  }
  if (start > end) return res.status(400).json({ error: 'start date must not be after end date' });

  const tree = db.getReportTree(req.userId, Number(req.params.mapId), start, end);
  if (!tree) return res.status(404).json({ error: 'Map not found' });
  res.json(tree);
});

// Earnings overview for the account screen
router.get('/stats', (req, res) => {
  res.json({
    monthly: stmt.monthlyStats.all(req.userId),
    weekly: stmt.weeklyStats.all(req.userId),
  });
});

module.exports = router;
