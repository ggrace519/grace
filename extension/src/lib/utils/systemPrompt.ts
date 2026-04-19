export const PAGE_CONTENT_BUDGET = 10000; // chars
export const LINK_SUMMARIES_BUDGET = 2000; // chars

export type PromptMode = 'sidebar' | 'spotlight' | 'summarize' | 'explain';

export interface LinkSummary {
  href: string;
  text: string;
}

export interface SystemPromptOptions {
  mode: PromptMode;
  pageContent?: string;
  linkSummaries?: LinkSummary[];
}

export function buildSystemPrompt(options: SystemPromptOptions): string {
  const { mode, pageContent, linkSummaries } = options;

  if (mode === 'summarize') {
    return 'You are a helpful assistant. Your task is to summarize web page content. Ignore navigation menus, ads, and footers. Focus on the main article or primary content. Use markdown formatting for your summary.';
  }

  if (mode === 'explain') {
    return 'You are a helpful assistant that explains selected text or concepts. The user will provide text they want explained. Provide a clear, educational explanation that covers: what the term or concept means, why it matters, a concrete example if helpful, and any closely related ideas worth knowing. Use markdown formatting (bold key terms, use lists for multiple points) when it improves clarity.';
  }

  if (mode === 'spotlight') {
    return 'You are a helpful assistant. Use markdown formatting in your responses.';
  }

  // sidebar mode
  let prompt = 'You are a helpful AI assistant in the Grace sidebar. Use markdown formatting in your responses.';

  const trimmedContent = pageContent?.trim() ?? '';

  if (trimmedContent.length > 0) {
    let content = trimmedContent;
    if (content.length > PAGE_CONTENT_BUDGET) {
      content = content.slice(0, PAGE_CONTENT_BUDGET) + '\n\n[Content truncated.]';
    }
    prompt += `\n\n---\nPage content:\n---\n${content}\n---\nEnd of page content.\n---`;
  }

  if (trimmedContent.length > 0 && linkSummaries && linkSummaries.length > 0) {
    const header = '\n\n---\nRelated pages on this site (you may proactively surface these if relevant to the conversation):\n';
    const footer = '\n---';
    let linksContent = '';
    for (const link of linkSummaries) {
      const line = `- [${link.text}](${link.href})\n`;
      if (linksContent.length + line.length > LINK_SUMMARIES_BUDGET) {
        break;
      }
      linksContent += line;
    }
    if (linksContent.length > 0) {
      prompt += header + linksContent.trimEnd() + footer;
    }
  }

  return prompt;
}
