/**
 * SessionCache tests (task 70) — pins the analysis-session persistence:
 * UUID ids, save/load roundtrip with metadata, overwrite/resume,
 * TTL expiry with on-read purge, delete/has, metadata listing,
 * deterministic pruning (expired + oldest-over-cap eviction), typed
 * failures (invalid_id incl. traversal rejection, not_serializable
 * with no leftover files, io_error), corrupt-file tolerance and
 * deterministic bytes for identical inputs. Real fs in a temp dir;
 * the clock is injected for TTL determinism.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.QLOO_API_KEY = 'session-cache-test-key';

const {
  createSessionId,
  saveSession,
  loadSession,
  hasSession,
  deleteSession,
  listSessions,
  pruneSessions,
  sessionDefaults,
  SessionCacheError,
  SESSION_CODES,
} = await import('../src/services/sessionCache.js');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const tempDirs = [];
async function freshDir() {
  const dir = await mkdtemp(path.join(tmpdir(), 'suto-session-'));
  tempDirs.push(dir);
  return dir;
}

let clock = 1_000_000;
const now = () => clock;

after(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

test('createSessionId: UUID format and uniqueness', () => {
  const a = createSessionId();
  const b = createSessionId();
  assert.match(a, UUID_RE);
  assert.notEqual(a, b);
});

test('save -> load roundtrip with metadata', async () => {
  const baseDir = await freshDir();
  const session = { anchor: { name: 'Blade Runner' }, graph: { nodes: [1, 2], edges: [] } };

  const saved = await saveSession(session, { baseDir, now, ttlMs: 60_000 });

  assert.match(saved.id, UUID_RE);
  assert.ok(saved.path.endsWith(`${saved.id}.json`));
  assert.ok(saved.bytes > 0);
  assert.equal(saved.expiresAt, saved.createdAt + 60_000);
  assert.ok(Object.isFrozen(saved));

  const loaded = await loadSession(saved.id, { baseDir, now });
  assert.deepEqual(loaded.data, session, 'payload intact');
  assert.equal(loaded.id, saved.id);
  assert.equal(loaded.expiresAt, saved.expiresAt);
  assert.ok(Object.isFrozen(loaded));
});

test('explicit id: create or overwrite (resumable sessions)', async () => {
  const baseDir = await freshDir();
  const id = createSessionId();

  await saveSession({ v: 1 }, { baseDir, id, now });
  const again = await saveSession({ v: 2 }, { baseDir, id, now });

  assert.equal(again.id, id, 'same id reused');
  const loaded = await loadSession(id, { baseDir, now });
  assert.deepEqual(loaded.data, { v: 2 }, 'latest write wins');
});

test('TTL: expiry nulls the load and purges the file on the spot', async () => {
  const baseDir = await freshDir();
  const saved = await saveSession({ secret: 'analysis' }, { baseDir, now, ttlMs: 1_000 });

  clock += 1_001;
  assert.equal(await loadSession(saved.id, { baseDir, now }), null, 'expired -> null');
  await assert.rejects(() => readFile(saved.path, 'utf8'), { code: 'ENOENT' }, 'purged');
  clock = 1_000_000;
});

test('unknown id and delete lifecycle', async () => {
  const baseDir = await freshDir();
  assert.equal(await loadSession(createSessionId(), { baseDir, now }), null);
  assert.equal(await hasSession(createSessionId(), { baseDir, now }), false);

  const saved = await saveSession({ a: 1 }, { baseDir, now });
  assert.equal(await hasSession(saved.id, { baseDir, now }), true);
  assert.equal(await deleteSession(saved.id, { baseDir, now }), true);
  assert.equal(await deleteSession(saved.id, { baseDir, now }), false, 'already gone');
  assert.equal(await loadSession(saved.id, { baseDir, now }), null);
});

test('listSessions: metadata only, newest first, live flags', async () => {
  const baseDir = await freshDir();
  const first = await saveSession({ n: 1 }, { baseDir, now, ttlMs: 1_000 });
  clock += 10;
  const second = await saveSession({ n: 2 }, { baseDir, now, ttlMs: 60_000 });
  // Advance past the first TTL WITHOUT another save (an explicit save
  // would opportunistic-prune the expired document).
  clock += 2_000;

  const list = await listSessions({ baseDir, now });
  assert.deepEqual(list.map((s) => s.id), [second.id, first.id], 'newest first');
  assert.equal(list[0].live, true);
  assert.equal(list[1].live, false, 'expired shows as not live');
  assert.ok(list.every((s) => s.data === undefined), 'no payload reads');
  assert.ok(list.every((s) => typeof s.bytes === 'number'));
  assert.ok(Object.isFrozen(list));

  clock = 1_000_000;
});

test('pruneSessions: expired purged opportunistically on save; oldest-over-cap evicted deterministically', async () => {
  const baseDir = await freshDir();
  const doomed = await saveSession({ n: 0 }, { baseDir, now, ttlMs: 1_000 });
  clock += 1_001;
  const a = await saveSession({ n: 1 }, { baseDir, now });
  clock += 1;
  const b = await saveSession({ n: 2 }, { baseDir, now });
  clock += 1;
  const c = await saveSession({ n: 3 }, { baseDir, now });

  // Saving 'a' already purge-swept the expired doomed document — the
  // hygiene is opportunistic by design.
  assert.equal(await hasSession(doomed.id, { baseDir, now }), false);

  const pruned = await pruneSessions({ baseDir, now, maxEntries: 2 });
  assert.deepEqual({ ...pruned }, { removed: 1, remaining: 2 });
  assert.equal(await hasSession(a.id, { baseDir, now }), false, 'oldest evicted');
  assert.equal(await hasSession(b.id, { baseDir, now }), true);
  assert.equal(await hasSession(c.id, { baseDir, now }), true);
  clock = 1_000_000;
});

test('invalid ids are rejected everywhere (traversal impossible)', async () => {
  const baseDir = await freshDir();
  const bad = ['not-a-uuid', '../../etc/passwd', 'a'.repeat(36), 42];
  for (const id of bad) {
    await assert.rejects(
      () => saveSession({ x: 1 }, { baseDir, id, now }),
      (err) => err instanceof SessionCacheError && err.code === SESSION_CODES.INVALID_ID
    );
    await assert.rejects(
      () => loadSession(id, { baseDir, now }),
      (err) => err.code === SESSION_CODES.INVALID_ID
    );
    await assert.rejects(
      () => deleteSession(id, { baseDir, now }),
      (err) => err.code === SESSION_CODES.INVALID_ID
    );
  }
});

test('not_serializable: typed failure, no leftover files', async () => {
  const baseDir = await freshDir();
  const circular = { name: 'x' };
  circular.self = circular;

  await assert.rejects(
    () => saveSession(circular, { baseDir, now }),
    (err) => err instanceof SessionCacheError && err.code === SESSION_CODES.NOT_SERIALIZABLE
  );
  assert.deepEqual(await listSessions({ baseDir, now }), [], 'nothing written');
});

test('io_error: an uncreatable cache dir fails typed', async () => {
  const baseDir = await freshDir();
  const blockingFile = path.join(baseDir, 'blocker');
  await writeFile(blockingFile, 'x', 'utf8');

  await assert.rejects(
    () => saveSession({ a: 1 }, { baseDir: blockingFile, now }),
    (err) => err instanceof SessionCacheError && err.code === SESSION_CODES.IO_ERROR
  );
});

test('corrupt documents: listing ignores them, load reports io_error', async () => {
  const baseDir = await freshDir();
  const good = await saveSession({ ok: true }, { baseDir, now });
  await writeFile(path.join(baseDir, 'garbage.json'), '{not json', 'utf8');

  const list = await listSessions({ baseDir, now });
  assert.deepEqual(list.map((s) => s.id), [good.id], 'garbage skipped');

  const tornId = createSessionId();
  await writeFile(path.join(baseDir, `${tornId}.json`), '{torn', 'utf8');
  await assert.rejects(
    () => loadSession(tornId, { baseDir, now }),
    (err) => err instanceof SessionCacheError && err.code === SESSION_CODES.IO_ERROR
  );
});

test('determinism and env-backed defaults', async () => {
  const baseDir = await freshDir();
  const id = createSessionId();
  const session = { anchor: { name: 'Dune' }, layers: { sound: { artists: [] } } };

  const first = await saveSession(session, { baseDir, id, now });
  const second = await saveSession(session, { baseDir, id, now });
  assert.equal(first.bytes, second.bytes, 'identical payloads -> identical bytes');
  assert.deepEqual(first, second);

  const defaults = sessionDefaults();
  assert.equal(defaults.baseDir, '.cache/sessions');
  assert.equal(defaults.ttlMs, 3_600_000);
  assert.equal(defaults.maxEntries, 50);
});
