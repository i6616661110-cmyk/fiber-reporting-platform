const express = require('express');
const path = require('path');

const { router: authRouter, authMiddleware } = require('./routes/auth');
const mapsRouter = require('./routes/maps');
const workdaysRouter = require('./routes/workdays');
const reportsRouter = require('./routes/reports');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRouter);
app.use('/api/maps', authMiddleware, mapsRouter);
app.use('/api', authMiddleware, workdaysRouter);
app.use('/api', authMiddleware, reportsRouter);

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Central error handler: user-facing validation errors → 400, the rest → 500
app.use((err, req, res, next) => {
  if (err.isUserError) return res.status(400).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

app.listen(PORT, () => {
  console.log(`\n  Fiber field-reporting platform running at http://localhost:${PORT}\n`);
});
