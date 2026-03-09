'use strict';

const express = require('express');
const db = require('../db');
const { webpush } = require('../vapid');

const router = express.Router();

const VALID_ACTIONS = new Set(['like', 'nope', 'superlike']);

// Match probability per action
const MATCH_CHANCE = { like: 0.3, superlike: 0.6 };

async function sendMatchNotification(userId, profileName) {
  const row = db.prepare(
    'SELECT subscription FROM push_subscriptions WHERE user_id = ?'
  ).get(userId);

  if (!row) return;

  const payload = JSON.stringify({
    title: "It's a Match! 🎉",
    body: `You and ${profileName} liked each other!`,
    url: '/',
  });

  try {
    await webpush.sendNotification(JSON.parse(row.subscription), payload);
  } catch (err) {
    // Subscription may be expired or invalid — remove it
    if (err.statusCode === 404 || err.statusCode === 410) {
      db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(userId);
    } else {
      console.error('Push notification error:', err.message);
    }
  }
}

// POST /api/swipes — record a swipe action
router.post('/', async (req, res) => {
  const { profileId, profileName, action, userId } = req.body;

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
  const cleanUserId = userId && typeof userId === 'string' ? userId.trim() : null;
  const swipedAt = new Date().toISOString();

  const stmt = db.prepare(
    'INSERT INTO swipes (profile_id, profile_name, action, swiped_at) VALUES (?, ?, ?, ?)'
  );
  const result = stmt.run(cleanId, cleanName, action, swipedAt);

  // Simulate match for like/superlike and send push notification if subscribed
  const chance = MATCH_CHANCE[action];
  const isMatch = chance !== undefined && Math.random() < chance;

  if (isMatch && cleanUserId) {
    // Fire-and-forget — don't block the response
    sendMatchNotification(cleanUserId, cleanName).catch(err =>
      console.error('Match notification failed:', err.message)
    );
  }

  return res.status(201).json({
    id: result.lastInsertRowid,
    profileId: cleanId,
    profileName: cleanName,
    action,
    swipedAt,
    matched: isMatch,
  });
});

// GET /api/swipes — return all recorded swipes (newest first)
router.get('/', (_req, res) => {
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
router.get('/stats', (_req, res) => {
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
