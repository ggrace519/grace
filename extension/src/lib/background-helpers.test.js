import { describe, it, expect } from 'vitest';
import {
  isValidUrl,
  getValidatedFetchUrl,
  getRateLimitKey,
  getRateLimitConfig,
  getStoredRequestsForAction,
  buildRateLimitStorage,
} from './background-helpers.js';

describe('background-helpers', () => {
  describe('isValidUrl', () => {
    it('returns false for empty or non-string', () => {
      expect(isValidUrl('')).toBe(false);
      expect(isValidUrl(null)).toBe(false);
      expect(isValidUrl(undefined)).toBe(false);
      expect(isValidUrl(123)).toBe(false);
    });

    it('returns true for http and https', () => {
      expect(isValidUrl('http://example.com')).toBe(true);
      expect(isValidUrl('https://example.com')).toBe(true);
      expect(isValidUrl('https://api.example.com/path?q=1')).toBe(true);
    });

    it('returns false for javascript and data protocols', () => {
      expect(isValidUrl('javascript:alert(1)')).toBe(false);
      expect(isValidUrl('data:text/html,<script>')).toBe(false);
    });

    it('returns false for invalid URLs', () => {
      expect(isValidUrl('not a url')).toBe(false);
      expect(isValidUrl('ftp://example.com')).toBe(false);
    });
  });

  describe('getValidatedFetchUrl', () => {
    it('returns null for empty or non-string', () => {
      expect(getValidatedFetchUrl('')).toBe(null);
      expect(getValidatedFetchUrl(null)).toBe(null);
    });

    it('returns reconstructed URL for valid http/https', () => {
      expect(getValidatedFetchUrl('https://example.com')).toBe('https://example.com/');
      expect(getValidatedFetchUrl('https://example.com/path')).toBe('https://example.com/path');
      expect(getValidatedFetchUrl('https://example.com/path?q=1')).toBe('https://example.com/path?q=1');
    });

    it('returns null for invalid or disallowed protocols', () => {
      expect(getValidatedFetchUrl('javascript:void(0)')).toBe(null);
      expect(getValidatedFetchUrl('invalid')).toBe(null);
    });
  });

  describe('getRateLimitKey', () => {
    it('returns general for non-string', () => {
      expect(getRateLimitKey(null)).toBe('general');
      expect(getRateLimitKey(123)).toBe('general');
    });

    it('returns action type for chatCompletion and fetchModels', () => {
      expect(getRateLimitKey('chatCompletion')).toBe('chatCompletion');
      expect(getRateLimitKey('fetchModels')).toBe('fetchModels');
    });

    it('returns general for unknown string', () => {
      expect(getRateLimitKey('other')).toBe('general');
      expect(getRateLimitKey('')).toBe('general');
    });
  });

  describe('getRateLimitConfig', () => {
    it('returns correct config for each action type', () => {
      const chat = getRateLimitConfig('chatCompletion');
      expect(chat).toEqual({ max: 10, window: 60000 });
      const models = getRateLimitConfig('fetchModels');
      expect(models).toEqual({ max: 5, window: 60000 });
      const general = getRateLimitConfig('general');
      expect(general).toEqual({ max: 20, window: 60000 });
    });

    it('returns general config for unknown', () => {
      expect(getRateLimitConfig('other')).toEqual({ max: 20, window: 60000 });
    });
  });

  describe('getStoredRequestsForAction', () => {
    it('returns [] for invalid raw', () => {
      expect(getStoredRequestsForAction(null, 'chatCompletion')).toEqual([]);
      expect(getStoredRequestsForAction([], 'chatCompletion')).toEqual([]);
      expect(getStoredRequestsForAction('x', 'chatCompletion')).toEqual([]);
    });

    it('returns stored array for matching action', () => {
      const raw = { chatCompletion: [1, 2], fetchModels: [3], general: [] };
      expect(getStoredRequestsForAction(raw, 'chatCompletion')).toEqual([1, 2]);
      expect(getStoredRequestsForAction(raw, 'fetchModels')).toEqual([3]);
      expect(getStoredRequestsForAction(raw, 'general')).toEqual([]);
    });

    it('returns [] when key missing or not array', () => {
      expect(getStoredRequestsForAction({}, 'chatCompletion')).toEqual([]);
      expect(getStoredRequestsForAction({ chatCompletion: 'not-array' }, 'chatCompletion')).toEqual([]);
    });
  });

  describe('buildRateLimitStorage', () => {
    it('builds object with updated requests for action', () => {
      const raw = { chatCompletion: [1], fetchModels: [2], general: [3] };
      const out = buildRateLimitStorage(raw, 'chatCompletion', [1, 999]);
      expect(out.chatCompletion).toEqual([1, 999]);
      expect(out.fetchModels).toEqual([2]);
      expect(out.general).toEqual([3]);
    });

    it('builds from empty raw when raw is null', () => {
      const out = buildRateLimitStorage(null, 'general', [100]);
      expect(out.general).toEqual([100]);
      expect(out.chatCompletion).toBeUndefined();
      expect(out.fetchModels).toBeUndefined();
    });

    it('overwrites only the given action', () => {
      const raw = { chatCompletion: [1], fetchModels: [2], general: [3] };
      const out = buildRateLimitStorage(raw, 'fetchModels', [2, 4]);
      expect(out.fetchModels).toEqual([2, 4]);
      expect(out.chatCompletion).toEqual([1]);
      expect(out.general).toEqual([3]);
    });
  });
});

