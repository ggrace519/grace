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
  headerIds: false,
  mangle: false,
});

// Render markdown to HTML
export const renderMarkdown = (text) => {
  if (!text) return '';
  try {
    return marked.parse(text);
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
