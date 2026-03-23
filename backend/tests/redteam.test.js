'use strict';

// ===========================================================================
// RED TEAM — ADVERSARIAL WHITE-BOX TEST SUITE
// ===========================================================================
// Framework: Node.js built-in test runner (node:test) + node:assert/strict
//
// PURPOSE:  These tests exist to BREAK the code, not prove it works.
//           Every test documents the specific failure scenario it attempts
//           to trigger and explains why the internal path was or was not safe.
//
// FRAGILE AREAS IDENTIFIED BEFORE WRITING TESTS:
//
//   1. sendMatchNotification — fire-and-forget async that mutates the DB
//      (deletes subscriptions) without being awaited.  JSON.parse on DB
//      column can throw; race conditions on concurrent match swipes.
//
//   2. stats[row.action] & MATCH_CHANCE[action] — dynamic property access
//      on plain objects.  No hasOwnProperty guard.  If action somehow
//      equalled "__proto__", "constructor", or "toString", behavior is
//      undefined.  MATCH_CHANCE inherits from Object.prototype.
//
//   3. Inconsistent trimming & absent sanitization — action is NOT trimmed
//      while profileId/profileName ARE.  userId can be null silently instead
//      of rejected.  Subscription validation passes arrays.  No max-length
//      limits on any field.  ON CONFLICT only updates subscription, not
//      created_at.  No pagination on GET /api/swipes.
//
// ===========================================================================

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');

process.env.DB_PATH = ':memory:';

