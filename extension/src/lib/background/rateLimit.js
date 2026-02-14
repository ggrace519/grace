/**
 * Rate Limiting Module
 * Implements sliding window rate limiting to prevent abuse and API quota exhaustion
 */

// Rate Limiting Configuration (fixed keys only; no dynamic access)
const RATE_LIMIT_CHAT = { max: 10, window: 60000 };
const RATE_LIMIT_FETCH_MODELS = { max: 5, window: 60000 };
const RATE_LIMIT_GENERAL = { max: 20, window: 60000 };

function getRateLimitConfig(actionType) {
  if (actionType === 'chatCompletion') return RATE_LIMIT_CHAT;
  if (actionType === 'fetchModels') return RATE_LIMIT_FETCH_MODELS;
  return RATE_LIMIT_GENERAL;
}

function getStoredRequestsForAction(raw, actionType) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  if (actionType === 'chatCompletion' && Array.isArray(raw.chatCompletion)) return raw.chatCompletion;
  if (actionType === 'fetchModels' && Array.isArray(raw.fetchModels)) return raw.fetchModels;
  if (actionType === 'general' && Array.isArray(raw.general)) return raw.general;
  return [];
}

function buildRateLimitStorage(raw, actionType, updatedRequests) {
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

function getRateLimitKey(actionType) {
  if (typeof actionType !== 'string') return 'general';
  if (actionType === 'chatCompletion' || actionType === 'fetchModels') return actionType;
  return 'general';
}

// Rate Limiting: Check if request should be allowed (no dynamic object key access)
export async function checkRateLimit(actionType) {
  const key = getRateLimitKey(actionType);
  const limit = getRateLimitConfig(key);
  const now = Date.now();

  try {
    const stored = await chrome.storage.local.get(['rateLimit']);
    const raw = stored.rateLimit;
    let requests = getStoredRequestsForAction(raw, key);

    requests = requests.filter(timestamp => now - timestamp < limit.window);

    if (requests.length >= limit.max) {
      const oldestRequest = requests[0];
      const waitTime = limit.window - (now - oldestRequest);
      return {
        allowed: false,
        waitTime: Math.ceil(waitTime / 1000)
      };
    }

    requests = requests.concat(now);
    const rateLimitData = buildRateLimitStorage(raw, key, requests);
    await chrome.storage.local.set({ rateLimit: rateLimitData });

    return { allowed: true };
  } catch (error) {
    console.error("Extension: Rate limit check failed:", error);
    return { allowed: true };
  }
}
