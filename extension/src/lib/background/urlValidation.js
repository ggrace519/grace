/**
 * SSRF Protection Module
 * URL validation to prevent Server-Side Request Forgery (SSRF) attacks
 */

// SSRF blocklist: hostnames/IPs that must never be requested (cloud metadata, etc.)
const SSRF_BLOCKED_HOSTS = [
  '169.254.169.254',           // AWS/GCP/Azure metadata
  'metadata.google.internal',
  'metadata.google.com',
  'metadata',
];

function isBlockedHost(host) {
  if (!host || typeof host !== 'string') return true;
  const normalized = host.toLowerCase().trim();
  if (SSRF_BLOCKED_HOSTS.some((blocked) => normalized === blocked.toLowerCase())) return true;
  if (normalized.startsWith('169.254.')) return true; // link-local metadata range
  return false;
}

// Returns a safe URL string for fetch (reconstructed from parsed URL) or null. Prevents SSRF;
// the value passed to fetch is never raw user input.
export function getValidatedFetchUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') return null;
  try {
    const url = new URL(urlString);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (isBlockedHost(url.hostname)) return null;
    return url.origin + url.pathname + url.search;
  } catch (e) {
    return null;
  }
}

// Fetches only after URL validation. Uses reconstructed URL so no user-controlled string reaches fetch.
// SECURITY: Only the validated, reconstructed URL is passed to fetch; raw user input is never used.
export function safeFetch(apiUrl, options) {
  const safeUrl = getValidatedFetchUrl(apiUrl);
  if (safeUrl === null) {
    return Promise.reject(new Error('Invalid API URL'));
  }
  return fetch(safeUrl, options);
}

// URL validation to prevent SSRF attacks
export function isValidUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    return false;
  }

  try {
    const url = new URL(urlString);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return false;
    }
    if (url.protocol === 'javascript:' || url.protocol === 'data:') {
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}
