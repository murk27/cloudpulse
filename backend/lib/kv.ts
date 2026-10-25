/**
 * The key-value store, behind a tiny interface with exactly the Redis commands CloudPulse uses.
 *
 * - In production it talks to Upstash Redis over HTTPS (a REST API). Serverless functions start
 *   and stop all the time, so a stateless HTTP request per command suits them better than a
 *   long-lived TCP connection.
 * - Locally and in tests it uses MemoryKV, an in-memory imitation of the same commands, so you
 *   can run and demo the whole app with no account and no internet.
 */
import { Redis } from "@upstash/redis";
import { config } from "./config.js";

export interface ScoredMember {
  score: number;
  member: string;
}

export interface KV {
  get(key: string): Promise<string | null>;
  /** With nx: only writes if the key does NOT exist yet. Returns true if it wrote. */
  set(key: string, value: string, options?: { nx?: boolean }): Promise<boolean>;
  /** Reads and deletes a key in one atomic step. */
  getdel(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  mget(keys: string[]): Promise<(string | null)[]>;
  // Hashes: a key holding many field -> value pairs
  hget(key: string, field: string): Promise<string | null>;
  hgetall(key: string): Promise<Record<string, string>>;
  hset(key: string, values: Record<string, string>): Promise<void>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  hincrby(key: string, field: string, increment: number): Promise<number>;
  // Sorted sets: members ordered by a numeric score (we use the timestamp)
  zadd(key: string, items: ScoredMember[]): Promise<void>;
  zrangeByScore(key: string, min: number, max: number): Promise<string[]>;
  zremrangeByScore(key: string, min: number, max: number): Promise<number>;
}

/** Adapter from the Upstash SDK to our interface. */
function upstashKV(redis: Redis): KV {
  return {
    get: (key) => redis.get<string>(key),
    set: async (key, value, options) => (await redis.set(key, value, options?.nx ? { nx: true } : {})) === "OK",
    getdel: (key) => redis.getdel<string>(key),
    del: (...keys) => (keys.length ? redis.del(...keys) : Promise.resolve(0)),
    mget: (keys) => (keys.length ? redis.mget<(string | null)[]>(...keys) : Promise.resolve([])),
    hget: (key, field) => redis.hget<string>(key, field),
    hgetall: async (key) => (await redis.hgetall<Record<string, string>>(key)) ?? {},
    hset: async (key, values) => {
      if (Object.keys(values).length) await redis.hset(key, values);
    },
    hdel: (key, ...fields) => (fields.length ? redis.hdel(key, ...fields) : Promise.resolve(0)),
    hincrby: (key, field, increment) => redis.hincrby(key, field, increment),
    zadd: async (key, items) => {
      const [first, ...rest] = items;
      if (first) await redis.zadd(key, first, ...rest);
    },
    zrangeByScore: (key, min, max) => redis.zrange<string[]>(key, min, max, { byScore: true }),
    zremrangeByScore: (key, min, max) => redis.zremrangebyscore(key, min, max),
  };
}

/** In-memory imitation of the commands above (local development and tests only). */
export class MemoryKV implements KV {
  private strings = new Map<string, string>();
  private hashes = new Map<string, Map<string, string>>();
  private zsets = new Map<string, Map<string, number>>();

  private hash(key: string): Map<string, string> {
    let h = this.hashes.get(key);
    if (!h) this.hashes.set(key, (h = new Map()));
    return h;
  }

  private zset(key: string): Map<string, number> {
    let z = this.zsets.get(key);
    if (!z) this.zsets.set(key, (z = new Map()));
    return z;
  }

  async get(key: string) {
    return this.strings.get(key) ?? null;
  }
  async set(key: string, value: string, options?: { nx?: boolean }) {
    if (options?.nx && this.strings.has(key)) return false;
    this.strings.set(key, value);
    return true;
  }
  async getdel(key: string) {
    const value = this.strings.get(key) ?? null;
    this.strings.delete(key);
    return value;
  }
  async del(...keys: string[]) {
    let count = 0;
    for (const key of keys) {
      for (const store of [this.strings, this.hashes, this.zsets] as Map<string, unknown>[]) {
        if (store.delete(key)) count++;
      }
    }
    return count;
  }
  async mget(keys: string[]) {
    return keys.map((key) => this.strings.get(key) ?? null);
  }
  async hget(key: string, field: string) {
    return this.hashes.get(key)?.get(field) ?? null;
  }
  async hgetall(key: string) {
    return Object.fromEntries(this.hashes.get(key) ?? []);
  }
  async hset(key: string, values: Record<string, string>) {
    const h = this.hash(key);
    for (const [field, value] of Object.entries(values)) h.set(field, value);
  }
  async hdel(key: string, ...fields: string[]) {
    const h = this.hashes.get(key);
    return fields.filter((field) => h?.delete(field)).length;
  }
  async hincrby(key: string, field: string, increment: number) {
    const h = this.hash(key);
    const next = Number(h.get(field) ?? 0) + increment;
    h.set(field, String(next));
    return next;
  }
  async zadd(key: string, items: ScoredMember[]) {
    const z = this.zset(key);
    for (const { score, member } of items) z.set(member, score);
  }
  async zrangeByScore(key: string, min: number, max: number) {
    return [...(this.zsets.get(key) ?? [])]
      .filter(([, score]) => score >= min && score <= max)
      .sort((a, b) => a[1] - b[1])
      .map(([member]) => member);
  }
  async zremrangeByScore(key: string, min: number, max: number) {
    const z = this.zsets.get(key);
    let removed = 0;
    for (const [member, score] of z ?? []) {
      if (score >= min && score <= max && z?.delete(member)) removed++;
    }
    return removed;
  }
}

let kv: KV | undefined;
let upstash: Redis | null | undefined;

/** The raw Upstash client (used by the rate limiter), or null when running without Upstash. */
export function getUpstash(): Redis | null {
  if (upstash === undefined) {
    const url = config.redisUrl();
    const token = config.redisToken();
    upstash = url && token ? new Redis({ url, token }) : null;
  }
  return upstash;
}

/** Returns the store: Upstash when configured, otherwise in-memory (never on Vercel). */
export function getKV(): KV {
  if (!kv) {
    const url = config.redisUrl();
    const token = config.redisToken();
    if (url && token) {
      // automaticDeserialization: false -> values come back as the exact strings we stored.
      // enableAutoPipelining -> commands issued together are sent in one HTTP request.
      kv = upstashKV(new Redis({ url, token, automaticDeserialization: false, enableAutoPipelining: true }));
    } else if (config.onVercel()) {
      // On Vercel, silently falling back to memory would lose all data: fail loudly instead.
      throw new Error("Upstash Redis is not configured (UPSTASH_REDIS_REST_URL / _TOKEN missing)");
    } else {
      kv = new MemoryKV();
    }
  }
  return kv;
}

/** Tests and the local server can swap in a fresh store. */
export function setKV(store: KV): void {
  kv = store;
}
