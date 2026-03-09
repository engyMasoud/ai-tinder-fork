'use strict';

const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

const KEYS_PATH = process.env.VAPID_KEYS_PATH || path.join(__dirname, 'vapid_keys.json');

function loadOrGenerateKeys() {
  if (fs.existsSync(KEYS_PATH)) {
    return JSON.parse(fs.readFileSync(KEYS_PATH, 'utf8'));
  }
  const keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(KEYS_PATH, JSON.stringify(keys, null, 2));
  return keys;
}

const vapidKeys = loadOrGenerateKeys();

webpush.setVapidDetails(
  'mailto:admin@example.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

module.exports = { webpush, vapidKeys };
