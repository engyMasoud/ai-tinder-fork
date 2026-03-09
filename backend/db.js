'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'swipes.db');

const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS swipes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id  TEXT    NOT NULL,
    profile_name TEXT   NOT NULL,
    action      TEXT    NOT NULL CHECK(action IN ('like', 'nope', 'superlike')),
    swiped_at   TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    user_id      TEXT PRIMARY KEY,
    subscription TEXT NOT NULL,
    created_at   TEXT NOT NULL
  );
`);

module.exports = db;
