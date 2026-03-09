'use strict';

const express = require('express');
const cors = require('cors');
const swipesRouter = require('./routes/swipes');

const PORT = process.env.PORT || 3000;

const app = express();

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Swipe routes
app.use('/api/swipes', swipesRouter);

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
