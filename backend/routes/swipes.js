'use strict';

const express = require('express');
const db = require('../db');

const router = express.Router();

const VALID_ACTIONS = new Set(['like', 'nope', 'superlike']);

// POST /api/swipes — record a swipe action
router.post('/', (req, res) => {
  const { profileId, profileName, action } = req.body;

  if (!profileId || typeof profileId !== 'string' || profileId.trim() === '') {
    return res.status(400).json({ error: 'profileId is required and must be a non-empty string.' });
  }
  if (!profileName || typeof profileName !== 'string' || profileName.trim() === '') {
    return res.status(400).json({ error: 'profileName is required and must be a non-empty string.' });
  }
  if (!action || !VALID_ACTIONS.has(action)) {
    return res.status(400).json({ error: `action must be one of: ${[...VALID_ACTIONS].join(', ')}.` });
  }

  const cleanId = profileId.trim();
  const cleanName = profileName.trim();
  const swipedAt = new Date().toISOString();

  const stmt = db.prepare(
    'INSERT INTO swipes (profile_id, profile_name, action, swiped_at) VALUES (?, ?, ?, ?)'
  );
  const result = stmt.run(cleanId, cleanName, action, swipedAt);

  return res.status(201).json({
    id: result.lastInsertRowid,
    profileId: cleanId,
    profileName: cleanName,
    action,
    swipedAt,
  });
});

// GET /api/swipes — return all recorded swipes (newest first)
router.get('/', (req, res) => {
  const rows = db.prepare(
    `SELECT
       id,
       profile_id   AS profileId,
       profile_name AS profileName,
       action,
       swiped_at    AS swipedAt
     FROM swipes
     ORDER BY id DESC`
  ).all();

  return res.json({ swipes: rows });
});

// GET /api/swipes/stats — return counts grouped by action
router.get('/stats', (req, res) => {
  const rows = db.prepare(
    'SELECT action, COUNT(*) AS count FROM swipes GROUP BY action'
  ).all();

  const stats = { like: 0, nope: 0, superlike: 0, total: 0 };

  for (const row of rows) {
    stats[row.action] = Number(row.count);
    stats.total += Number(row.count);
  }

  return res.json(stats);
});

module.exports = router;
