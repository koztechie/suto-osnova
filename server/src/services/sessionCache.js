/**
 * SessionCache (task 70) — persistence of a generated ANALYSIS SESSION
 * into a local temporary cache keyed by a unique session UUID.
 *
 * WHAT IS STORED: the full deterministic session record the pipeline
 * produces (anchor, resolution, expansion, extractor layers, notes,
 * tonality, graph, weights, synthesis — tasks 41-69). The payload is
 * CULTURAL by the tasks-25/47 contract (no personal data), local-only
 * and temporary: every record carries an expiry and is purged on read
 * or by pruning.
 *
 * FILE LAYOUT: {baseDir}/{uuid}.json — one JSON document per session
 * {id, createdAt, expiresAt, data}. The id is validated against the
 * UUID format BEFORE any path join (traversal impossible by
 * construction). Writes are ATOMIC: a temp file then rename, so a
 * reader never observes a torn document.
 *
 * LIFECYCLE: saveSession (creates or OVERWRITES by id — resumable
 * sessions), loadSession (null on missing/expired; expired documents
 * are deleted on the spot), deleteSession, hasSession, listSessions
 * (metadata only — no payload reads) and pruneSessions (expired first,
 * then oldest-over the max-entries cap — eviction is deterministic by
 * createdAt then id).
 *
 * CONFIG (config/env.js, additive and boot-safe): SESSION_CACHE_DIR
 * (default .cache/sessions), SESSION_CACHE_TTL_MS (default 1h),
 * SESSION_CACHE_MAX_ENTRIES (default 50). Every option is overridable
 * per call (tests inject a temp dir and a deterministic `now`).
 *
 * FAILURES are typed SessionCacheError: invalid_id, not_serializable,
 * io_error. Native node:fs/promises + node:crypto — zero dependencies.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { env } from '../config/env.js';

/** Typed error for session-cache failures. */
export class SessionCacheError extends Error {
  constructor(message, { code, details, cause } = {}) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'SessionCacheError';
    this.code = code;
    this.details = details;
  }
}

/** Machine-readable failure codes. */
export const SESSION_CODES = Object.freeze({
  INVALID_ID: 'invalid_id',
  NOT_SERIALIZABLE: 'not_serializable',
  IO_ERROR: 'io_error',
});

/** Documented defaults (env-backed, overridable per call). */
export function sessionDefaults(overrides = {}) {
  return {
    baseDir: overrides.baseDir ?? env.SESSION_CACHE_DIR ?? '.cache/sessions',
    ttlMs: overrides.ttlMs ?? env.SESSION_CACHE_TTL_MS ?? 3_600_000,
    maxEntries: overrides.maxEntries ?? env.SESSION_CACHE_MAX_ENTRIES ?? 50,
    now: overrides.now ?? Date.now,
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A fresh unique session id (crypto.randomUUID — not guessable). */
export function createSessionId() {
  return randomUUID();
}

function assertId(id) {
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
    throw new SessionCacheError(
      'session id must be a UUID (path traversal is rejected by construction)',
      { code: SESSION_CODES.INVALID_ID, details: { id } }
    );
  }
  return id;
}

function fileFor(baseDir, id) {
  return path.join(baseDir, `${id}.json`);
}

const toRecord = (raw, id, nowMs) => {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.id !== id) return null;
  if (typeof raw.expiresAt !== 'number' || raw.expiresAt <= nowMs) return null;
  return raw;
};

async function readDocument(file, id, nowMs) {
  let raw;
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch (cause) {
    if (cause?.code === 'ENOENT') return null;
    throw new SessionCacheError('session document unreadable', {
      code: SESSION_CODES.IO_ERROR,
      details: { id },
      cause,
    });
  }
  return toRecord(raw, id, nowMs);
}

/**
 * Saves (creates or overwrites) a session document.
 *
 * @param {object} session the analysis session payload (JSON-
 *        serializable; functions/symbols -> not_serializable).
 * @param {object} [options] {id?, baseDir?, ttlMs?, maxEntries?, now?}.
 * @returns {Readonly<{id, path, bytes, createdAt, expiresAt}>} frozen.
 * @throws {SessionCacheError} invalid_id | not_serializable | io_error.
 */
export async function saveSession(session, options = {}) {
  const cfg = sessionDefaults(options);
  const id = assertId(options.id ?? createSessionId());
  const createdAt = cfg.now();

  let payload;
  try {
    payload = JSON.stringify({
      id,
      createdAt,
      expiresAt: createdAt + cfg.ttlMs,
      data: session,
    });
  } catch (cause) {
    throw new SessionCacheError('session payload is not JSON-serializable', {
      code: SESSION_CODES.NOT_SERIALIZABLE,
      details: { id },
      cause,
    });
  }

  const file = fileFor(cfg.baseDir, id);
  try {
    await mkdir(cfg.baseDir, { recursive: true });
    const temp = `${file}.${process.pid}.${createdAt}.tmp`;
    await writeFile(temp, payload, 'utf8');
    await rename(temp, file);
  } catch (cause) {
    throw new SessionCacheError('session write failed', {
      code: SESSION_CODES.IO_ERROR,
      details: { id, file },
      cause,
    });
  }

  // Opportunistic hygiene: purge expired + enforce the entry cap.
  await pruneSessions(options).catch(() => {});

  return Object.freeze({
    id,
    path: file,
    bytes: payload.length,
    createdAt,
    expiresAt: createdAt + cfg.ttlMs,
  });
}

