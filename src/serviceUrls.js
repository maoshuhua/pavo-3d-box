// Public requests follow the page origin unless a separate API is configured.
export function resolveApiBase(configured, origin = globalThis.location?.origin) {
  return new URL(configured || origin || 'http://127.0.0.1:8787', origin).href.replace(/\/$/, '');
}
export const apiBase = resolveApiBase(import.meta.env?.VITE_AGENT_URL);
const managedPath = /^\/(artifacts|api\/studio|local-assets|local-upload|uploads)\//;
export function resolveServiceUrl(value, base = apiBase) {
  if (typeof value !== 'string') return value;
  try {
    const url = new URL(value, base + '/');
    if (!['http:', 'https:'].includes(url.protocol)) return value;
    if (managedPath.test(url.pathname) && (value.startsWith('/') || ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) {
      return new URL(url.pathname + url.search + url.hash, base + '/').href;
    }
  } catch {}
  return value;
}
export function resolveServiceData(value, base = apiBase) {
  if (Array.isArray(value)) return value.map(item => resolveServiceData(item, base));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    key === 'config' && typeof item === 'string' ? resolveConfig(item, base) : resolveServiceData(item, base)]));
  return resolveServiceUrl(value, base);
}
function resolveConfig(value, base) {
  try { return JSON.stringify(resolveServiceData(JSON.parse(value), base)); } catch { return value; }
}
