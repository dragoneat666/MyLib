// usage.js — counts calls to each book data source and stops before a limit.
//
// Daily counts are stored in the settings table (so a restart doesn't reset
// them) and roll over at midnight in the configured time zone. A source that
// answers "429 Too Many Requests" is paused: for the rest of the day for NYT,
// otherwise for a minute.

import { getSetting, setSetting } from '../db.js';
import { config } from '../config.js';

export class LimitReached extends Error {
  constructor(source, message) {
    super(message);
    this.source = source;
    this.limitReached = true;
  }
}

// 0 = no daily limit.
export const dailyLimit = (id) => config.dailyLimits[id] || 0;
const PER_MINUTE = { nyt: 5, hardcover: 60 };
const PAUSE_ALL_DAY_ON_429 = new Set(['nyt']);

export function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

const key = (id) => `usage:${id}:${today()}`;
export const usedToday = (id) => parseInt(getSetting(key(id), '0'), 10) || 0;

const recent = new Map(); // id -> timestamps of calls in the last minute
const pausedUntil = new Map(); // id -> ms timestamp

function endOfToday() {
  // Pause until the date (in the configured time zone) changes; checked against today().
  return { day: today() };
}

// Call before each request to a source. Throws LimitReached instead of calling.
export function beforeCall(id) {
  const pause = pausedUntil.get(id);
  if (pause) {
    if (pause.day ? pause.day === today() : pause.until > Date.now()) {
      throw new LimitReached(id, `${id} is paused after a "too many requests" answer`);
    }
    pausedUntil.delete(id);
  }
  const limit = dailyLimit(id);
  const used = usedToday(id);
  if (limit && used >= limit) throw new LimitReached(id, `${id} daily limit reached (${used}/${limit})`);
  const perMinute = PER_MINUTE[id];
  if (perMinute) {
    const now = Date.now();
    const calls = (recent.get(id) || []).filter((t) => now - t < 60_000);
    if (calls.length >= perMinute) throw new LimitReached(id, `${id} per-minute limit reached`);
    calls.push(now);
    recent.set(id, calls);
  }
  setSetting(key(id), used + 1);
}

export function rateLimited(id) {
  pausedUntil.set(id, PAUSE_ALL_DAY_ON_429.has(id) ? endOfToday() : { until: Date.now() + 60_000 });
}

export function usageSummary(id) {
  const pause = pausedUntil.get(id);
  const paused = !!pause && (pause.day ? pause.day === today() : pause.until > Date.now());
  return { used: usedToday(id), limit: dailyLimit(id), paused };
}
