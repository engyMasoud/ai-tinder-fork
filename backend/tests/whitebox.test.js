'use strict';

// ===========================================================================
// WHITE-BOX TEST SUITE
// ===========================================================================
// Framework: Node.js built-in test runner (node:test) with node:assert/strict
//
// This suite is designed for structural (white-box) coverage of the backend.
// Every test comment explains which internal branch, boundary, or path it
// targets.  Tests are grouped by module/route and ordered by decision-point
// depth so the reader can trace coverage against the source line-by-line.
// ===========================================================================

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');

// Use an in-memory database so tests never touch production data.
process.env.DB_PATH = ':memory:';

const app = require('../server');
const db  = require('../db');
const { webpush, vapidKeys } = require('../vapid');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let server;
let baseUrl;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url     = new URL(path, baseUrl);
    const payload = body ? JSON.stringify(body) : undefined;
    const opts    = {
      method,
      hostname: url.hostname,
      port:     url.port,
      path:     url.pathname,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Small delay so fire-and-forget async work inside handlers can settle. */
function waitMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

before(() => new Promise((resolve) => {
  server = app.listen(0, () => {
    baseUrl = `http://localhost:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise((resolve) => {
  server.closeAllConnections();
  server.close(resolve);
}));

// Full isolation — clear both tables before every test.
beforeEach(() => {
  db.exec('DELETE FROM swipes');
  db.exec('DELETE FROM push_subscriptions');
});

// ===========================================================================
// 1.  GET /health  (server.js line ~20)
//     Statement coverage for the single health-check handler.
// ===========================================================================

describe('GET /health', () => {
  it('returns { status: "ok" } with HTTP 200', async () => {
    // Branch: this route has no conditionals; pure statement coverage.
    const res = await request('GET', '/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: 'ok' });
  });
});

// ===========================================================================
// 2.  POST /api/swipes  — INPUT VALIDATION BRANCHES
//     File: routes/swipes.js, handler at router.post('/')
//
//     Decision tree (evaluated top→bottom, first failing guard returns 400):
//       (A)  !profileId  ||  typeof profileId !== 'string'  ||  profileId.trim()===''
//       (B)  !profileName || typeof profileName !== 'string' || profileName.trim()===''
//       (C)  !action  ||  !VALID_ACTIONS.has(action)
// ===========================================================================

describe('POST /api/swipes — validation branches', () => {

  // ---- Guard (A): profileId ----

  it('400 when profileId is undefined  (guard A, sub-branch: !profileId — undefined is falsy)', async () => {
    const res = await request('POST', '/api/swipes', {
      profileName: 'Alex', action: 'like',
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /profileId/i);
  });

  it('400 when profileId is null  (guard A, sub-branch: !profileId — null is falsy)', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: null, profileName: 'Alex', action: 'like',
    });
    assert.equal(res.status, 400);
  });

  it('400 when profileId is a number  (guard A, sub-branch: typeof !== "string")', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 123, profileName: 'Alex', action: 'like',
    });
    assert.equal(res.status, 400);
  });

  it('400 when profileId is a boolean  (guard A, sub-branch: typeof !== "string")', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: true, profileName: 'Alex', action: 'like',
    });
    assert.equal(res.status, 400);
  });

  it('400 when profileId is empty string  (guard A, sub-branch: !"" is true)', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: '', profileName: 'Alex', action: 'like',
    });
    assert.equal(res.status, 400);
  });

  it('400 when profileId is whitespace-only  (guard A, sub-branch: .trim()==="")', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: '   ', profileName: 'Alex', action: 'like',
    });
    assert.equal(res.status, 400);
  });

  it('400 when profileId is a tab character  (boundary: .trim() strips \\t)', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: '\t', profileName: 'Alex', action: 'like',
    });
    assert.equal(res.status, 400);
  });

  // ---- Guard (B): profileName ----

  it('400 when profileName is undefined  (guard B, sub-branch: !profileName)', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', action: 'like',
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /profileName/i);
  });

  it('400 when profileName is null  (guard B, sub-branch: !null)', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: null, action: 'like',
    });
    assert.equal(res.status, 400);
  });

  it('400 when profileName is a number  (guard B, sub-branch: typeof !== "string")', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 42, action: 'like',
    });
    assert.equal(res.status, 400);
  });

  it('400 when profileName is empty string  (guard B, sub-branch: !"" is true)', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: '', action: 'like',
    });
    assert.equal(res.status, 400);
  });

  it('400 when profileName is whitespace-only  (guard B, sub-branch: .trim()==="")', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: '   ', action: 'like',
    });
    assert.equal(res.status, 400);
  });

  // ---- Guard (C): action ----

  it('400 when action is undefined  (guard C, sub-branch: !action)', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex',
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /action/i);
  });

  it('400 when action is null  (guard C, sub-branch: !null)', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex', action: null,
    });
    assert.equal(res.status, 400);
  });

  it('400 when action is empty string  (guard C, sub-branch: !"" is true)', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex', action: '',
    });
    assert.equal(res.status, 400);
  });

  it('400 for invalid action "wink"  (guard C, sub-branch: Set.has returns false)', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex', action: 'wink',
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /action/i);
  });

  it('400 for "Like" (capital L)  (confirms Set.has is case-sensitive)', async () => {
    // Bias check: a developer might assume case-insensitive matching.
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex', action: 'Like',
    });
    assert.equal(res.status, 400);
  });

  it('400 for action "SUPERLIKE"  (all-caps variant also rejected)', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex', action: 'SUPERLIKE',
    });
    assert.equal(res.status, 400);
  });

  it('validation checks run in order: profileId before profileName', async () => {
    // Both are invalid, but profileId error message should appear.
    const res = await request('POST', '/api/swipes', { action: 'like' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /profileId/i);
  });

  it('validation checks run in order: profileName before action', async () => {
    // profileName is missing; action is also invalid.
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', action: 'wink',
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /profileName/i);
  });
});

// ===========================================================================
// 3.  POST /api/swipes — SUCCESS PATHS & TRIMMING & userId HANDLING
// ===========================================================================

describe('POST /api/swipes — success paths', () => {
  it('records "like" and returns 201 with all expected fields', async () => {
    // Path: all guards pass, action = "like"
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex', action: 'like',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.profileId, 'p_0');
    assert.equal(res.body.profileName, 'Alex');
    assert.equal(res.body.action, 'like');
    assert.ok(res.body.id !== undefined);
    assert.ok(res.body.swipedAt);
    assert.equal(typeof res.body.matched, 'boolean');
  });

  it('records "nope" and returns 201', async () => {
    // Path: action = "nope"
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_1', profileName: 'Jordan', action: 'nope',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.action, 'nope');
  });

  it('records "superlike" and returns 201', async () => {
    // Path: action = "superlike"
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_2', profileName: 'Sam', action: 'superlike',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.action, 'superlike');
  });

  it('trims leading/trailing whitespace from profileId and profileName', async () => {
    // Path: cleanId = profileId.trim(), cleanName = profileName.trim()
    const res = await request('POST', '/api/swipes', {
      profileId: '  p_0_abc  ', profileName: '  Alex  ', action: 'like',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.profileId, 'p_0_abc');
    assert.equal(res.body.profileName, 'Alex');
  });

  it('swipedAt is ISO-8601 formatted', async () => {
    // Statement coverage: const swipedAt = new Date().toISOString()
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex', action: 'like',
    });
    // ISO-8601 pattern: YYYY-MM-DDTHH:MM:SS.sssZ
    assert.match(res.body.swipedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('auto-increments id across multiple swipes', async () => {
    // Statement coverage: result.lastInsertRowid returned as id
    const r1 = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'A', action: 'like',
    });
    const r2 = await request('POST', '/api/swipes', {
      profileId: 'p_1', profileName: 'B', action: 'nope',
    });
    assert.ok(Number(r2.body.id) > Number(r1.body.id));
  });
});

// ===========================================================================
// 4.  POST /api/swipes — userId CONDITIONAL ASSIGNMENT
//     Line: const cleanUserId = userId && typeof userId === 'string' ? userId.trim() : null;
//
//     Truth table for (userId && typeof userId === 'string'):
//       userId = undefined  →  false  →  cleanUserId = null
//       userId = null       →  false  →  cleanUserId = null
//       userId = 42         →  true && false = false  →  cleanUserId = null
//       userId = ''         →  false  →  cleanUserId = null
//       userId = 'u_test'   →  true && true = true   →  cleanUserId = 'u_test'
// ===========================================================================

describe('POST /api/swipes — userId handling', () => {
  it('cleanUserId = null when userId is omitted (undefined)', async () => {
    // Branch: !userId is true (undefined) → ternary evaluates to null
    const origRandom = Math.random;
    Math.random = () => 0.0; // force match so we can verify notification is NOT sent
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex', action: 'like',
    });
    Math.random = origRandom;
    assert.equal(res.status, 201);
    assert.equal(res.body.matched, true);
    // No crash — notification path skipped because cleanUserId is null
  });

  it('cleanUserId = null when userId is a number (typeof !== "string")', async () => {
    // Branch: typeof 42 !== 'string' → ternary evaluates to null
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex', action: 'nope', userId: 42,
    });
    assert.equal(res.status, 201);
  });

  it('cleanUserId = null when userId is empty string (falsy)', async () => {
    // Branch: !"" is true → ternary evaluates to null
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex', action: 'nope', userId: '',
    });
    assert.equal(res.status, 201);
  });

  it('cleanUserId = trimmed string when userId is a valid non-empty string', async () => {
    // Branch: 'u_test' is truthy AND typeof is 'string' → userId.trim()
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex', action: 'nope', userId: '  u_test  ',
    });
    assert.equal(res.status, 201);
  });
});

// ===========================================================================
// 5.  POST /api/swipes — MATCH PROBABILITY BOUNDARY VALUES
//     Constants:  MATCH_CHANCE = { like: 0.3, superlike: 0.6 }
//     Condition:  chance !== undefined && Math.random() < chance
//
//     Boundary analysis:
//       action "nope"      →  chance = undefined  →  isMatch = false (always)
//       action "like"      →  chance = 0.3
//         random = 0.29    →  0.29 < 0.3  = true  → MATCH
//         random = 0.3     →  0.3 < 0.3   = false → NO MATCH  (boundary)
//         random = 0.31    →  0.31 < 0.3  = false → NO MATCH
//       action "superlike" →  chance = 0.6
//         random = 0.59    →  0.59 < 0.6  = true  → MATCH
//         random = 0.6     →  0.6 < 0.6   = false → NO MATCH  (boundary)
//         random = 0.61    →  0.61 < 0.6  = false → NO MATCH
// ===========================================================================

describe('POST /api/swipes — match probability boundaries', () => {
  let origRandom;
  beforeEach(() => { origRandom = Math.random; });
  afterEach(() => { Math.random = origRandom; });

  // ---- "nope" action — chance is undefined ----

  it('"nope" never matches even with Math.random() = 0.0 (chance is undefined)', async () => {
    Math.random = () => 0.0;
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex', action: 'nope',
    });
    assert.equal(res.body.matched, false);
  });

  // ---- "like" action — boundary at 0.3 ----

  it('"like" matches at random = 0.0 (well below boundary)', async () => {
    Math.random = () => 0.0;
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex', action: 'like',
    });
    assert.equal(res.body.matched, true);
  });

  it('"like" matches at random = 0.29 (just below boundary 0.3)', async () => {
    Math.random = () => 0.29;
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex', action: 'like',
    });
    assert.equal(res.body.matched, true);
  });

  it('"like" does NOT match at random = 0.3 (exact boundary — strict <)', async () => {
    Math.random = () => 0.3;
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex', action: 'like',
    });
    assert.equal(res.body.matched, false);
  });

  it('"like" does NOT match at random = 0.31 (just above boundary)', async () => {
    Math.random = () => 0.31;
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex', action: 'like',
    });
    assert.equal(res.body.matched, false);
  });

  it('"like" does NOT match at random = 0.999 (maximum practical value)', async () => {
    Math.random = () => 0.999;
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex', action: 'like',
    });
    assert.equal(res.body.matched, false);
  });

  // ---- "superlike" action — boundary at 0.6 ----

  it('"superlike" matches at random = 0.0 (well below boundary)', async () => {
    Math.random = () => 0.0;
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex', action: 'superlike',
    });
    assert.equal(res.body.matched, true);
  });

  it('"superlike" matches at random = 0.59 (just below boundary 0.6)', async () => {
    Math.random = () => 0.59;
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex', action: 'superlike',
    });
    assert.equal(res.body.matched, true);
  });

  it('"superlike" does NOT match at random = 0.6 (exact boundary — strict <)', async () => {
    Math.random = () => 0.6;
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex', action: 'superlike',
    });
    assert.equal(res.body.matched, false);
  });

  it('"superlike" does NOT match at random = 0.61 (just above boundary)', async () => {
    Math.random = () => 0.61;
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex', action: 'superlike',
    });
    assert.equal(res.body.matched, false);
  });
});

// ===========================================================================
// 6.  sendMatchNotification() — INTERNAL ASYNC BRANCHES
//     File: routes/swipes.js
//
//     Decision points inside sendMatchNotification:
//       (A)  if (!row) return;                         — no subscription row
//       (B)  try { await webpush.sendNotification }
//       (C)  catch: err.statusCode === 404             — delete subscription
//       (D)  catch: err.statusCode === 410             — delete subscription
//       (E)  catch: else                               — console.error, keep sub
//
//     Callers:
//       (F)  if (isMatch && cleanUserId)               — fire-and-forget
//       (G)  .catch(err => console.error(...))         — outer catch
// ===========================================================================

describe('POST /api/swipes — sendMatchNotification branches', () => {
  let origRandom;
  let origSendNotification;

  beforeEach(() => {
    origRandom           = Math.random;
    origSendNotification = webpush.sendNotification;
  });

  afterEach(() => {
    Math.random            = origRandom;
    webpush.sendNotification = origSendNotification;
  });

  it('no notification when match is true but userId absent (branch F: isMatch && !cleanUserId)', async () => {
    Math.random = () => 0.0;
    let called = false;
    webpush.sendNotification = async () => { called = true; };

    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex', action: 'like',
      // userId intentionally omitted
    });
    await waitMs(50);
    assert.equal(res.body.matched, true);
    assert.equal(called, false);
  });

  it('no notification when no match even with valid userId (branch F: !isMatch)', async () => {
    Math.random = () => 0.99;
    let called = false;
    webpush.sendNotification = async () => { called = true; };

    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex', action: 'like', userId: 'u_test',
    });
    await waitMs(50);
    assert.equal(res.body.matched, false);
    assert.equal(called, false);
  });

  it('returns early if no push_subscriptions row for user (branch A: !row)', async () => {
    Math.random = () => 0.0;
    let called = false;
    webpush.sendNotification = async () => { called = true; };

    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex', action: 'like', userId: 'u_no_sub',
    });
    await waitMs(100);
    assert.equal(res.body.matched, true);
    assert.equal(called, false); // no subscription row → returned before sendNotification
  });

  it('calls webpush.sendNotification with correct payload on match (branch B: success path)', async () => {
    // Seed a subscription
    db.prepare(
      'INSERT INTO push_subscriptions (user_id, subscription, created_at) VALUES (?, ?, ?)'
    ).run('u_push', JSON.stringify({ endpoint: 'https://push.example.com/ok' }), new Date().toISOString());

    Math.random = () => 0.0;
    let receivedSub = null;
    let receivedPayload = null;
    webpush.sendNotification = async (sub, payload) => {
      receivedSub     = sub;
      receivedPayload = payload;
    };

    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex', action: 'like', userId: 'u_push',
    });
    await waitMs(100);

    assert.equal(res.body.matched, true);
    assert.notEqual(receivedPayload, null);
    // Verify the subscription was parsed from the DB row
    assert.equal(receivedSub.endpoint, 'https://push.example.com/ok');
    // Verify payload structure
    const payload = JSON.parse(receivedPayload);
    assert.equal(payload.title, "It's a Match! 🎉");
    assert.ok(payload.body.includes('Alex'));
    assert.equal(payload.url, '/');
  });

  it('deletes subscription on push 404 (branch C: err.statusCode === 404)', async () => {
    db.prepare(
      'INSERT INTO push_subscriptions (user_id, subscription, created_at) VALUES (?, ?, ?)'
    ).run('u_404', JSON.stringify({ endpoint: 'https://push.example.com/gone' }), new Date().toISOString());

    Math.random = () => 0.0;
    webpush.sendNotification = async () => {
      const err = new Error('Not Found');
      err.statusCode = 404;
      throw err;
    };

    await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex', action: 'like', userId: 'u_404',
    });
    await waitMs(100);

    const row = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').get('u_404');
    assert.equal(row, undefined); // subscription removed
  });

  it('deletes subscription on push 410 (branch D: err.statusCode === 410)', async () => {
    db.prepare(
      'INSERT INTO push_subscriptions (user_id, subscription, created_at) VALUES (?, ?, ?)'
    ).run('u_410', JSON.stringify({ endpoint: 'https://push.example.com/expired' }), new Date().toISOString());

    Math.random = () => 0.0;
    webpush.sendNotification = async () => {
      const err = new Error('Gone');
      err.statusCode = 410;
      throw err;
    };

    await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex', action: 'like', userId: 'u_410',
    });
    await waitMs(100);

    const row = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').get('u_410');
    assert.equal(row, undefined); // subscription removed
  });

  it('keeps subscription on push error with statusCode 500 (branch E: else → console.error)', async () => {
    db.prepare(
      'INSERT INTO push_subscriptions (user_id, subscription, created_at) VALUES (?, ?, ?)'
    ).run('u_500', JSON.stringify({ endpoint: 'https://push.example.com/err' }), new Date().toISOString());

    Math.random = () => 0.0;
    webpush.sendNotification = async () => {
      const err = new Error('Server Error');
      err.statusCode = 500;
      throw err;
    };

    // Suppress console.error from polluting output
    const origErr = console.error;
    let errorMsg  = null;
    console.error = (label, msg) => { if (label === 'Push notification error:') errorMsg = msg; };

    await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex', action: 'like', userId: 'u_500',
    });
    await waitMs(100);

    console.error = origErr;

    // Subscription must NOT be deleted
    const row = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').get('u_500');
    assert.notEqual(row, undefined);
    // Verify the error was logged
    assert.equal(errorMsg, 'Server Error');
  });

  it('keeps subscription when push error has no statusCode (branch E: undefined !== 404/410)', async () => {
    db.prepare(
      'INSERT INTO push_subscriptions (user_id, subscription, created_at) VALUES (?, ?, ?)'
    ).run('u_nocode', JSON.stringify({ endpoint: 'https://push.example.com/x' }), new Date().toISOString());

    Math.random = () => 0.0;
    webpush.sendNotification = async () => { throw new Error('Network error'); };

    const origErr = console.error;
    console.error = () => {};

    await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex', action: 'like', userId: 'u_nocode',
    });
    await waitMs(100);

    console.error = origErr;

    const row = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').get('u_nocode');
    assert.notEqual(row, undefined); // subscription kept
  });

  it('outer .catch() handles errors thrown before the try block (branch G)', async () => {
    // If db.prepare() inside sendMatchNotification threw, the outer .catch() would fire.
    // We simulate this by inserting a row with invalid JSON so JSON.parse fails
    // inside the try block — still caught internally, but verifies no unhandled rejection.
    db.prepare(
      'INSERT INTO push_subscriptions (user_id, subscription, created_at) VALUES (?, ?, ?)'
    ).run('u_badjson', '<<<not json>>>', new Date().toISOString());

    Math.random = () => 0.0;
    // Do NOT mock sendNotification — JSON.parse(row.subscription) will throw
    // before sendNotification is called.  The try/catch inside
    // sendMatchNotification catches it, but verify no crash.
    webpush.sendNotification = origSendNotification;

    const origErr = console.error;
    console.error = () => {};

    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0', profileName: 'Alex', action: 'like', userId: 'u_badjson',
    });
    await waitMs(100);

    console.error = origErr;
    assert.equal(res.status, 201); // response must not be affected
  });
});

// ===========================================================================
// 7.  GET /api/swipes — QUERY & ORDERING
// ===========================================================================

describe('GET /api/swipes', () => {
  it('returns empty array when no swipes exist (path: .all() returns [])', async () => {
    const res = await request('GET', '/api/swipes');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.swipes, []);
  });

  it('returns all swipes in descending id order (ORDER BY id DESC)', async () => {
    await request('POST', '/api/swipes', { profileId: 'p_1', profileName: 'A', action: 'like' });
    await request('POST', '/api/swipes', { profileId: 'p_2', profileName: 'B', action: 'nope' });
    await request('POST', '/api/swipes', { profileId: 'p_3', profileName: 'C', action: 'superlike' });

    const res = await request('GET', '/api/swipes');
    assert.equal(res.body.swipes.length, 3);
    // Most recent first
    assert.equal(res.body.swipes[0].profileId, 'p_3');
    assert.equal(res.body.swipes[1].profileId, 'p_2');
    assert.equal(res.body.swipes[2].profileId, 'p_1');
  });

  it('each entry has exactly the expected shape (column aliases)', async () => {
    // Verifies SELECT aliases: profile_id AS profileId, etc.
    await request('POST', '/api/swipes', { profileId: 'p_1', profileName: 'A', action: 'superlike' });
    const res = await request('GET', '/api/swipes');
    const s   = res.body.swipes[0];
    assert.ok('id'          in s);
    assert.ok('profileId'   in s);
    assert.ok('profileName' in s);
    assert.ok('action'      in s);
    assert.ok('swipedAt'    in s);
    // Should NOT contain raw DB column names
    assert.ok(!('profile_id'   in s));
    assert.ok(!('profile_name' in s));
    assert.ok(!('swiped_at'    in s));
  });

  it('returns swipes that were trimmed during insertion', async () => {
    await request('POST', '/api/swipes', {
      profileId: '  p_trimmed  ', profileName: '  TrimMe  ', action: 'like',
    });
    const res = await request('GET', '/api/swipes');
    assert.equal(res.body.swipes[0].profileId,   'p_trimmed');
    assert.equal(res.body.swipes[0].profileName, 'TrimMe');
  });
});

// ===========================================================================
// 8.  GET /api/swipes/stats — AGGREGATION & LOOP
//     Loop: for (const row of rows) { stats[row.action] = ...; stats.total += ...; }
// ===========================================================================

describe('GET /api/swipes/stats', () => {
  it('returns zeroes when no swipes exist (path: rows is [] → loop body never executes)', async () => {
    const res = await request('GET', '/api/swipes/stats');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { like: 0, nope: 0, superlike: 0, total: 0 });
  });

  it('counts a single "like" correctly (loop executes once)', async () => {
    await request('POST', '/api/swipes', { profileId: 'p_1', profileName: 'A', action: 'like' });
    const res = await request('GET', '/api/swipes/stats');
    assert.equal(res.body.like, 1);
    assert.equal(res.body.nope, 0);
    assert.equal(res.body.superlike, 0);
    assert.equal(res.body.total, 1);
  });

  it('counts only "nope" when that is the sole action (single-action path)', async () => {
    await request('POST', '/api/swipes', { profileId: 'p_1', profileName: 'A', action: 'nope' });
    await request('POST', '/api/swipes', { profileId: 'p_2', profileName: 'B', action: 'nope' });
    const res = await request('GET', '/api/swipes/stats');
    assert.equal(res.body.nope, 2);
    assert.equal(res.body.like, 0);
    assert.equal(res.body.superlike, 0);
    assert.equal(res.body.total, 2);
  });

  it('correctly aggregates all three action types (loop iterates 3 times)', async () => {
    await request('POST', '/api/swipes', { profileId: 'p_1', profileName: 'A', action: 'like' });
    await request('POST', '/api/swipes', { profileId: 'p_2', profileName: 'B', action: 'like' });
    await request('POST', '/api/swipes', { profileId: 'p_3', profileName: 'C', action: 'nope' });
    await request('POST', '/api/swipes', { profileId: 'p_4', profileName: 'D', action: 'superlike' });

    const res = await request('GET', '/api/swipes/stats');
    assert.equal(res.body.like, 2);
    assert.equal(res.body.nope, 1);
    assert.equal(res.body.superlike, 1);
    assert.equal(res.body.total, 4);
  });

  it('total equals the sum of individual counts (verifies += accumulator)', async () => {
    for (let i = 0; i < 5; i++) {
      await request('POST', '/api/swipes', { profileId: `p_${i}`, profileName: 'X', action: 'like' });
    }
    for (let i = 5; i < 8; i++) {
      await request('POST', '/api/swipes', { profileId: `p_${i}`, profileName: 'X', action: 'nope' });
    }
    const res = await request('GET', '/api/swipes/stats');
    assert.equal(res.body.total, res.body.like + res.body.nope + res.body.superlike);
    assert.equal(res.body.total, 8);
  });
});

// ===========================================================================
// 9.  PUSH ROUTES — GET /api/push/vapid-public-key
//     File: routes/push.js
// ===========================================================================

describe('GET /api/push/vapid-public-key', () => {
  it('returns the VAPID public key (statement coverage)', async () => {
    const res = await request('GET', '/api/push/vapid-public-key');
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.publicKey, 'string');
    assert.ok(res.body.publicKey.length > 0);
    // Must match the key loaded by vapid.js
    assert.equal(res.body.publicKey, vapidKeys.publicKey);
  });
});

// ===========================================================================
// 10. PUSH ROUTES — POST /api/push/subscribe  (validation + success + upsert)
//     Decision points:
//       (A) !userId || typeof userId !== 'string' || userId.trim() === ''
//       (B) !subscription || typeof subscription !== 'object' || !subscription.endpoint
//       (C) INSERT … ON CONFLICT … DO UPDATE
// ===========================================================================

describe('POST /api/push/subscribe — validation', () => {
  it('400 when userId is missing (guard A: !userId)', async () => {
    const res = await request('POST', '/api/push/subscribe', {
      subscription: { endpoint: 'https://push.example.com/1' },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /userId/i);
  });

  it('400 when userId is null (guard A: !null)', async () => {
    const res = await request('POST', '/api/push/subscribe', {
      userId: null,
      subscription: { endpoint: 'https://push.example.com/1' },
    });
    assert.equal(res.status, 400);
  });

  it('400 when userId is a number (guard A: typeof !== "string")', async () => {
    const res = await request('POST', '/api/push/subscribe', {
      userId: 42,
      subscription: { endpoint: 'https://push.example.com/1' },
    });
    assert.equal(res.status, 400);
  });

  it('400 when userId is empty string (guard A: !"" is true)', async () => {
    const res = await request('POST', '/api/push/subscribe', {
      userId: '',
      subscription: { endpoint: 'https://push.example.com/1' },
    });
    assert.equal(res.status, 400);
  });

  it('400 when userId is whitespace-only (guard A: .trim() === "")', async () => {
    const res = await request('POST', '/api/push/subscribe', {
      userId: '   ',
      subscription: { endpoint: 'https://push.example.com/1' },
    });
    assert.equal(res.status, 400);
  });

  it('400 when subscription is missing (guard B: !subscription)', async () => {
    const res = await request('POST', '/api/push/subscribe', {
      userId: 'u_test',
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /subscription/i);
  });

  it('400 when subscription is null (guard B: !null)', async () => {
    const res = await request('POST', '/api/push/subscribe', {
      userId: 'u_test',
      subscription: null,
    });
    assert.equal(res.status, 400);
  });

  it('400 when subscription is a string (guard B: typeof !== "object")', async () => {
    const res = await request('POST', '/api/push/subscribe', {
      userId: 'u_test',
      subscription: 'not-an-object',
    });
    assert.equal(res.status, 400);
  });

  it('400 when subscription is a number (guard B: typeof !== "object")', async () => {
    const res = await request('POST', '/api/push/subscribe', {
      userId: 'u_test',
      subscription: 42,
    });
    assert.equal(res.status, 400);
  });

  it('400 when subscription has no endpoint (guard B: !subscription.endpoint)', async () => {
    const res = await request('POST', '/api/push/subscribe', {
      userId: 'u_test',
      subscription: { keys: { p256dh: 'abc', auth: 'def' } },
    });
    assert.equal(res.status, 400);
  });

  it('400 when subscription.endpoint is empty string (guard B: !"" is true)', async () => {
    const res = await request('POST', '/api/push/subscribe', {
      userId: 'u_test',
      subscription: { endpoint: '' },
    });
    assert.equal(res.status, 400);
  });

  it('400 when subscription.endpoint is null (guard B: !null is true)', async () => {
    const res = await request('POST', '/api/push/subscribe', {
      userId: 'u_test',
      subscription: { endpoint: null },
    });
    assert.equal(res.status, 400);
  });
});

describe('POST /api/push/subscribe — success & upsert', () => {
  it('201 with valid userId and subscription (happy path)', async () => {
    const res = await request('POST', '/api/push/subscribe', {
      userId: 'u_sub1',
      subscription: { endpoint: 'https://push.example.com/sub1' },
    });
    assert.equal(res.status, 201);
    assert.match(res.body.message, /subscribed/i);

    // Verify DB row
    const row = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').get('u_sub1');
    assert.notEqual(row, undefined);
    assert.equal(JSON.parse(row.subscription).endpoint, 'https://push.example.com/sub1');
  });

  it('trims userId before storing (cleanUserId = userId.trim())', async () => {
    const res = await request('POST', '/api/push/subscribe', {
      userId: '  u_trimmed  ',
      subscription: { endpoint: 'https://push.example.com/trim' },
    });
    assert.equal(res.status, 201);
    const row = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').get('u_trimmed');
    assert.notEqual(row, undefined);
  });

  it('stores subscription as JSON string in the DB', async () => {
    const sub = { endpoint: 'https://push.example.com/json', keys: { p256dh: 'abc', auth: 'def' } };
    await request('POST', '/api/push/subscribe', {
      userId: 'u_json', subscription: sub,
    });
    const row = db.prepare('SELECT subscription FROM push_subscriptions WHERE user_id = ?').get('u_json');
    assert.deepEqual(JSON.parse(row.subscription), sub);
  });

  it('upserts on conflict: second subscribe updates subscription (ON CONFLICT DO UPDATE)', async () => {
    // First subscription
    await request('POST', '/api/push/subscribe', {
      userId: 'u_upsert',
      subscription: { endpoint: 'https://push.example.com/v1' },
    });
    // Second subscription with same userId
    const res = await request('POST', '/api/push/subscribe', {
      userId: 'u_upsert',
      subscription: { endpoint: 'https://push.example.com/v2' },
    });
    assert.equal(res.status, 201);

    // Only one row should exist
    const rows = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all('u_upsert');
    assert.equal(rows.length, 1);
    assert.equal(JSON.parse(rows[0].subscription).endpoint, 'https://push.example.com/v2');
  });

  it('sets created_at as ISO string (statement coverage)', async () => {
    await request('POST', '/api/push/subscribe', {
      userId: 'u_ts',
      subscription: { endpoint: 'https://push.example.com/ts' },
    });
    const row = db.prepare('SELECT created_at FROM push_subscriptions WHERE user_id = ?').get('u_ts');
    assert.match(row.created_at, /^\d{4}-\d{2}-\d{2}T/);
  });
});

// ===========================================================================
// 11. PUSH ROUTES — DELETE /api/push/subscribe
//     Decision points: same userId guard as POST
// ===========================================================================

describe('DELETE /api/push/subscribe — validation', () => {
  it('400 when userId is missing (guard: !userId)', async () => {
    const res = await request('DELETE', '/api/push/subscribe', {});
    assert.equal(res.status, 400);
    assert.match(res.body.error, /userId/i);
  });

  it('400 when userId is null', async () => {
    const res = await request('DELETE', '/api/push/subscribe', { userId: null });
    assert.equal(res.status, 400);
  });

  it('400 when userId is a number (typeof !== "string")', async () => {
    const res = await request('DELETE', '/api/push/subscribe', { userId: 42 });
    assert.equal(res.status, 400);
  });

  it('400 when userId is whitespace-only (.trim() === "")', async () => {
    const res = await request('DELETE', '/api/push/subscribe', { userId: '   ' });
    assert.equal(res.status, 400);
  });
});

describe('DELETE /api/push/subscribe — success', () => {
  it('deletes an existing subscription and returns 200', async () => {
    // Seed the subscription
    db.prepare(
      'INSERT INTO push_subscriptions (user_id, subscription, created_at) VALUES (?, ?, ?)'
    ).run('u_del', JSON.stringify({ endpoint: 'https://push.example.com/del' }), new Date().toISOString());

    const res = await request('DELETE', '/api/push/subscribe', { userId: 'u_del' });
    assert.equal(res.status, 200);
    assert.match(res.body.message, /unsubscribed/i);

    const row = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').get('u_del');
    assert.equal(row, undefined);
  });

  it('returns 200 even if userId does not exist (DELETE is idempotent)', async () => {
    // No matching row → .run() affects 0 rows, no error raised
    const res = await request('DELETE', '/api/push/subscribe', { userId: 'u_nonexistent' });
    assert.equal(res.status, 200);
  });

  it('trims userId before deleting (userId.trim())', async () => {
    db.prepare(
      'INSERT INTO push_subscriptions (user_id, subscription, created_at) VALUES (?, ?, ?)'
    ).run('u_trim_del', JSON.stringify({ endpoint: 'https://push.example.com/td' }), new Date().toISOString());

    const res = await request('DELETE', '/api/push/subscribe', { userId: '  u_trim_del  ' });
    assert.equal(res.status, 200);
    const row = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').get('u_trim_del');
    assert.equal(row, undefined);
  });
});

// ===========================================================================
// 12. 404 HANDLER  (server.js)
//     app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));
// ===========================================================================

describe('404 handler', () => {
  it('returns 404 JSON for a completely unknown path', async () => {
    const res = await request('GET', '/api/does-not-exist');
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Not found.');
  });

  it('returns 404 for an unknown HTTP method on a valid route base', async () => {
    // PATCH /api/swipes is not defined
    const res = await request('PATCH', '/api/swipes');
    assert.equal(res.status, 404);
  });

  it('returns 404 for PUT /api/push/subscribe (only POST and DELETE are routed)', async () => {
    const res = await request('PUT', '/api/push/subscribe');
    assert.equal(res.status, 404);
  });
});

// ===========================================================================
// 13. CONFIRMATION-BIAS MITIGATION — EDGE CASES THE CODE SHOULD HANDLE
//     These tests document potentially missing logic or subtle behaviors.
// ===========================================================================

describe('Bias mitigation — edge cases and missing guards', () => {
  it('allows duplicate swipes on the same profile (no unique constraint)', async () => {
    // The schema has no UNIQUE(profile_id) — same profile can be swiped N times.
    // This may or may not be intentional.
    const r1 = await request('POST', '/api/swipes', {
      profileId: 'p_dup', profileName: 'Alex', action: 'like',
    });
    const r2 = await request('POST', '/api/swipes', {
      profileId: 'p_dup', profileName: 'Alex', action: 'nope',
    });
    assert.equal(r1.status, 201);
    assert.equal(r2.status, 201);

    const res = await request('GET', '/api/swipes');
    assert.equal(res.body.swipes.length, 2);
  });

  it('accepts extremely long profileId (no max-length validation)', async () => {
    const longId = 'p_' + 'x'.repeat(5000);
    const res = await request('POST', '/api/swipes', {
      profileId: longId, profileName: 'Alex', action: 'like',
    });
    // Current code has no length limit — it succeeds.
    assert.equal(res.status, 201);
    assert.equal(res.body.profileId, longId);
  });

  it('action validation is case-sensitive (potential user confusion)', async () => {
    // Users might send "Like" or "LIKE" — both are rejected.
    for (const badCase of ['Like', 'LIKE', 'Nope', 'NOPE', 'SuperLike', 'SUPERLIKE']) {
      const res = await request('POST', '/api/swipes', {
        profileId: 'p_0', profileName: 'Alex', action: badCase,
      });
      assert.equal(res.status, 400, `Expected 400 for action="${badCase}"`);
    }
  });

  it('stats accumulator starts at 0 for missing actions (no partial count issue)', async () => {
    // If only "like" swipes exist, "nope" and "superlike" should still be 0.
    await request('POST', '/api/swipes', { profileId: 'p_1', profileName: 'A', action: 'like' });
    const res = await request('GET', '/api/swipes/stats');
    assert.equal(res.body.nope, 0);
    assert.equal(res.body.superlike, 0);
    assert.equal(res.body.total, 1);
  });

  it('POST /api/swipes with empty JSON body triggers profileId guard first', async () => {
    const res = await request('POST', '/api/swipes', {});
    assert.equal(res.status, 400);
    assert.match(res.body.error, /profileId/i);
  });

  it('push subscribe with array as subscription still triggers endpoint check', async () => {
    // typeof [] === 'object' (true), so it passes the type check
    // but [].endpoint is undefined → !undefined → true → 400
    const res = await request('POST', '/api/push/subscribe', {
      userId: 'u_arr',
      subscription: [1, 2, 3],
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /subscription/i);
  });

  it('global error handler is defined (structural presence check)', () => {
    // The Express 4 global error handler (4-arity middleware) exists in server.js
    // but is unreachable for async handler rejections. This is a known Express 4
    // limitation. The handler is still structurally present for any synchronous
    // throw in non-async middleware.
    //
    // We cannot easily trigger it from an HTTP request without injecting middleware,
    // so we verify the app stack contains a 4-arity function (Express convention).
    const errorHandlers = app._router.stack.filter(
      layer => layer.handle && layer.handle.length === 4
    );
    assert.ok(errorHandlers.length > 0, 'Expected at least one error-handling middleware');
  });
});

// ===========================================================================
// 14. DATABASE SCHEMA — CHECK CONSTRAINT ENFORCEMENT
//     db.js: CHECK(action IN ('like', 'nope', 'superlike'))
//     The route-level validation rejects bad actions before they reach the DB,
//     but the DB constraint is a defense-in-depth layer.
// ===========================================================================

describe('DB schema — CHECK constraint on action column', () => {
  it('DB rejects INSERT with invalid action directly (defense in depth)', () => {
    // Bypassing the route to test the DB constraint itself.
    assert.throws(() => {
      db.prepare(
        "INSERT INTO swipes (profile_id, profile_name, action, swiped_at) VALUES (?, ?, ?, ?)"
      ).run('p_x', 'X', 'invalid_action', new Date().toISOString());
    });
  });

  it('DB accepts INSERT with valid actions directly', () => {
    for (const action of ['like', 'nope', 'superlike']) {
      assert.doesNotThrow(() => {
        db.prepare(
          "INSERT INTO swipes (profile_id, profile_name, action, swiped_at) VALUES (?, ?, ?, ?)"
        ).run(`p_${action}`, 'X', action, new Date().toISOString());
      });
    }
  });
});
