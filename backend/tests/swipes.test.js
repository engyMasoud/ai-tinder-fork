'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Use an in-memory database for tests
process.env.DB_PATH = ':memory:';

const app = require('../server');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let server;
let baseUrl;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body ? JSON.stringify(body) : undefined;
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
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

// Clear table before each test for isolation
const db = require('../db');
beforeEach(() => db.exec('DELETE FROM swipes'));

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

describe('GET /health', () => {
  it('returns 200 ok', async () => {
    const res = await request('GET', '/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
  });
});

// ---------------------------------------------------------------------------
// POST /api/swipes
// ---------------------------------------------------------------------------

describe('POST /api/swipes', () => {
  it('records a like and returns 201', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0_abc',
      profileName: 'Alex',
      action: 'like',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.action, 'like');
    assert.equal(res.body.profileId, 'p_0_abc');
    assert.equal(res.body.profileName, 'Alex');
    assert.ok(res.body.id);
    assert.ok(res.body.swipedAt);
  });

  it('records a nope and returns 201', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_1_def',
      profileName: 'Jordan',
      action: 'nope',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.action, 'nope');
  });

  it('records a superlike and returns 201', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_2_ghi',
      profileName: 'Sam',
      action: 'superlike',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.action, 'superlike');
  });

  it('returns 400 when profileId is missing', async () => {
    const res = await request('POST', '/api/swipes', {
      profileName: 'Alex',
      action: 'like',
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it('returns 400 when profileName is missing', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0_abc',
      action: 'like',
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it('returns 400 for an invalid action', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0_abc',
      profileName: 'Alex',
      action: 'wink',
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it('returns 400 when profileId is blank whitespace', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: '   ',
      profileName: 'Alex',
      action: 'like',
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it('trims whitespace from profileId and profileName', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: '  p_0_abc  ',
      profileName: '  Alex  ',
      action: 'like',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.profileId, 'p_0_abc');
    assert.equal(res.body.profileName, 'Alex');
  });
});

// ---------------------------------------------------------------------------
// GET /api/swipes
// ---------------------------------------------------------------------------

describe('GET /api/swipes', () => {
  it('returns an empty array when no swipes exist', async () => {
    const res = await request('GET', '/api/swipes');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.swipes, []);
  });

  it('returns all recorded swipes in descending order', async () => {
    await request('POST', '/api/swipes', { profileId: 'p_1', profileName: 'A', action: 'like' });
    await request('POST', '/api/swipes', { profileId: 'p_2', profileName: 'B', action: 'nope' });

    const res = await request('GET', '/api/swipes');
    assert.equal(res.status, 200);
    assert.equal(res.body.swipes.length, 2);
    // Most recent first
    assert.equal(res.body.swipes[0].profileId, 'p_2');
  });

  it('each swipe entry has the expected shape', async () => {
    await request('POST', '/api/swipes', { profileId: 'p_1', profileName: 'A', action: 'superlike' });
    const res = await request('GET', '/api/swipes');
    const swipe = res.body.swipes[0];
    assert.ok(swipe.id);
    assert.ok(swipe.profileId);
    assert.ok(swipe.profileName);
    assert.ok(swipe.action);
    assert.ok(swipe.swipedAt);
  });
});

// ---------------------------------------------------------------------------
// GET /api/swipes/stats
// ---------------------------------------------------------------------------

describe('GET /api/swipes/stats', () => {
  it('returns zero counts when no swipes exist', async () => {
    const res = await request('GET', '/api/swipes/stats');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { like: 0, nope: 0, superlike: 0, total: 0 });
  });

  it('returns correct counts after mixed swipes', async () => {
    await request('POST', '/api/swipes', { profileId: 'p_1', profileName: 'A', action: 'like' });
    await request('POST', '/api/swipes', { profileId: 'p_2', profileName: 'B', action: 'like' });
    await request('POST', '/api/swipes', { profileId: 'p_3', profileName: 'C', action: 'nope' });
    await request('POST', '/api/swipes', { profileId: 'p_4', profileName: 'D', action: 'superlike' });

    const res = await request('GET', '/api/swipes/stats');
    assert.equal(res.status, 200);
    assert.equal(res.body.like, 2);
    assert.equal(res.body.nope, 1);
    assert.equal(res.body.superlike, 1);
    assert.equal(res.body.total, 4);
  });
});

// ---------------------------------------------------------------------------
// 404
// ---------------------------------------------------------------------------

describe('Unknown routes', () => {
  it('returns 404 for an unknown path', async () => {
    const res = await request('GET', '/api/does-not-exist');
    assert.equal(res.status, 404);
  });
});
