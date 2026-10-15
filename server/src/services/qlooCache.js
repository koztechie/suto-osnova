/**
 * Two-tier response cache for the Qloo Taste AI API (development aid).
 *
 * Tier 1: bounded in-memory LRU (Map preserves insertion order) — instant.
 * Tier 2: JSON files under a local directory — survives `node --watch`
 *         restarts, so a restart does not re-spend the hackathon key quota.
 *
 * Entries are keyed by a SHA-256 hash of the canonical request identity:
 * base URL + API-key fingerprint + method + full URL (with query) + body.
 * Including a fingerprint of the key (never the key itself) prevents
 * cross-account cache poisoning if several keys are used on one machine.
 *
 * Design guarantees:
 * - The cache NEVER breaks requests: every storage failure degrades to a
 *   miss (and a warning), never to a thrown error.
 * - Only successful (2xx, already parsed) responses are stored.
 * - Stored data is cloned on write and read, so callers cannot corrupt
 *   the cache by mutating returned objects.
 * - Stale-if-error: when the upstream fails after all retries, an expired
 *   entry may be served (flagged `stale`) to keep development unblocked.
 * - Per-entry TTL: each entry records the lifetime it was admitted under
 *   (e.g. 24h for relatively static Qloo entities/tags vs. the short
 *   default for everything else). That lifetime is validated on write
 *   (fail-fast) and on read (corrupt values fall back to the default TTL),
 *   and it travels with the entry across restarts via the disk tier.
 */

import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '../logger.js';

const cacheLog = createLogger('qlooCache');

const FILE_FORMAT_VERSION = 1;

