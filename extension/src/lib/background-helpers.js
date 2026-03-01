/**
 * URL validation and rate-limit helpers.
 * Logic is shared with background.js (keep in sync). Used for unit testing.
 */

// Keep in sync with urlValidation.js isBlockedHost
const SSRF_BLOCKED_HOSTS = [
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.google.com',
  'metadata',
];

function isBlockedHost(host) {
  if (!host || typeof host !== 'string') return true;
  // Strip IPv6 brackets (url.hostname behaviour varies across runtimes)
  const normalized = host.toLowerCase().trim().replace(/^\[|\]$/g, '');
  if (SSRF_BLOCKED_HOSTS.some((blocked) => normalized === blocked.toLowerCase())) return true;
  if (normalized === '0.0.0.0') return true;
  if (normalized.startsWith('127.')) return true;
  if (normalized.startsWith('10.')) return true;
  if (normalized.startsWith('192.168.')) return true;
  if (normalized.startsWith('169.254.')) return true;
  if (normalized.startsWith('172.')) {
    const second = parseInt(normalized.split('.')[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  const isIPv6 = normalized.includes(':');
  if (isIPv6) {
    if (normalized === '::1') return true;
    if (normalized === '::') return true;
    if (/^f[cd]/.test(normalized)) return true;
  }
  return false;
}

export function isValidUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') return false;
  try {
    const url = new URL(urlString);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    if (url.protocol === 'javascript:' || url.protocol === 'data:') return false;
    return true;
  } catch {
    return false;
  }
}

export function getValidatedFetchUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') return null;
  try {
    const url = new URL(urlString);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (isBlockedHost(url.hostname)) return null;
    return url.origin + url.pathname + url.search;
  } catch {
    return null;
  }
}

const RATE_LIMIT_CHAT = { max: 10, window: 60000 };
const RATE_LIMIT_FETCH_MODELS = { max: 5, window: 60000 };
const RATE_LIMIT_GENERAL = { max: 20, window: 60000 };

export function getRateLimitConfig(actionType) {
  if (actionType === 'chatCompletion') return RATE_LIMIT_CHAT;
  if (actionType === 'fetchModels') return RATE_LIMIT_FETCH_MODELS;
  return RATE_LIMIT_GENERAL;
}

export function getStoredRequestsForAction(raw, actionType) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  if (actionType === 'chatCompletion' && Array.isArray(raw.chatCompletion)) return raw.chatCompletion;
  if (actionType === 'fetchModels' && Array.isArray(raw.fetchModels)) return raw.fetchModels;
  if (actionType === 'general' && Array.isArray(raw.general)) return raw.general;
  return [];
}

export function buildRateLimitStorage(raw, actionType, updatedRequests) {
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    if (Array.isArray(raw.chatCompletion)) out.chatCompletion = raw.chatCompletion;
    if (Array.isArray(raw.fetchModels)) out.fetchModels = raw.fetchModels;
    if (Array.isArray(raw.general)) out.general = raw.general;
  }
  if (actionType === 'chatCompletion') out.chatCompletion = updatedRequests;
  else if (actionType === 'fetchModels') out.fetchModels = updatedRequests;
  else out.general = updatedRequests;
  return out;
}

export function getRateLimitKey(actionType) {
  if (typeof actionType !== 'string') return 'general';
  if (actionType === 'chatCompletion' || actionType === 'fetchModels') return actionType;
  return 'general';
}
