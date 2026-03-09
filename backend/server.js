'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const swipesRouter = require('./routes/swipes');
const pushRouter = require('./routes/push');

const PORT = process.env.PORT || 3000;

const app = express();

app.use(cors());
app.use(express.json());

// Serve frontend static files from the project root
app.use(express.static(path.join(__dirname, '..')));

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Swipe routes
app.use('/api/swipes', swipesRouter);

// Push notification routes
app.use('/api/push', pushRouter);

// 404 handler
app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

// Global error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Snow-day backend running on http://localhost:${PORT}`);
  });
}

module.exports = app;