/** Deterministic cache key from a canonical parts object. */
export function hashCacheKey(parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

/**
 * Validates a per-entry TTL value. Returns the value when valid,
 * otherwise null (caller falls back to the cache-wide default TTL).
 * Invalid shapes (negative, NaN, non-numeric) can only appear through
 * hand-edited disk entries — they must never break reads.
 */
function validEntryTtl(ttlMs) {
  if (ttlMs === undefined || ttlMs === null) return null;
  if (!Number.isFinite(ttlMs) || ttlMs < 0) return null;
  return ttlMs;
}

export class QlooCache {
  #memory = new Map();
  #enabled;
  #ttlMs;
  #dir;
  #maxEntries;
  #stats = {
    hitsMemory: 0,
    hitsDisk: 0,
    misses: 0,
    stores: 0,
    staleServed: 0,
    failures: 0,
  };

  constructor({
    enabled = true,
    ttlMs = 5 * 60_000,
    dir = '.cache/qloo',
    maxEntries = 500,
  } = {}) {
    if (typeof enabled !== 'boolean') {
      throw new TypeError('QlooCache: enabled must be a boolean');
    }
    if (!Number.isFinite(ttlMs) || ttlMs < 0) {
      throw new TypeError('QlooCache: ttlMs must be a number >= 0');
    }
    if (typeof dir !== 'string' || dir.length === 0) {
      throw new TypeError('QlooCache: dir must be a non-empty string');
    }
    if (!Number.isFinite(maxEntries) || maxEntries < 1) {
      throw new TypeError('QlooCache: maxEntries must be a number >= 1');
    }

    this.#enabled = enabled;
    this.#ttlMs = ttlMs;
    this.#dir = dir;
    this.#maxEntries = maxEntries;
  }

  get enabled() {
    return this.#enabled;
  }

  get dir() {
    return this.#dir;
  }

  /** Observability snapshot (copy — safe to expose/log). */
  get stats() {
    return { ...this.#stats, entries: this.#memory.size, ttlMs: this.#ttlMs };
  }

  #file(key) {
    return path.join(this.#dir, `${key}.json`);
  }

  #warn(context, err) {
    this.#stats.failures += 1;
    cacheLog.warn(`${context}: ${err?.message ?? err} (continuing without cache)`);
  }

  /**
   * Looks up an entry. Returns `{ data, cachedAt, ageMs, ttlMs, stale }`
   * or null. `allowStale` also returns expired entries (stale-if-error).
   *
   * TTL validation: each entry carries the lifetime it was admitted under.
   * A corrupt/missing per-entry value (hand-edited file, older format)
   * falls back to the cache-wide default TTL instead of failing the read.
   */
  async get(key, { allowStale = false } = {}) {
    if (!this.#enabled) return null;

    const entry = this.#memory.get(key);
    if (entry) {
      const ttlMs = validEntryTtl(entry.ttlMs) ?? this.#ttlMs;
      const ageMs = Date.now() - entry.cachedAt;
      // Freshness invariant: an entry is reusable ONLY while age < ttl.
      // This makes ttlMs === 0 deterministically dead (no same-millisecond
      // reuse races) instead of accidentally reusable at ageMs === 0.
      if (ageMs < ttlMs || allowStale) {
        this.#stats.hitsMemory += 1;
        if (ageMs >= ttlMs) this.#stats.staleServed += 1;
        // Refresh recency: delete + set moves the key to the MRU end.
        this.#memory.delete(key);
        this.#memory.set(key, entry);
        return {
          data: structuredClone(entry.data),
          cachedAt: entry.cachedAt,
          ageMs,
          ttlMs,
          stale: ageMs >= ttlMs,
        };
      }
      this.#memory.delete(key); // expired and stale not allowed — drop
    }

    const fromDisk = await this.#readFromDisk(key);
    if (!fromDisk) {
      this.#stats.misses += 1;
      return null;
    }

    const ttlMs = validEntryTtl(fromDisk.ttlMs) ?? this.#ttlMs;
    const ageMs = Date.now() - fromDisk.cachedAt;
    if (ageMs >= ttlMs && !allowStale) {
      this.#stats.misses += 1;
      return null;
    }

    // Hydrate tier 1 so the next hit skips disk.
    this.#remember(key, fromDisk);
    this.#stats.hitsDisk += 1;
    if (ageMs >= ttlMs) this.#stats.staleServed += 1;
    return {
      data: structuredClone(fromDisk.data),
      cachedAt: fromDisk.cachedAt,
      ageMs,
      ttlMs,
      stale: ageMs >= ttlMs,
    };
  }

  /**
   * Stores a successful response in both tiers. Never throws.
   * `ttlMs` sets a per-entry lifetime (validated: finite number >= 0);
   * omitted entries live for the cache-wide default TTL.
   */
  async set(key, data, { ttlMs } = {}) {
    if (!this.#enabled) return;

    // TTL validation on write: invalid shapes fall back to the cache-wide
    // default (never throws by design) and are recorded as failures.
    let entryTtl;
    if (ttlMs !== undefined) {
      if (Number.isFinite(ttlMs) && ttlMs >= 0) {
        entryTtl = ttlMs;
      } else {
        this.#warn('invalid per-entry ttlMs — falling back to default TTL');
      }
    }

    const entry = {
      cachedAt: Date.now(),
      ttlMs: entryTtl,
      data: structuredClone(data),
    };
    this.#remember(key, entry);
    this.#stats.stores += 1;

    try {
      await mkdir(this.#dir, { recursive: true });
      const target = this.#file(key);
      // Atomic replace: write a temp file, then rename over the target, so
      // a crash can never leave a half-written entry behind.
      const tmp = `${target}.tmp-${process.pid}`;
      await writeFile(
        tmp,
        JSON.stringify({
          v: FILE_FORMAT_VERSION,
          cachedAt: entry.cachedAt,
          ttlMs: entry.ttlMs ?? null,
          data: entry.data,
        })
      );
      await rename(tmp, target);
      await this.#pruneDisk();
    } catch (err) {
      this.#warn(`disk write failed for ${key.slice(0, 12)}…`, err);
    }
  }

  /** Empties both tiers. Never throws. */
  async clear() {
    this.#memory.clear();
    try {
      const files = await readdir(this.#dir);
      await Promise.all(
        files
          .filter((f) => f.endsWith('.json'))
          .map((f) => rm(path.join(this.#dir, f), { force: true }))
      );
    } catch (err) {
      // Directory may not exist yet — nothing to clear.
      if (err?.code !== 'ENOENT') this.#warn('clear failed', err);
    }
  }

  #remember(key, entry) {
    this.#memory.delete(key);
    this.#memory.set(key, entry);
    while (this.#memory.size > this.#maxEntries) {
      const oldest = this.#memory.keys().next().value;
      this.#memory.delete(oldest);
    }
  }

  async #readFromDisk(key) {
    try {
      const raw = await readFile(this.#file(key), 'utf8');
      const parsed = JSON.parse(raw);
      if (
        parsed?.v !== FILE_FORMAT_VERSION ||
        typeof parsed.cachedAt !== 'number' ||
        parsed.data === undefined
      ) {
        return null; // unknown/corrupt format — treat as a miss
      }
      return { cachedAt: parsed.cachedAt, ttlMs: parsed.ttlMs, data: parsed.data };
    } catch (err) {
      if (err?.code !== 'ENOENT' && !(err instanceof SyntaxError)) {
        this.#warn(`disk read failed for ${key.slice(0, 12)}…`, err);
      }
      return null;
    }
  }

  /** Best-effort eviction of the oldest files beyond `maxEntries`. */
  async #pruneDisk() {
    try {
      const files = (await readdir(this.#dir)).filter((f) => f.endsWith('.json'));
      if (files.length <= this.#maxEntries) return;

      const withStats = await Promise.all(
        files.map(async (f) => {
          const full = path.join(this.#dir, f);
          const s = await stat(full);
          return { full, mtime: s.mtimeMs };
        })
      );
      withStats.sort((a, b) => a.mtime - b.mtime);
      const excess = withStats.slice(0, withStats.length - this.#maxEntries);
      await Promise.all(excess.map((e) => rm(e.full, { force: true })));
    } catch (err) {
      this.#warn('disk prune failed', err);
    }
  }
}

export default QlooCache;