import {
  getAnthropicRequestBody,
  normalizeAnthropicModelsResponse,
  normalizeAnthropicSseChunk,
} from './background-helpers.js';

describe('getAnthropicRequestBody', () => {
  it('extracts system message to top-level field', () => {
    const messages = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hi' },
    ];
    const body = getAnthropicRequestBody('claude-sonnet-4-6', messages, true);
    expect(body.system).toBe('You are helpful.');
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(8096);
    expect(body.model).toBe('claude-sonnet-4-6');
  });

  it('handles messages with no system message', () => {
    const messages = [{ role: 'user', content: 'Hello' }];
    const body = getAnthropicRequestBody('claude-haiku-4-5', messages, false);
    expect(body.system).toBeUndefined();
    expect(body.messages).toHaveLength(1);
    expect(body.stream).toBe(false);
  });
});

describe('normalizeAnthropicModelsResponse', () => {
  it('converts Anthropic models list to OpenAI-compatible format', () => {
    const anthropicResponse = {
      data: [
        { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6' },
        { id: 'claude-opus-4-7', display_name: 'Claude Opus 4.7' },
        { id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku' },
      ],
    };
    const result = normalizeAnthropicModelsResponse(anthropicResponse);
    expect(result.data.data).toHaveLength(3);
    expect(result.data.data[0]).toEqual({ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' });
  });

  it('filters out non-claude models', () => {
    const anthropicResponse = {
      data: [
        { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet' },
        { id: 'other-model', display_name: 'Other' },
      ],
    };
    const result = normalizeAnthropicModelsResponse(anthropicResponse);
    expect(result.data.data).toHaveLength(1);
    expect(result.data.data[0].id).toBe('claude-sonnet-4-6');
  });
});

describe('normalizeAnthropicSseChunk', () => {
  it('converts content_block_delta text_delta to OpenAI chunk format', () => {
    const line = 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}';
    const result = normalizeAnthropicSseChunk(line);
    expect(result).toBe('data: {"choices":[{"delta":{"content":"Hello"}}]}');
  });

  it('converts message_stop to OpenAI [DONE]', () => {
    const line = 'data: {"type":"message_stop"}';
    const result = normalizeAnthropicSseChunk(line);
    expect(result).toBe('data: [DONE]');
  });

  it('returns null for other event types', () => {
    const line = 'data: {"type":"message_start","message":{}}';
    expect(normalizeAnthropicSseChunk(line)).toBeNull();
  });

  it('returns null for non-data lines', () => {
    expect(normalizeAnthropicSseChunk('event: content_block_delta')).toBeNull();
    expect(normalizeAnthropicSseChunk('')).toBeNull();
  });
});
