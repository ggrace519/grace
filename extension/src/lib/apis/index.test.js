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
    it('rejects when Chrome API is unavailable', async () => {
      vi.stubGlobal('chrome', undefined);
      await expect(getModels('key', 'https://example.com')).rejects.toThrow(
        /Chrome APIs not available|Extension context invalidated/
      );
    });

    it('rejects when chrome.runtime.sendMessage is missing', async () => {
      vi.stubGlobal('chrome', { runtime: { id: 'x' }, storage: {} });
      await expect(getModels('key', 'https://example.com')).rejects.toThrow(
        /Chrome APIs not available|Extension context invalidated/
      );
    });

    it('resolves with sorted models on success', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        cb({ data: { data: [{ name: 'Zebra' }, { name: 'alpha' }] } });
      });
      const models = await getModels('key', 'https://example.com');
      expect(models).toHaveLength(2);
      expect(models[0].name).toBe('alpha');
      expect(models[1].name).toBe('Zebra');
    });

    it('rejects on response error', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        cb({ error: 'Invalid URL' });
      });
      await expect(getModels('key', 'https://example.com')).rejects.toEqual('Invalid URL');
    });

    it('rejects on chrome.runtime.lastError', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        chrome.runtime.lastError = { message: 'Could not establish connection' };
        cb(undefined);
      });
      await expect(getModels('key', 'https://example.com')).rejects.toThrow(
        'Could not establish connection'
      );
    });

    it('returns empty array when data is missing', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        cb({});
      });
      const models = await getModels('key', 'https://example.com');
      expect(models).toEqual([]);
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
