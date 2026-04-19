/**
 * URL validation and rate-limit helpers.
 * Logic is shared with background.js (keep in sync). Used for unit testing.
 */

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

/**
 * Builds the Anthropic API request body from a messages array.
 * Extracts any system message to the top-level `system` field.
 */
export function getAnthropicRequestBody(model, messages, stream) {
  const systemMsg = messages.find((m) => m.role === 'system');
  const userMessages = messages.filter((m) => m.role !== 'system');
  const body = { model, messages: userMessages, max_tokens: 8096, stream };
  if (systemMsg) body.system = systemMsg.content;
  return body;
}

/**
 * Converts Anthropic GET /v1/models response to the shape getModels() expects:
 * { data: { data: [{id, name}] } }
 */
export function normalizeAnthropicModelsResponse(anthropicResponse) {
  const models = (anthropicResponse.data || [])
    .filter((m) => m.id && m.id.startsWith('claude-'))
    .map((m) => ({ id: m.id, name: m.display_name || m.id }));
  return { data: { data: models } };
}

/**
 * Converts a single Anthropic SSE line to OpenAI-compatible format.
 * Returns the normalized line string, or null if the line should be skipped.
 */
export function normalizeAnthropicSseChunk(line) {
  if (!line || !line.startsWith('data: ')) return null;
  const jsonStr = line.slice(6);
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }
  if (parsed.type === 'message_stop') return 'data: [DONE]';
  if (
    parsed.type === 'content_block_delta' &&
    parsed.delta?.type === 'text_delta'
  ) {
    return `data: ${JSON.stringify({ choices: [{ delta: { content: parsed.delta.text } }] })}`;
  }
  return null;
}
