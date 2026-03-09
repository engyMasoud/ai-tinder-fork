'use strict';

const express = require('express');
const db = require('../db');
const { vapidKeys } = require('../vapid');

const router = express.Router();

// GET /api/push/vapid-public-key — return the VAPID public key for client subscription
router.get('/vapid-public-key', (_req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

// POST /api/push/subscribe — store a push subscription for a user
router.post('/subscribe', (req, res) => {
  const { userId, subscription } = req.body;

  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    return res.status(400).json({ error: 'userId is required and must be a non-empty string.' });
  }
  if (!subscription || typeof subscription !== 'object' || !subscription.endpoint) {
    return res.status(400).json({ error: 'subscription must be a valid push subscription object with an endpoint.' });
  }

  const cleanUserId = userId.trim();
  const subscriptionJson = JSON.stringify(subscription);
  const createdAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO push_subscriptions (user_id, subscription, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET subscription = excluded.subscription
  `).run(cleanUserId, subscriptionJson, createdAt);

  return res.status(201).json({ message: 'Subscribed successfully.' });
});

// DELETE /api/push/subscribe — remove a push subscription
router.delete('/subscribe', (req, res) => {
  const { userId } = req.body;

  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    return res.status(400).json({ error: 'userId is required and must be a non-empty string.' });
  }

  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(userId.trim());
  return res.json({ message: 'Unsubscribed successfully.' });
});

module.exports = router;
