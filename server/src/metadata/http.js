// http.js — small fetch wrapper with a timeout and our User-Agent
// (Open Library asks API users to identify themselves).
//
// Pass `source` to count the call against that source's limits (usage.js):
// over a limit, LimitReached is thrown and no request is made.

import { config } from '../config.js';
import { beforeCall, rateLimited } from './usage.js';

export async function fetchJson(url, { headers = {}, timeout = 12000, source = null, method = 'GET', body } = {}) {
  if (source) beforeCall(source);
  const res = await fetch(url, {
    method,
    headers: { 'User-Agent': config.userAgent, Accept: 'application/json', ...headers },
    body,
    signal: AbortSignal.timeout(timeout),
    redirect: 'follow',
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    if (res.status === 429 && source) rateLimited(source);
    // Pass on the service's own explanation (e.g. Google's "API key not valid").
    const data = await res.json().catch(() => null);
    const detail = data?.error?.message || data?.error_description || data?.message || data?.errorMessage
      || (typeof data?.error === 'string' ? data.error : '') || data?.fault?.faultstring || '';
    const err = new Error(`${new URL(url).hostname} responded ${res.status}${detail ? `: ${detail}` : ''}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Download an image. Returns { buffer, contentType } or null if it isn't a real image.
export async function fetchImage(url, { timeout = 15000 } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': config.userAgent },
    signal: AbortSignal.timeout(timeout),
    redirect: 'follow',
  });
  if (!res.ok) return null;
  const contentType = (res.headers.get('content-type') || '').split(';')[0].trim();
  if (!contentType.startsWith('image/')) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  // Placeholder images (1x1 gifs, "no cover" stubs) are tiny.
  if (buffer.length < 1500) return null;
  return { buffer, contentType };
}
