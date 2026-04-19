import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, PAGE_CONTENT_BUDGET, LINK_SUMMARIES_BUDGET } from './systemPrompt';

describe('buildSystemPrompt', () => {
  it('returns base sidebar prompt when no page content', () => {
    const result = buildSystemPrompt({ mode: 'sidebar' });
    expect(result).toContain('Grace sidebar');
    expect(result).not.toContain('Page content:');
    expect(result).not.toContain('Related pages');
  });

  it('includes page content block when provided', () => {
    const result = buildSystemPrompt({ mode: 'sidebar', pageContent: 'Hello world article text' });
    expect(result).toContain('Page content:');
    expect(result).toContain('Hello world article text');
  });

  it('truncates page content at budget', () => {
    const long = 'x'.repeat(PAGE_CONTENT_BUDGET + 500);
    const result = buildSystemPrompt({ mode: 'sidebar', pageContent: long });
    expect(result).toContain('[Content truncated.]');
    const contentStart = result.indexOf('Page content:\n---\n') + 'Page content:\n---\n'.length;
    const contentEnd = result.indexOf('\n---\nEnd of page content.');
    expect(contentEnd - contentStart).toBeLessThanOrEqual(PAGE_CONTENT_BUDGET + 30);
  });

  it('includes link summaries block when provided', () => {
    const links = [
      { href: 'https://example.com/a', text: 'Article A' },
      { href: 'https://example.com/b', text: 'Article B' },
    ];
    const result = buildSystemPrompt({ mode: 'sidebar', linkSummaries: links });
    expect(result).toContain('Related pages');
    expect(result).toContain('Article A');
    expect(result).toContain('https://example.com/a');
  });

  it('respects link summaries budget', () => {
    const links = Array.from({ length: 100 }, (_, i) => ({
      href: `https://example.com/page-${i}`,
      text: 'x'.repeat(80),
    }));
    const result = buildSystemPrompt({ mode: 'sidebar', linkSummaries: links });
    const linksStart = result.indexOf('Related pages');
    const linksEnd = result.lastIndexOf('---');
    expect(linksEnd - linksStart).toBeLessThanOrEqual(LINK_SUMMARIES_BUDGET + 200);
  });

  it('omits page content block when content is empty or whitespace', () => {
    expect(buildSystemPrompt({ mode: 'sidebar', pageContent: '' })).not.toContain('Page content:');
    expect(buildSystemPrompt({ mode: 'sidebar', pageContent: '   ' })).not.toContain('Page content:');
  });

  it('returns summarize-mode prompt', () => {
    const result = buildSystemPrompt({ mode: 'summarize' });
    expect(result).toContain('summarize');
    expect(result).not.toContain('Grace sidebar');
  });

  it('returns explain-mode prompt', () => {
    const result = buildSystemPrompt({ mode: 'explain' });
    expect(result).toContain('explain');
    expect(result).not.toContain('Grace sidebar');
  });

  it('returns spotlight prompt without page/link blocks', () => {
    const result = buildSystemPrompt({ mode: 'spotlight' });
    expect(result).toContain('helpful assistant');
    expect(result).not.toContain('Page content:');
  });
});