/**
 * Loads a live session.
 *
 * @returns {Readonly<{id, createdAt, expiresAt, data}>|null} null on
 *          missing/expired (expired documents are deleted on the spot).
 * @throws {SessionCacheError} invalid_id | io_error.
 */
export async function loadSession(id, options = {}) {
  const cfg = sessionDefaults(options);
  assertId(id);
  const nowMs = cfg.now();
  const file = fileFor(cfg.baseDir, id);

  const raw = await readDocument(file, id, nowMs);
  if (raw === null) {
    await unlink(file).catch(() => {});
    return null;
  }
  return Object.freeze({
    id: raw.id,
    createdAt: raw.createdAt,
    expiresAt: raw.expiresAt,
    data: raw.data,
  });
}

/** True when a LIVE session exists (expired counts as absent). */
export async function hasSession(id, options = {}) {
  return (await loadSession(id, options)) !== null;
}

/** Deletes a session document; true when something was removed. */
export async function deleteSession(id, options = {}) {
  const cfg = sessionDefaults(options);
  assertId(id);
  try {
    await unlink(fileFor(cfg.baseDir, id));
    return true;
  } catch (cause) {
    if (cause?.code === 'ENOENT') return false;
    throw new SessionCacheError('session delete failed', {
      code: SESSION_CODES.IO_ERROR,
      details: { id },
      cause,
    });
  }
}

/** Metadata for every stored document (no payload reads). */
export async function listSessions(options = {}) {
  const cfg = sessionDefaults(options);
  let names;
  try {
    names = await readdir(cfg.baseDir);
  } catch (cause) {
    if (cause?.code === 'ENOENT') return [];
    throw new SessionCacheError('session listing failed', {
      code: SESSION_CODES.IO_ERROR,
      cause,
    });
  }

  const nowMs = cfg.now();
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    let raw;
    try {
      raw = JSON.parse(await readFile(path.join(cfg.baseDir, name), 'utf8'));
    } catch {
      continue; // torn/foreign files are ignored, never thrown
    }
    if (!raw || typeof raw !== 'object') continue;
    const bytes = Buffer.byteLength(JSON.stringify(raw), 'utf8');
    out.push(
      Object.freeze({
        id: typeof raw.id === 'string' ? raw.id : name.slice(0, -'.json'.length),
        createdAt: finiteOrNull(raw.createdAt),
        expiresAt: finiteOrNull(raw.expiresAt),
        bytes,
        live: typeof raw.expiresAt === 'number' && raw.expiresAt > nowMs,
      })
    );
  }
  // Deterministic order: newest first, id tiebreak.
  out.sort(
    (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || a.id.localeCompare(b.id)
  );
  return Object.freeze(out);
}

function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Purges expired documents, then evicts oldest-over the entry cap.
 *
 * @returns {Readonly<{removed, remaining}>} frozen.
 */
export async function pruneSessions(options = {}) {
  const cfg = sessionDefaults(options);
  const nowMs = cfg.now();

  let names;
  try {
    names = await readdir(cfg.baseDir);
  } catch (cause) {
    if (cause?.code === 'ENOENT') return Object.freeze({ removed: 0, remaining: 0 });
    throw new SessionCacheError('session pruning failed', {
      code: SESSION_CODES.IO_ERROR,
      cause,
    });
  }

  const docs = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    let raw;
    try {
      raw = JSON.parse(await readFile(path.join(cfg.baseDir, name), 'utf8'));
    } catch {
      continue;
    }
    docs.push({
      file: path.join(cfg.baseDir, name),
      id: typeof raw?.id === 'string' ? raw.id : name.slice(0, -'.json'.length),
      createdAt: finiteOrNull(raw?.createdAt) ?? 0,
      expiresAt: finiteOrNull(raw?.expiresAt),
    });
  }

  let removed = 0;
  const live = [];
  for (const doc of docs) {
    if (doc.expiresAt === null || doc.expiresAt <= nowMs) {
      await unlink(doc.file).catch(() => {});
      removed += 1;
    } else {
      live.push(doc);
    }
  }

  // Deterministic eviction: oldest first, id tiebreak.
  live.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  while (live.length > cfg.maxEntries) {
    const evict = live.shift();
    await unlink(evict.file).catch(() => {});
    removed += 1;
  }

  return Object.freeze({ removed, remaining: live.length });
}

const sessionCache = {
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
};

export default sessionCache;
