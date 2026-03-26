import { describe, it, expect, vi } from 'vitest';
import { marked } from 'marked';
import { splitStream, renderMarkdown } from './index.js';

describe('utils', () => {
  describe('splitStream', () => {
    it('splits chunks on delimiter', async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue('a');
          controller.enqueue('b');
          controller.enqueue('\n');
          controller.enqueue('c');
          controller.enqueue('\n');
          controller.enqueue('d');
          controller.close();
        },
      });
      const split = stream.pipeThrough(splitStream('\n'));
      const reader = split.getReader();
      const parts = [];
      let result;
      while (!(result = await reader.read()).done) {
        parts.push(result.value);
      }
      expect(parts).toEqual(['ab', 'c', 'd']);
    });

    it('flushes remaining buffer on close', async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue('tail');
          controller.close();
        },
      });
      const split = stream.pipeThrough(splitStream('\n'));
      const reader = split.getReader();
      const parts = [];
      let result;
      while (!(result = await reader.read()).done) {
        parts.push(result.value);
      }
      expect(parts).toEqual(['tail']);
    });

    it('handles empty stream', async () => {
      const stream = new ReadableStream({ start(c) { c.close(); } });
      const split = stream.pipeThrough(splitStream('\n'));
      const reader = split.getReader();
      const parts = [];
      let result;
      while (!(result = await reader.read()).done) {
        parts.push(result.value);
      }
      expect(parts).toEqual([]);
    });
  });

  describe('renderMarkdown', () => {
    it('returns empty string for falsy input', () => {
      expect(renderMarkdown('')).toBe('');
      expect(renderMarkdown(null)).toBe('');
      expect(renderMarkdown(undefined)).toBe('');
    });

    it('renders basic markdown to HTML', () => {
      expect(renderMarkdown('# Hi')).toContain('<h1');
      expect(renderMarkdown('**bold**')).toContain('<strong>');
      expect(renderMarkdown('[link](https://x.com)')).toContain('<a');
    });

    it('escapes and returns plain text on parse error', () => {
      vi.spyOn(marked, 'parse').mockImplementationOnce(() => {
        throw new Error('parse error');
      });
      const bad = 'text with < and &';
      const out = renderMarkdown(bad);
      expect(out).toContain('&lt;');
      expect(out).toContain('&amp;');
    });
  });
});
