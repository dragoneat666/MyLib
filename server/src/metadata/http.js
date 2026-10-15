// http.js — small fetch wrapper with a timeout and our User-Agent
// (Open Library asks API users to identify themselves).

import { config } from '../config.js';

export async function fetchJson(url, { headers = {}, timeout = 12000 } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': config.userAgent, Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeout),
    redirect: 'follow',
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    // Pass on the service's own explanation (e.g. Google's "API key not valid").
    const body = await res.json().catch(() => null);
    const detail = body?.error?.message || body?.message || body?.errorMessage || '';
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
