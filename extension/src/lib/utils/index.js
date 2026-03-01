import { marked } from 'marked';

export const splitStream = (splitOn) => {
  let buffer = "";
  return new TransformStream({
    transform(chunk, controller) {
      buffer += chunk;
      const parts = buffer.split(splitOn);
      parts.slice(0, -1).forEach((part) => controller.enqueue(part));
      buffer = parts[parts.length - 1];
    },
    flush(controller) {
      if (buffer) controller.enqueue(buffer);
    },
  });
};

// Configure marked for safe rendering
marked.setOptions({
  breaks: true,
  gfm: true,
});

// Drop raw HTML blocks from LLM output to prevent XSS — markdown formatting is
// preserved since marked still processes headings, bold, lists, code blocks, etc.
marked.use({
  renderer: {
    html() {
      return '';
    },
  },
});

// Render markdown to HTML, sanitizing the output to prevent XSS from
// LLM-controlled content (malicious API responses, prompt injection, etc.)
export const renderMarkdown = (text) => {
  if (!text) return '';
  try {
    const html = marked.parse(text);
    // Strip any event-handler attributes and javascript: URLs that might survive
    // from link/image tokens not covered by the html renderer override.
    return html
      .replace(/\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
      .replace(/(href|src|action)\s*=\s*["']?\s*javascript\s*:[^"'\s>]*/gi, '$1="#"');
  } catch (error) {
    console.error('Error rendering markdown:', error);
    // Fallback to plain text with HTML escaping
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
};

// Parse web search sources from markdown text
// Looks for patterns like [source](url) or [source](url "title")
export function parseWebSearchSources(text) {
  if (!text) return [];

  const sources = [];
  const sourcePattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;

  while ((match = sourcePattern.exec(text)) !== null) {
    sources.push({
      title: match[1],
      url: match[2],
      id: `source-${sources.length}`
    });
  }

  return sources;
}

// Extract web search section from markdown
// Looks for "## Web Search" or "### Web Search" sections
export function extractWebSearchSection(text) {
  if (!text) return null;

  // Look for web search header
  const webSearchPattern = /^##?\s*Web Search\s*\n([\s\S]*?)(?=\n##|\n###|\n\*\*|$)/m;
  const match = text.match(webSearchPattern);

  if (match && match[1]) {
    return match[1].trim();
  }

  return null;
}
