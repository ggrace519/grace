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
