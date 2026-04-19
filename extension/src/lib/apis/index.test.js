/* global chrome */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getModels, generateOpenAIChatCompletion } from './index.js';

describe('apis', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'test-id',
        sendMessage: vi.fn(),
        connect: vi.fn(),
        lastError: null,
      },
      storage: { local: {} },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getModels', () => {
    it('resolves with error when Chrome API is unavailable', async () => {
      vi.stubGlobal('chrome', undefined);
      const result = await getModels('pid', 'openai-compatible', 'https://example.com', 'key');
      expect(result).toHaveProperty('error');
      expect(result.error).toMatch(/Chrome APIs not available|Extension context invalidated/);
    });

    it('resolves with error when chrome.runtime.sendMessage is missing', async () => {
      vi.stubGlobal('chrome', { runtime: { id: 'x' }, storage: {} });
      const result = await getModels('pid', 'openai-compatible', 'https://example.com', 'key');
      expect(result).toHaveProperty('error');
      expect(result.error).toMatch(/Chrome APIs not available|Extension context invalidated/);
    });

    it('resolves with raw response on success', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        cb({ data: { data: [{ name: 'Zebra' }, { name: 'alpha' }] } });
      });
      const result = await getModels('pid', 'openai-compatible', 'https://example.com', 'key');
      expect(result).toEqual({ data: { data: [{ name: 'Zebra' }, { name: 'alpha' }] } });
    });

    it('resolves with error object on response error', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        cb({ error: 'Invalid URL' });
      });
      const result = await getModels('pid', 'openai-compatible', 'https://example.com', 'key');
      expect(result).toEqual({ error: 'Invalid URL' });
    });

    it('resolves with error on chrome.runtime.lastError', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        chrome.runtime.lastError = { message: 'Could not establish connection' };
        cb(undefined);
      });
      const result = await getModels('pid', 'openai-compatible', 'https://example.com', 'key');
      expect(result).toHaveProperty('error');
      expect(result.error).toMatch(/Could not establish connection/);
    });

    it('resolves with empty object when response has no data', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        cb({});
      });
      const result = await getModels('pid', 'openai-compatible', 'https://example.com', 'key');
      expect(result).toEqual({});
    });
  });

  describe('generateOpenAIChatCompletion', () => {
    it('rejects when Chrome API is unavailable', async () => {
      vi.stubGlobal('chrome', undefined);
      await expect(
        generateOpenAIChatCompletion('key', {}, 'https://example.com')
      ).rejects.toThrow(/Chrome APIs not available|Extension context invalidated/);
    });

    it('rejects when chrome.runtime.connect is missing', async () => {
      vi.stubGlobal('chrome', {
        runtime: { id: 'x', sendMessage: () => {}, lastError: null },
        storage: {},
      });
      await expect(
        generateOpenAIChatCompletion('key', {}, 'https://example.com')
      ).rejects.toThrow(/Extension context invalidated|connect not available/);
    });

    it('resolves with response-like object and posts message', async () => {
      const mockPort = {
        postMessage: vi.fn(),
        onMessage: { addListener: vi.fn() },
        onDisconnect: { addListener: vi.fn() },
        disconnect: vi.fn(),
      };
      chrome.runtime.connect.mockReturnValue(mockPort);

      const promise = generateOpenAIChatCompletion('key', { messages: [] }, 'https://example.com');
      const [response, abort] = await promise;

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
      expect(mockPort.postMessage).toHaveBeenCalledWith({
        action: 'fetchChatCompletion',
        url: 'https://example.com',
        api_key: 'key',
        body: { messages: [] },
      });
      expect(typeof abort.abort).toBe('function');
    });
  });
});