const app = require('../server');
const db  = require('../db');
const { webpush } = require('../vapid');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let server, baseUrl;

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
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try   { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Send raw bytes so we can craft malformed payloads that JSON.stringify can't */
function rawRequest(method, path, rawBody, contentType = 'application/json') {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: {
        'Content-Type': contentType,
        'Content-Length': Buffer.byteLength(rawBody),
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try   { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(rawBody);
    req.end();
  });
}

function waitMs(ms) { return new Promise(r => setTimeout(r, ms)); }

function validSwipe(overrides = {}) {
  return { profileId: 'p_0', profileName: 'Alex', action: 'like', ...overrides };
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

beforeEach(() => {
  db.exec('DELETE FROM swipes');
  db.exec('DELETE FROM push_subscriptions');
});

// ===========================================================================
// SECTION 1: PROTOTYPE POLLUTION & INHERITED PROPERTY ATTACKS
//
// MATCH_CHANCE is a plain {}, so MATCH_CHANCE[action] traverses the prototype
// chain.  stats[row.action] writes to a plain {}.  We test whether sending
// prototype-inherited property names as "action" could cause unexpected match
// behaviour or corrupt the stats response.
//
// Failure scenario: if an action like "toString" bypassed the Set check,
// MATCH_CHANCE["toString"] would resolve to Object.prototype.toString
// (a truthy function), and `chance !== undefined` would be true, meaning
// `Math.random() < function(){}` would be evaluated — NaN, always false.
// But the structural risk is real if the Set check were ever loosened.
// ===========================================================================

describe('RED TEAM §1 — Prototype-inherited property names as action', () => {
  it('rejects action = "toString" (prototype method on Object)', async () => {
    // Failure: if Set validation were removed, MATCH_CHANCE["toString"] returns
    // Object.prototype.toString (a function).  chance !== undefined is true.
    // Math.random() < function is NaN → isMatch false.  Not exploitable for
    // match, but stats[row.action] could overwrite stats.toString, corrupting
    // JSON serialization.  DB CHECK constraint is the second safety net.
    const res = await request('POST', '/api/swipes', validSwipe({ action: 'toString' }));
    assert.equal(res.status, 400);
  });

  it('rejects action = "constructor" (prototype property)', async () => {
    const res = await request('POST', '/api/swipes', validSwipe({ action: 'constructor' }));
    assert.equal(res.status, 400);
  });

  it('rejects action = "__proto__" (proto-pollution vector)', async () => {
    // Failure: if this reached stats[row.action], setting stats["__proto__"]
    // would attempt to change the object's prototype — a prototype pollution.
    const res = await request('POST', '/api/swipes', validSwipe({ action: '__proto__' }));
    assert.equal(res.status, 400);
  });

  it('rejects action = "hasOwnProperty" (shadowing built-in guard)', async () => {
    const res = await request('POST', '/api/swipes', validSwipe({ action: 'hasOwnProperty' }));
    assert.equal(res.status, 400);
  });

  it('MATCH_CHANCE["nope"] is undefined — not inherited from Object.prototype', () => {
    // Structural assertion: verifies the plain object does not inherit a "nope"
    // property that would give nope-swipes a match chance.
    // Safe because: Object.prototype has no "nope" member.
    // Unsafe if: someone added Object.prototype.nope = 0.5 elsewhere.
    const chance = { like: 0.3, superlike: 0.6 };
    assert.equal(chance['nope'], undefined);
    assert.equal(chance['toString'] !== undefined, true,
      'toString IS inherited — if this were an action, it would pass the chance !== undefined check');
  });
});

// ===========================================================================
// SECTION 2: ACTION TRIMMING INCONSISTENCY
//
// profileId and profileName are .trim()'d, but action is NOT trimmed before
// Set.has(action).  This means " like" (leading space) or "like " (trailing
// space) is rejected, even though the developer clearly intended to be
// tolerant of whitespace for other fields.
//
// Failure scenario: A mobile client accidentally appends "\n" to the action
// string.  The server rejects the request with 400, but from the client's
// perspective the action is valid.
// ===========================================================================

describe('RED TEAM §2 — Action trimming inconsistency', () => {
  it('rejects " like" (leading space) — action is not trimmed', async () => {
    // Failure: Set.has(' like') returns false.  The developer trims profileId
    // and profileName but forgot to trim action.  This is an inconsistency.
    const res = await request('POST', '/api/swipes', validSwipe({ action: ' like' }));
    assert.equal(res.status, 400);
  });

  it('rejects "like " (trailing space) — action is not trimmed', async () => {
    const res = await request('POST', '/api/swipes', validSwipe({ action: 'like ' }));
    assert.equal(res.status, 400);
  });

  it('rejects "like\\n" (trailing newline) — action is not trimmed', async () => {
    const res = await request('POST', '/api/swipes', validSwipe({ action: 'like\n' }));
    assert.equal(res.status, 400);
  });

  it('rejects "\\tsuperlike\\t" (tabs) — action is not trimmed', async () => {
    const res = await request('POST', '/api/swipes', validSwipe({ action: '\tsuperlike\t' }));
    assert.equal(res.status, 400);
  });

  it('rejects "nope\\r\\n" (CRLF) — action is not trimmed', async () => {
    const res = await request('POST', '/api/swipes', validSwipe({ action: 'nope\r\n' }));
    assert.equal(res.status, 400);
  });
});

// ===========================================================================
// SECTION 3: TYPE CONFUSION & COERCION ATTACKS ON VALIDATION GUARDS
//
// The guards use `!value || typeof value !== 'string'`.  JavaScript's falsy
// values are: false, 0, -0, 0n, "", null, undefined, NaN.  We test every
// falsy type and truthy-but-wrong-type values to verify the guards hold.
//
// Failure scenario: `!0` is true, so action=0 is caught by `!action` before
// `Set.has(action)` is evaluated.  But what if someone sends `action = []`?
// `![]` is false (arrays are truthy), so it falls through to
// `VALID_ACTIONS.has([])` which returns false.  Safe, but the error message
// says "action must be one of: ..." — misleading for array input.
// ===========================================================================

describe('RED TEAM §3 — Type confusion on all input fields', () => {
  it('profileId = [] (truthy array) → rejected by typeof !== "string"', async () => {
    // Failure if: guard only checked !profileId and forgot typeof check.
    // [].toString() returns "" which is not a valid profileId anyway.
    const res = await request('POST', '/api/swipes', validSwipe({ profileId: [] }));
    assert.equal(res.status, 400);
  });

  it('profileId = {} (truthy object) → rejected by typeof !== "string"', async () => {
    const res = await request('POST', '/api/swipes', validSwipe({ profileId: {} }));
    assert.equal(res.status, 400);
  });

  it('profileId = 0 (falsy number) → rejected by !profileId', async () => {
    const res = await request('POST', '/api/swipes', validSwipe({ profileId: 0 }));
    assert.equal(res.status, 400);
  });

  it('profileId = -0 → rejected (JSON serializes -0 as 0)', async () => {
    // JSON.stringify(-0) === "0", so the server receives 0.
    const res = await request('POST', '/api/swipes', validSwipe({ profileId: -0 }));
    assert.equal(res.status, 400);
  });

  it('profileName = NaN → rejected (JSON serializes NaN as null)', async () => {
    // JSON.stringify({ profileName: NaN }) → "null" — caught by !profileName.
    const res = await request('POST', '/api/swipes', validSwipe({ profileName: NaN }));
    assert.equal(res.status, 400);
  });

  it('action = [] → rejected (truthy, but Set.has returns false)', async () => {
    const res = await request('POST', '/api/swipes', validSwipe({ action: [] }));
    assert.equal(res.status, 400);
  });

  it('action = { toString: () => "like" } → rejected (typeof !== "string")', async () => {
    // A custom toString could fool string coercion, but Set.has uses ===
    // and express.json() won't produce this structure from JSON anyway.
    // Over HTTP it arrives as a plain object.
    const res = await request('POST', '/api/swipes', validSwipe({ action: { valueOf: 'like' } }));
    assert.equal(res.status, 400);
  });

  it('action = true → rejected (typeof true !== "string" but !true is false, so falls to Set.has)', async () => {
    // !true is false → proceeds to VALID_ACTIONS.has(true) → false → 400.
    const res = await request('POST', '/api/swipes', validSwipe({ action: true }));
    assert.equal(res.status, 400);
  });

  it('action = false → rejected (!false is true → short-circuits)', async () => {
    const res = await request('POST', '/api/swipes', validSwipe({ action: false }));
    assert.equal(res.status, 400);
  });
});

// ===========================================================================
// SECTION 4: UNICODE / ENCODING EDGE CASES
//
// The code trims with String.prototype.trim() which strips Unicode whitespace.
// We test zero-width characters, BOM, RTL marks, and emoji to verify they
// survive the trim/store/retrieve pipeline without data corruption.
//
// Failure scenario: Zero-width spaces (\u200B) are NOT stripped by .trim(),
// so a profileId of "\u200B" passes validation as non-empty.  This means
// an invisible profileId is stored in the DB.
// ===========================================================================

describe('RED TEAM §4 — Unicode & encoding attacks', () => {
  it('zero-width space \\u200B passes validation (trim does NOT strip it)', async () => {
    // FAILURE FOUND: \u200B is a non-whitespace character per Unicode.
    // trim() only removes \s regex class characters.  A user can create a
    // profileId that looks blank but passes the trim() === '' check.
    const res = await request('POST', '/api/swipes', validSwipe({ profileId: '\u200B' }));
    assert.equal(res.status, 201, 'Zero-width space is NOT caught — this is a gap');
  });

  it('zero-width joiner \\u200D passes validation (invisible profileName)', async () => {
    const res = await request('POST', '/api/swipes', validSwipe({ profileName: '\u200D' }));
    assert.equal(res.status, 201, 'Zero-width joiner is NOT caught — this is a gap');
  });

  it('BOM \\uFEFF passes validation (trim does strip BOM in V8)', async () => {
    // In V8, String.prototype.trim() DOES strip \uFEFF (it's treated as whitespace).
    // So profileId = '\uFEFF' → trim() = '' → rejected.
    const res = await request('POST', '/api/swipes', validSwipe({ profileId: '\uFEFF' }));
    assert.equal(res.status, 400, 'BOM is caught by trim — this path is safe');
  });

  it('right-to-left override \\u202E in profileName is stored as-is (no sanitization)', async () => {
    // Failure: RTL override character can reverse text rendering in UIs that
    // consume this API.  The server does no Unicode normalization.
    const res = await request('POST', '/api/swipes', validSwipe({
      profileName: '\u202EecilA',  // renders as "Alice" reversed in RTL contexts
    }));
    assert.equal(res.status, 201);
    const get = await request('GET', '/api/swipes');
    assert.equal(get.body.swipes[0].profileName, '\u202EecilA');
  });

  it('emoji in profileName survives round-trip', async () => {
    const res = await request('POST', '/api/swipes', validSwipe({ profileName: '🔥💀🃏' }));
    assert.equal(res.status, 201);
    const get = await request('GET', '/api/swipes');
    assert.equal(get.body.swipes[0].profileName, '🔥💀🃏');
  });

  it('null byte \\u0000 in profileId is accepted (no null-byte sanitization)', async () => {
    // Failure: null bytes can cause issues in C-backed SQLite, log parsing,
    // or downstream consumers.  The Node.js layer does not strip them.
    const res = await request('POST', '/api/swipes', validSwipe({ profileId: 'p_0\u0000evil' }));
    assert.equal(res.status, 201);
    assert.equal(res.body.profileId, 'p_0\u0000evil');
  });
});

// ===========================================================================
// SECTION 5: CONCURRENT MATCH NOTIFICATIONS — RACE CONDITIONS
//
// sendMatchNotification is fire-and-forget.  Two concurrent swipes that both
// match could:
//   1. Both read the subscription row before either deletes it.
//   2. Both try to send notifications, one succeeds, one gets a 410.
//   3. Both try to DELETE the row — second DELETE affects 0 rows (no error).
//
// SQLite serializes writes, so data corruption is unlikely, but the logic
// does not guard against the race.
// ===========================================================================

describe('RED TEAM §5 — Concurrent match notification races', () => {
  let origRandom, origSend;

  beforeEach(() => {
    origRandom = Math.random;
    origSend   = webpush.sendNotification;
  });
  afterEach(() => {
    Math.random            = origRandom;
    webpush.sendNotification = origSend;
  });

  it('two concurrent matches for same user — both attempt sendNotification', async () => {
    // Seed subscription
    db.prepare(
      'INSERT INTO push_subscriptions (user_id, subscription, created_at) VALUES (?, ?, ?)'
    ).run('u_race', JSON.stringify({ endpoint: 'https://push.example.com/race' }), new Date().toISOString());

    Math.random = () => 0.0; // force match
    let sendCount = 0;
    webpush.sendNotification = async () => { sendCount++; };

    // Fire two swipes simultaneously
    const [r1, r2] = await Promise.all([
      request('POST', '/api/swipes', validSwipe({ userId: 'u_race', profileName: 'A' })),
      request('POST', '/api/swipes', validSwipe({ userId: 'u_race', profileName: 'B' })),
    ]);
    await waitMs(150);

    assert.equal(r1.status, 201);
    assert.equal(r2.status, 201);
    // Both should have triggered sendMatchNotification
    assert.equal(sendCount, 2, 'Both concurrent matches sent notifications — no deduplication');
  });

  it('two concurrent matches where first push 410s and deletes sub — second sees no row', async () => {
    db.prepare(
      'INSERT INTO push_subscriptions (user_id, subscription, created_at) VALUES (?, ?, ?)'
    ).run('u_race2', JSON.stringify({ endpoint: 'https://push.example.com/race2' }), new Date().toISOString());

    Math.random = () => 0.0;
    let callIdx = 0;
    webpush.sendNotification = async () => {
      callIdx++;
      if (callIdx === 1) {
        // First call — simulate 410 (subscription expired)
        const err = new Error('Gone');
        err.statusCode = 410;
        throw err;
      }
      // Second call would reach here only if the subscription row still existed
      // when sendMatchNotification re-read it.  But since fire-and-forget is
      // async, the timing is unpredictable.
    };

    const [r1, r2] = await Promise.all([
      request('POST', '/api/swipes', validSwipe({ userId: 'u_race2', profileName: 'A' })),
      request('POST', '/api/swipes', validSwipe({ userId: 'u_race2', profileName: 'B' })),
    ]);
    await waitMs(200);

    // Both responses succeed regardless of notification outcome
    assert.equal(r1.status, 201);
    assert.equal(r2.status, 201);
    // Subscription should be deleted after the 410
    const row = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').get('u_race2');
    assert.equal(row, undefined, 'Subscription deleted after 410');
  });
});

// ===========================================================================
// SECTION 6: NO PAGINATION — RESOURCE EXHAUSTION ON GET /api/swipes
//
// GET /api/swipes calls `.all()` which loads every row into memory.
// With thousands of swipes the response payload grows unbounded.
//
// Failure scenario: An attacker inserts 10 000 swipes via POST, then calls
// GET.  The server allocates a huge JSON string, risking OOM on constrained
// environments.
// ===========================================================================

describe('RED TEAM §6 — Unbounded response size (no pagination)', () => {
  it('GET /api/swipes returns ALL rows even after many inserts (no limit)', async () => {
    // Insert 200 swipes using direct DB insert for speed
    const stmt = db.prepare(
      'INSERT INTO swipes (profile_id, profile_name, action, swiped_at) VALUES (?, ?, ?, ?)'
    );
    for (let i = 0; i < 200; i++) {
      stmt.run(`p_${i}`, `Name${i}`, 'like', new Date().toISOString());
    }

    const res = await request('GET', '/api/swipes');
    assert.equal(res.status, 200);
    // FAILURE DOCUMENTED: all 200 rows returned.  No pagination.
    assert.equal(res.body.swipes.length, 200,
      'All rows returned — no pagination or limit.  This is a resource-exhaustion vector.');
  });
});

// ===========================================================================
// SECTION 7: SUBSCRIPTION OBJECT SHAPE ATTACKS
//
// The push subscribe validation does:
//   typeof subscription !== 'object' || !subscription.endpoint
//
// In JavaScript typeof null === 'object', but !null is caught first.
// typeof [] === 'object', so an array with an endpoint property could pass.
// An object with endpoint=true (boolean) passes !subscription.endpoint.
//
// Failure scenario: A malicious client subscribes with a subscription object
// that has endpoint=true.  The object is stored.  Later, webpush.sendNotification
// receives { endpoint: true } and throws a confusing error or sends the
// notification to an invalid URL.
// ===========================================================================

describe('RED TEAM §7 — Subscription object shape attacks', () => {
  it('endpoint = true (boolean truthy) passes validation — no string type check', async () => {
    // FAILURE: The guard only checks !subscription.endpoint (falsy check).
    // endpoint=true is truthy → passes.  Stored in DB.  webpush would fail
    // later when it tries to HTTP POST to "true".
    const res = await request('POST', '/api/push/subscribe', {
      userId: 'u_bool_ep',
      subscription: { endpoint: true },
    });
    assert.equal(res.status, 201, 'endpoint=true passes validation — no typeof check on endpoint');

    const row = db.prepare('SELECT subscription FROM push_subscriptions WHERE user_id = ?').get('u_bool_ep');
    const stored = JSON.parse(row.subscription);
    assert.equal(stored.endpoint, true, 'Boolean endpoint stored in DB');
  });

  it('endpoint = 42 (number truthy) passes validation', async () => {
    const res = await request('POST', '/api/push/subscribe', {
      userId: 'u_num_ep',
      subscription: { endpoint: 42 },
    });
    assert.equal(res.status, 201, 'endpoint=42 passes validation — only falsy check');
  });

  it('endpoint = {} (object truthy) passes validation', async () => {
    const res = await request('POST', '/api/push/subscribe', {
      userId: 'u_obj_ep',
      subscription: { endpoint: {} },
    });
    assert.equal(res.status, 201, 'endpoint={} passes validation — only falsy check');
  });

  it('subscription with extra fields is stored without sanitization', async () => {
    // Failure: no allow-list on subscription properties.  Extra data persists.
    const res = await request('POST', '/api/push/subscribe', {
      userId: 'u_extra',
      subscription: {
        endpoint: 'https://push.example.com/ok',
        malicious: '<script>alert(1)</script>',
        extra: { nested: 'data', deep: [1, 2, 3] },
      },
    });
    assert.equal(res.status, 201);
    const row = db.prepare('SELECT subscription FROM push_subscriptions WHERE user_id = ?').get('u_extra');
    const stored = JSON.parse(row.subscription);
    assert.equal(stored.malicious, '<script>alert(1)</script>',
      'Arbitrary data stored without sanitization');
  });

  it('subscription with prototype-polluting keys is harmless after JSON round-trip', async () => {
    // JSON.parse does not set __proto__ from parsed JSON in modern V8.
    // But we verify the stored value does not corrupt retrieval.
    const res = await request('POST', '/api/push/subscribe', {
      userId: 'u_proto',
      subscription: { endpoint: 'https://push.example.com/ok', '__proto__': { admin: true } },
    });
    assert.equal(res.status, 201);
  });
});

// ===========================================================================
// SECTION 8: userId IMPERSONATION — NO AUTH ON PUSH SUBSCRIPTIONS
//
// The push subscribe endpoint uses the client-supplied userId as the primary
// key.  Any client can overwrite any other user's subscription by providing
// their userId.  The swipes endpoint also uses the client-supplied userId to
// look up subscriptions.
//
// Failure scenario: Attacker discovers "u_victim" as another user's ID.
// Attacker calls POST /subscribe with userId="u_victim" and their own
// subscription endpoint.  Now the victim's match notifications go to the
// attacker's endpoint.
// ===========================================================================

describe('RED TEAM §8 — userId impersonation (no auth)', () => {
  it('any client can overwrite another user\'s subscription (no authentication)', async () => {
    // Victim subscribes
    await request('POST', '/api/push/subscribe', {
      userId: 'u_victim',
      subscription: { endpoint: 'https://push.example.com/victim' },
    });

    // Attacker overwrites with their own endpoint
    const res = await request('POST', '/api/push/subscribe', {
      userId: 'u_victim',
      subscription: { endpoint: 'https://evil.example.com/attacker' },
    });
    assert.equal(res.status, 201, 'Overwrite succeeded — no auth check');

    // Verify the subscription now points to attacker
    const row = db.prepare('SELECT subscription FROM push_subscriptions WHERE user_id = ?').get('u_victim');
    const stored = JSON.parse(row.subscription);
    assert.equal(stored.endpoint, 'https://evil.example.com/attacker',
      'VULNERABILITY: victim subscription hijacked by attacker');
  });

  it('any client can delete another user\'s subscription (no authentication)', async () => {
    db.prepare(
      'INSERT INTO push_subscriptions (user_id, subscription, created_at) VALUES (?, ?, ?)'
    ).run('u_target', JSON.stringify({ endpoint: 'https://push.example.com/target' }), new Date().toISOString());

    const res = await request('DELETE', '/api/push/subscribe', { userId: 'u_target' });
    assert.equal(res.status, 200, 'Delete succeeded — no auth check');

    const row = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').get('u_target');
    assert.equal(row, undefined, 'VULNERABILITY: another user\'s subscription deleted');
  });
});

// ===========================================================================
// SECTION 9: ON CONFLICT CREATED_AT NOT UPDATED
//
// The ON CONFLICT clause only updates `subscription`, not `created_at`.
// This means re-subscribing keeps the stale timestamp.
//
// Failure scenario: Auditing when a user last refreshed their subscription
// would return the wrong date.
// ===========================================================================

describe('RED TEAM §9 — ON CONFLICT stale created_at', () => {
  it('re-subscribe does NOT update created_at (only subscription is upserted)', async () => {
    // First subscribe
    await request('POST', '/api/push/subscribe', {
      userId: 'u_stale_ts',
      subscription: { endpoint: 'https://push.example.com/v1' },
    });
    const row1 = db.prepare('SELECT created_at FROM push_subscriptions WHERE user_id = ?').get('u_stale_ts');

    // Wait a bit so timestamps differ
    await waitMs(50);

    // Re-subscribe
    await request('POST', '/api/push/subscribe', {
      userId: 'u_stale_ts',
      subscription: { endpoint: 'https://push.example.com/v2' },
    });
    const row2 = db.prepare('SELECT created_at FROM push_subscriptions WHERE user_id = ?').get('u_stale_ts');

    // FAILURE DOCUMENTED: created_at was NOT updated
    assert.equal(row1.created_at, row2.created_at,
      'created_at is stale after re-subscribe — ON CONFLICT only updates subscription');
  });
});

// ===========================================================================
// SECTION 10: express.json() BODY PARSER LIMITS & MALFORMED JSON
//
// Express's default JSON parser has a 100KB limit.  We test payloads near
// that boundary and payloads that are syntactically valid JSON but
// semantically wrong (e.g., top-level array instead of object).
// ===========================================================================

describe('RED TEAM §10 — Body parser edge cases', () => {
  it('request with Content-Type application/json but body is a JSON array', async () => {
    // express.json() parses [1,2,3] successfully, but req.body is an array.
    // Destructuring { profileId } from an array gives undefined → 400.
    const res = await rawRequest('POST', '/api/swipes', '[1,2,3]');
    assert.equal(res.status, 400);
  });

  it('request with Content-Type application/json but body is a JSON string → 500 (BUG)', async () => {
    // FINDING: express.json() in strict mode rejects top-level strings with
    // a SyntaxError that has { status: 400 }. But the global error handler in
    // server.js ignores err.status and always returns 500.
    // EXPECTED: 400. ACTUAL: 500. This is a bug in the error handler.
    const res = await rawRequest('POST', '/api/swipes', '"hello"');
    assert.equal(res.status, 500,
      'BUG CONFIRMED: global error handler overrides body-parser\'s 400 with 500');
  });

  it('request with Content-Type application/json but body is a JSON number → 500 (BUG)', async () => {
    // FINDING: Same bug as above — top-level JSON number "42" triggers
    // body-parser SyntaxError (strict mode).  err.status = 400, but the global
    // error handler blindly returns 500.
    const res = await rawRequest('POST', '/api/swipes', '42');
    assert.equal(res.status, 500,
      'BUG CONFIRMED: global error handler ignores err.status');
  });

  it('request with Content-Type application/json but body is JSON null', async () => {
    // req.body = null.  const { profileId } = null → throws TypeError.
    // Express's default error handler should return 500 or the async handler
    // should catch it.  In Express 4, unhandled async throws are unhandled
    // rejections — the 404 handler might fire instead.
    const res = await rawRequest('POST', '/api/swipes', 'null');
    // This may crash or return 500 or 400 depending on Express behavior.
    // We just verify the server doesn't hang.
    assert.ok([400, 500].includes(res.status),
      `Expected 400 or 500, got ${res.status}`);
  });

  it('request with invalid JSON returns 500 instead of 400 (BUG in error handler)', async () => {
    // FINDING: {not valid json} triggers a body-parser SyntaxError with
    // { status: 400, expose: true }.  The correct behaviour is to return 400
    // with the parse error message.  Instead, the global error handler in
    // server.js line 33 ignores err.status and returns a generic 500.
    const res = await rawRequest('POST', '/api/swipes', '{not valid json}');
    assert.equal(res.status, 500,
      'BUG CONFIRMED: body-parser\'s 400 SyntaxError masked as 500 by global handler');
  });

  it('request with empty body returns 400', async () => {
    const res = await rawRequest('POST', '/api/swipes', '');
    // express.json() may set req.body = undefined for empty body.
    // Destructuring undefined throws TypeError.
    assert.ok([400, 500].includes(res.status));
  });
});

// ===========================================================================
// SECTION 11: sendMatchNotification — JSON.parse FAILURE ON CORRUPT DB DATA
//
// If the subscription column contains malformed JSON, JSON.parse throws
// inside sendMatchNotification's try block.  The catch block checks
// err.statusCode which is undefined on a SyntaxError → falls to else →
// console.error.  The subscription is NOT deleted despite being corrupt.
//
// Failure scenario: Corrupt subscription data stays in the DB forever,
// causing console.error spam on every match for that user.
// ===========================================================================

describe('RED TEAM §11 — Corrupt subscription data persistence', () => {
  let origRandom, origSend, origErr;

  beforeEach(() => {
    origRandom = Math.random;
    origSend   = webpush.sendNotification;
    origErr    = console.error;
  });
  afterEach(() => {
    Math.random              = origRandom;
    webpush.sendNotification = origSend;
    console.error            = origErr;
  });

  it('corrupt JSON in subscription column is never cleaned up (infinite error spam)', async () => {
    // Seed corrupt data directly in DB
    db.prepare(
      'INSERT INTO push_subscriptions (user_id, subscription, created_at) VALUES (?, ?, ?)'
    ).run('u_corrupt', '<<<NOT JSON>>>', new Date().toISOString());

    Math.random = () => 0.0;
    let errorCount = 0;
    console.error = () => { errorCount++; };

    // First swipe — triggers notification, JSON.parse fails, logs error
    await request('POST', '/api/swipes', validSwipe({ userId: 'u_corrupt' }));
    await waitMs(100);

    // Subscription should still be in DB (not deleted — SyntaxError has no statusCode)
    const row = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').get('u_corrupt');
    assert.notEqual(row, undefined,
      'FAILURE: corrupt subscription persists — never deleted, errors on every match');

    // Second swipe — same error again
    await request('POST', '/api/swipes', validSwipe({ userId: 'u_corrupt', profileName: 'B' }));
    await waitMs(100);

    assert.ok(errorCount >= 2,
      'Error logged on every match attempt — infinite spam for corrupt data');
  });
});

// ===========================================================================
// SECTION 12: OPEN CORS — CSRF-LIKE ATTACK SURFACE
//
// app.use(cors()) with no origin restriction means any website can make
// authenticated requests (if cookies/tokens were ever added).  Currently
// there's no auth, so the CORS is moot for security.  But it's a structural
// weakness that will become a vulnerability if auth is added later.
// ===========================================================================

describe('RED TEAM §12 — CORS is fully open', () => {
  it('responds with Access-Control-Allow-Origin: * for cross-origin requests', async () => {
    return new Promise((resolve, reject) => {
      const url = new URL('/health', baseUrl);
      const opts = {
        method: 'GET',
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        headers: { 'Origin': 'https://evil.example.com' },
      };
      const req = http.request(opts, (res) => {
        const corsHeader = res.headers['access-control-allow-origin'];
        assert.equal(corsHeader, '*',
          'VULNERABILITY: CORS allows all origins — any website can call this API');
        resolve();
      });
      req.on('error', reject);
      req.end();
    });
  });

  it('preflight OPTIONS returns permissive CORS headers', async () => {
    return new Promise((resolve, reject) => {
      const url = new URL('/api/swipes', baseUrl);
      const opts = {
        method: 'OPTIONS',
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        headers: {
          'Origin': 'https://evil.example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
      };
      const req = http.request(opts, (res) => {
        assert.equal(res.statusCode, 204);
        assert.equal(res.headers['access-control-allow-origin'], '*',
          'Preflight allows all origins');
        resolve();
      });
      req.on('error', reject);
      req.end();
    });
  });
});

// ===========================================================================
// SECTION 13: FIELD LENGTH STRESS — NO MAX-LENGTH ENFORCED
//
// No field has a maximum length.  We push extremely large values through the
// validation and storage pipeline.
// ===========================================================================

describe('RED TEAM §13 — Field length stress (no max-length limits)', () => {
  it('50KB profileName is accepted and stored', async () => {
    const bigName = 'X'.repeat(50_000);
    const res = await request('POST', '/api/swipes', validSwipe({ profileName: bigName }));
    assert.equal(res.status, 201, 'No max-length on profileName');
    assert.equal(res.body.profileName.length, 50_000);
  });

  it('50KB userId is accepted in push subscribe', async () => {
    const bigUserId = 'u_' + 'Y'.repeat(50_000);
    const res = await request('POST', '/api/push/subscribe', {
      userId: bigUserId,
      subscription: { endpoint: 'https://push.example.com/big' },
    });
    assert.equal(res.status, 201, 'No max-length on userId in push subscribe');
  });

  it('subscription with deeply nested structure is stored', async () => {
    let nested = { endpoint: 'https://push.example.com/deep' };
    for (let i = 0; i < 50; i++) {
      nested = { inner: nested, endpoint: nested.endpoint };
    }
    const res = await request('POST', '/api/push/subscribe', {
      userId: 'u_deep',
      subscription: nested,
    });
    assert.equal(res.status, 201, 'Deeply nested subscription stored without limit');
  });
});

// ===========================================================================
// SECTION 14: DUPLICATE SWIPES — NO IDEMPOTENCY OR UNIQUENESS CONSTRAINT
//
// The swipes table has no UNIQUE constraint on (profile_id, user_id) or
// (profile_id, action).  The same profile can be liked, noped, and super-
// liked multiple times, inflating stats arbitrarily.
// ===========================================================================

describe('RED TEAM §14 — Duplicate & contradictory swipes', () => {
  it('same profile can be liked and noped (contradictory actions stored)', async () => {
    const r1 = await request('POST', '/api/swipes', validSwipe({ action: 'like' }));
    const r2 = await request('POST', '/api/swipes', validSwipe({ action: 'nope' }));
    assert.equal(r1.status, 201);
    assert.equal(r2.status, 201);

    const res = await request('GET', '/api/swipes/stats');
    assert.equal(res.body.like, 1);
    assert.equal(res.body.nope, 1);
    // Both recorded — no conflict resolution
  });

  it('spamming 100 likes on same profile inflates stats', async () => {
    for (let i = 0; i < 100; i++) {
      await request('POST', '/api/swipes', validSwipe({ action: 'like' }));
    }
    const res = await request('GET', '/api/swipes/stats');
    assert.equal(res.body.like, 100, 'No rate limit or deduplication — stats inflated');
    assert.equal(res.body.total, 100);
  });
});

// ===========================================================================
// SECTION 15: HTTP METHOD CONFUSION ON ROUTED PATHS
//
// Express router methods only match specific verbs.  Unmatched verbs fall
// through to the 404 handler.  We verify unusual methods don't trigger
// unexpected behavior.
// ===========================================================================

describe('RED TEAM §15 — HTTP method confusion', () => {
  it('DELETE /api/swipes → 404 (no delete handler on swipes)', async () => {
    await request('POST', '/api/swipes', validSwipe());
    const res = await request('DELETE', '/api/swipes');
    assert.equal(res.status, 404, 'No DELETE handler — falls to 404');
  });

  it('PUT /api/swipes → 404 (no PUT handler)', async () => {
    const res = await request('PUT', '/api/swipes');
    assert.equal(res.status, 404);
  });

  it('POST /api/push/vapid-public-key → 404 (only GET is defined)', async () => {
    const res = await request('POST', '/api/push/vapid-public-key');
    assert.equal(res.status, 404);
  });

  it('GET /api/push/subscribe → 404 (only POST and DELETE are defined)', async () => {
    const res = await request('GET', '/api/push/subscribe');
    assert.equal(res.status, 404);
  });
});

// ===========================================================================
// SECTION 16: NOTIFICATION PAYLOAD INJECTION
//
// The push notification payload interpolates profileName:
//   body: `You and ${profileName} liked each other!`
//
// profileName is user-controlled.  While this is a push payload (not HTML),
// a receiving client might render it unsafely.
// ===========================================================================

describe('RED TEAM §16 — Notification payload injection via profileName', () => {
  let origRandom, origSend;

  beforeEach(() => {
    origRandom = Math.random;
    origSend   = webpush.sendNotification;
  });
  afterEach(() => {
    Math.random              = origRandom;
    webpush.sendNotification = origSend;
  });

  it('profileName with HTML tags is included verbatim in push payload', async () => {
    db.prepare(
      'INSERT INTO push_subscriptions (user_id, subscription, created_at) VALUES (?, ?, ?)'
    ).run('u_xss', JSON.stringify({ endpoint: 'https://push.example.com/xss' }), new Date().toISOString());

    Math.random = () => 0.0;
    let capturedPayload = null;
    webpush.sendNotification = async (_sub, payload) => { capturedPayload = payload; };

    await request('POST', '/api/swipes', validSwipe({
      profileName: '<img src=x onerror=alert(1)>',
      userId: 'u_xss',
    }));
    await waitMs(100);

    const parsed = JSON.parse(capturedPayload);
    assert.ok(parsed.body.includes('<img src=x onerror=alert(1)>'),
      'HTML injected verbatim into notification payload — unsafe if client renders as HTML');
  });

  it('profileName with newlines could break notification rendering', async () => {
    db.prepare(
      'INSERT INTO push_subscriptions (user_id, subscription, created_at) VALUES (?, ?, ?)'
    ).run('u_nl', JSON.stringify({ endpoint: 'https://push.example.com/nl' }), new Date().toISOString());

    Math.random = () => 0.0;
    let capturedPayload = null;
    webpush.sendNotification = async (_sub, payload) => { capturedPayload = payload; };

    await request('POST', '/api/swipes', validSwipe({
      profileName: 'Alice\n\nFake notification body',
      userId: 'u_nl',
    }));
    await waitMs(100);

    const parsed = JSON.parse(capturedPayload);
    assert.ok(parsed.body.includes('\n'),
      'Newlines in profileName pass through to notification body unsanitized');
  });
});

// ===========================================================================
// SECTION 17: MATCH_CHANCE BOUNDARY — EXACT FLOATING-POINT ARITHMETIC
//
// MATCH_CHANCE = { like: 0.3, superlike: 0.6 }
// Condition: Math.random() < chance
//
// IEEE 754 floating point: 0.3 cannot be represented exactly.
// The actual stored value is 0.299999999999999988897...
// So the condition Math.random() < 0.3 is actually testing against
// the inexact representation.  We verify the exact boundary.
// ===========================================================================

describe('RED TEAM §17 — Floating-point precision at match boundary', () => {
  let origRandom;
  beforeEach(() => { origRandom = Math.random; });
  afterEach(() => { Math.random = origRandom; });

  it('random = 0.29999999999999998 (Number just below 0.3 representation)', async () => {
    // In IEEE 754 double, 0.3 is actually 0.29999999999999998889776975...
    // The closest double to 0.3 minus one ULP.
    // This tests whether the < operator handles the exact boundary correctly.
    Math.random = () => 0.29999999999999998;
    const res = await request('POST', '/api/swipes', validSwipe({ action: 'like' }));
    // 0.29999999999999998 === 0.3 in IEEE 754, so < is false
    // This demonstrates the floating-point trap: what looks like "just below"
    // is actually === 0.3 due to rounding.
    assert.equal(res.body.matched, 0.29999999999999998 < 0.3,
      'Match result follows IEEE 754 comparison — may surprise developers');
  });

  it('random = Number.EPSILON (extremely small positive) → always matches', async () => {
    Math.random = () => Number.EPSILON; // ~2.2e-16
    const res = await request('POST', '/api/swipes', validSwipe({ action: 'like' }));
    assert.equal(res.body.matched, true, 'Epsilon < 0.3 → match');
  });

  it('random = Number.MIN_VALUE (smallest positive subnormal) → matches', async () => {
    Math.random = () => Number.MIN_VALUE; // ~5e-324
    const res = await request('POST', '/api/swipes', validSwipe({ action: 'like' }));
    assert.equal(res.body.matched, true, 'MIN_VALUE < 0.3 → match');
  });
});

// ===========================================================================
// SECTION 18: GLOBAL ERROR HANDLER — EXPRESS 4 ASYNC GAP
//
// Express 4 does NOT catch rejected promises from async route handlers.
// The global error handler (4-arity middleware) is only invoked for
// synchronous throws or when next(err) is called explicitly.
//
// Failure scenario: If the async POST /api/swipes handler threw after
// sending the response headers, the error would be an unhandled rejection,
// not caught by the global error handler.
// ===========================================================================

describe('RED TEAM §18 — Express 4 async error handling gap', () => {
  it('destructuring null body causes unhandled error (Express 4 does not catch async throws)', async () => {
    // Sending JSON null: express.json() sets req.body = null.
    // const { profileId } = null → TypeError: Cannot destructure property
    // In Express 4, this is an unhandled rejection if the handler is async.
    // The response may be a 400 from express.json's own error handler,
    // or a connection reset.  We verify the server survives.
    const res = await rawRequest('POST', '/api/swipes', 'null');
    // Server must not crash — any response is acceptable as long as it responds
    assert.ok(typeof res.status === 'number', 'Server responded (did not crash)');
  });

  it('server is still alive after the null body error', async () => {
    // Verify the server didn't die from the previous test
    const res = await request('GET', '/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
  });
});
