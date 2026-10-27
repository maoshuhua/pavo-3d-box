import {BASE} from './config.js';
export function requestBase(req) {
  const forwarded = process.env.AGENT_TRUST_PROXY === 'true';
  const host = (forwarded ? req.headers['x-forwarded-host']?.split(',')[0].trim() : '') || req.headers.host;
  const protocol = (forwarded ? req.headers['x-forwarded-proto']?.split(',')[0].trim() : '') || req.protocol || 'http';
  const url = new URL(`${protocol}://${host}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('Invalid service origin');
  return url.origin;
}
export function allowedOrigin(origin, req) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) return false;
    if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return true;
    if (req && origin === requestBase(req)) return true;
    return (process.env.AGENT_ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).includes(origin);
  } catch { return false; }
}
// Keep renderer and stored tool results internal; translate JSON at the HTTP boundary.
export function publicServiceData(value, base) {
  if (Array.isArray(value)) return value.map(item => publicServiceData(item, base));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, publicServiceData(item, base)]));
  if (typeof value === 'string' && value.startsWith(BASE + '/')) return base + value.slice(BASE.length);
  return value;
}
