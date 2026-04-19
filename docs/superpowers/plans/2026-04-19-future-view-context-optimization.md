# Future View & Context Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add navigation detection (banner when user goes to a new page), Future View (same-domain link scanning to let Grace proactively surface related pages), and a clean context budget utility that replaces the ad-hoc string template in SpotlightSearch.

**Architecture:** Background pushes navigation events to the sidebar via a named long-lived port (`sidebar-nav`). A pure `buildSystemPrompt()` utility manages token budget, page content truncation, and optional link summaries. The content script gains a `getPageLinks` handler that walks same-origin `<a>` tags and returns structured link data — no extra network fetches in Phase 1.

**Tech Stack:** Chrome MV3, Svelte 4, TypeScript, Vitest — same stack as the rest of the extension.

---

## File Map

| File | Change |
|------|--------|
| `extension/src/lib/utils/systemPrompt.ts` | **Create** — `buildSystemPrompt()`, budget constants, tests |
| `extension/src/lib/utils/systemPrompt.test.ts` | **Create** — Vitest tests for buildSystemPrompt |
| `content.js` | **Modify** — add `getPageLinks` message handler |
| `background.js` | **Modify** — add `getActiveTabPageLinks` action, nav port, tab event listeners |
| `extension/src/lib/apis/index.js` | **Modify** — add `getPageLinks()` and `connectNavPort()` exports |
| `extension/src/lib/components/SpotlightSearch.svelte` | **Modify** — use `buildSystemPrompt()`, nav port + banner, Future View welcome section |

---

### Task 1: buildSystemPrompt utility

**Files:**
- Create: `extension/src/lib/utils/systemPrompt.ts`
- Create: `extension/src/lib/utils/systemPrompt.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `extension/src/lib/utils/systemPrompt.test.ts`:

```typescript
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
    // Should not exceed budget + overhead
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
    // The links block should not exceed the budget significantly
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd extension && npm test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|systemPrompt"
```
Expected: fail with "Cannot find module './systemPrompt'"

- [ ] **Step 3: Implement buildSystemPrompt**

Create `extension/src/lib/utils/systemPrompt.ts`:

```typescript
export const PAGE_CONTENT_BUDGET = 10000; // chars (~2500 tokens at 4 chars/token)
export const LINK_SUMMARIES_BUDGET = 2000; // chars (~500 tokens)

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

const BASE_SIDEBAR = `You are a helpful AI assistant in the Grace sidebar. The user can have any conversation they want. Below is the extracted text from the web page they currently have open—use it as context when their questions relate to the page (e.g. summarizing, explaining, or tasks based on it). If they ask about something not in the content, answer from your general knowledge and say so when it's not from the page. When they do refer to the page, base your answer on what is actually there. Keep a clear, friendly tone and use markdown when it helps. You only respond in the panel; you cannot interact with the browser.`;

const BASE_SIDEBAR_NO_CONTENT = `You are a helpful AI assistant in the Grace sidebar. Help the user with any question or task. Keep a clear, friendly tone and use markdown when it helps.`;

const BASE_SPOTLIGHT = `You are a helpful assistant. Provide clear and concise responses. Use markdown formatting when appropriate.`;

const BASE_SUMMARIZE = `You are a helpful assistant that summarizes web page content. Ignore navigation menus, advertisements, cookie notices, footers, headers, and other non-content elements. Focus on the main article or content of the page. Provide a clear, concise summary. You can use markdown formatting (headers, lists, code blocks, bold, italic, etc.) to make your response more readable and well-structured.`;

const BASE_EXPLAIN = `You are a helpful assistant that explains selected text. Provide clear, educational explanations. Use markdown formatting when it helps clarity.`;

function buildPageContentBlock(pageContent: string): string {
  const trimmed = pageContent.trim();
  if (!trimmed) return '';
  const truncated = trimmed.length > PAGE_CONTENT_BUDGET
    ? trimmed.substring(0, PAGE_CONTENT_BUDGET) + '\n\n[Content truncated.]'
    : trimmed;
  return `\n\n---\nPage content:\n---\n${truncated}\n---\nEnd of page content.\n---`;
}

function buildLinkSummariesBlock(links: LinkSummary[]): string {
  if (!links || links.length === 0) return '';
  let block = '\n\n---\nRelated pages on this site (you may proactively surface these if relevant to the conversation):\n';
  let charsUsed = 0;
  for (const link of links) {
    const line = `- [${link.text}](${link.href})\n`;
    if (charsUsed + line.length > LINK_SUMMARIES_BUDGET) break;
    block += line;
    charsUsed += line.length;
  }
  block += '---';
  return block;
}

export function buildSystemPrompt(options: SystemPromptOptions): string {
  const { mode, pageContent = '', linkSummaries = [] } = options;

  if (mode === 'summarize') return BASE_SUMMARIZE;
  if (mode === 'explain') return BASE_EXPLAIN;
  if (mode === 'spotlight') return BASE_SPOTLIGHT;

  // sidebar mode
  const hasContent = pageContent.trim().length > 0;
  let prompt = hasContent ? BASE_SIDEBAR : BASE_SIDEBAR_NO_CONTENT;

  if (hasContent) {
    prompt += buildPageContentBlock(pageContent);
  }

  if (linkSummaries.length > 0) {
    prompt += buildLinkSummariesBlock(linkSummaries);
  }

  return prompt;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd extension && npm test -- --reporter=verbose 2>&1 | grep -E "systemPrompt|PASS|FAIL"
```
Expected: all systemPrompt tests PASS

- [ ] **Step 5: Commit**

```bash
cd extension && git add src/lib/utils/systemPrompt.ts src/lib/utils/systemPrompt.test.ts && git commit -m "feat: add buildSystemPrompt utility with page content and link summaries budgeting"
```

---

### Task 2: getPageLinks — content script and background

**Files:**
- Modify: `content.js` (add getPageLinks handler)
- Modify: `background.js` (add getActiveTabPageLinks action, add to ALLOWED_ACTIONS)
- Modify: `extension/src/lib/apis/index.js` (add getPageLinks export)
- Modify: `extension/src/lib/utils/systemPrompt.test.ts` (no changes needed — coverage comes from Task 4 integration)

> Note: Tests for this task live in `extension/src/lib/apis/index.test.ts` if it exists, or inline in the component tests. Since getPageLinks is a thin message-passing wrapper, the primary test is: "function exists and returns the right shape." We verify behavior end-to-end in Task 4.

- [ ] **Step 1: Write a test for getPageLinks API function**

Check if `extension/src/lib/apis/index.test.ts` exists. If not, check for any existing api tests:

```bash
ls extension/src/lib/apis/*.test* 2>/dev/null || echo "none"
```

If no test file exists, add a test to a new file `extension/src/lib/apis/index.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock chrome runtime
const mockSendMessage = vi.fn();
vi.stubGlobal('globalThis', {
  chrome: {
    runtime: {
      sendMessage: mockSendMessage,
    },
  },
});

describe('getPageLinks', () => {
  beforeEach(() => {
    mockSendMessage.mockReset();
  });

  it('resolves with link data on success', async () => {
    const fakeLinks = [{ href: 'https://example.com/a', text: 'Article A' }];
    mockSendMessage.mockImplementation((_msg: unknown, cb: (r: unknown) => void) => {
      cb({ data: fakeLinks });
    });
    const { getPageLinks } = await import('./index.js');
    const result = await getPageLinks();
    expect(result.data).toEqual(fakeLinks);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd extension && npm test -- --reporter=verbose 2>&1 | grep -E "getPageLinks|PASS|FAIL"
```
Expected: fail with "getPageLinks is not a function"

- [ ] **Step 3: Add getPageLinks handler to content.js**

In `content.js`, replace the existing `onMessage.addListener` block (currently handles only `getPageContent`) with a version that also handles `getPageLinks`. Find the block starting at line ~182:

```javascript
// BEFORE:
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action !== "getPageContent") return false;
    if (window !== window.top) return false;
    try {
      const data = extractPageContentInTab();
      sendResponse({ data: data || "" });
    } catch (e) {
      sendResponse({ error: (e && e.message) || "Failed to extract content" });
    }
    return true;
  });
}
```

Replace with:

```javascript
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    // Only main frame responds to avoid duplicate replies from iframes
    if (window !== window.top) return false;

    if (request.action === "getPageContent") {
      try {
        const data = extractPageContentInTab();
        sendResponse({ data: data || "" });
      } catch (e) {
        sendResponse({ error: (e && e.message) || "Failed to extract content" });
      }
      return true;
    }

    if (request.action === "getPageLinks") {
      try {
        const origin = window.location.origin;
        const links = [];
        const seen = new Set();
        document.querySelectorAll('a[href]').forEach((a) => {
          try {
            const href = new URL(a.href, window.location.href).href;
            // Same-origin only, skip current page, skip duplicates
            if (!href.startsWith(origin)) return;
            if (href === window.location.href) return;
            if (href.startsWith(window.location.href + '#')) return;
            if (seen.has(href)) return;
            const text = (a.textContent || '').trim().replace(/\s+/g, ' ');
            if (text.length < 10) return;
            seen.add(href);
            links.push({ href, text: text.substring(0, 120) });
          } catch (_) {}
        });
        sendResponse({ data: links.slice(0, 20) });
      } catch (e) {
        sendResponse({ error: (e && e.message) || "Failed to collect links" });
      }
      return true;
    }

    return false;
  });
}
```

- [ ] **Step 4: Add getActiveTabPageLinks action to background.js**

Find the `ALLOWED_ACTIONS` array (line ~148 in background.js). Add `'getActiveTabPageLinks'` to it:

```javascript
// Find this line and add 'getActiveTabPageLinks' to the array:
const ALLOWED_ACTIONS = ['ping', 'getSelection', 'writeText', 'fetchModels', 'toggleSearch', 'encryptApiKey', 'decryptApiKey', 'extractPageContent', 'getActiveTabPageContent', 'getActiveTabPageLinks', 'getSidebarInit', 'summarizePage', 'explainText', 'openSidePanel', 'openSearchFromPopup', 'openSidebarFromPopup', 'openSettings', 'saveProvider', 'deleteProvider', 'setActiveProvider', 'setActiveModel', 'decryptProviderKey', 'saveAppearance'];
```

Then find the `getActiveTabPageContent` handler (line ~1219). Add a new handler for `getActiveTabPageLinks` directly after it, before the next `} else if`:

```javascript
  } else if (request.action == "getActiveTabPageLinks") {
    (async () => {
      let responded = false;
      const reply = (payload) => {
        if (responded) return;
        responded = true;
        try { sendResponse(payload); } catch (e) {}
      };
      try {
        const tabId = await getContextTabId();
        if (!tabId) { reply({ data: [] }); return; }
        const tab = await chrome.tabs.get(tabId);
        const url = tab && tab.url ? tab.url : "";
        if (url.startsWith("chrome://") || url.startsWith("chrome-extension://") || url.startsWith("edge://") || url.startsWith("about:")) {
          reply({ data: [] });
          return;
        }
        const result = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tabId, { action: "getPageLinks" }, (response) => {
            if (chrome.runtime.lastError) resolve({ data: [] });
            else resolve(response || { data: [] });
          });
        });
        reply(result.data ? { data: result.data } : { data: [] });
      } catch (_) {
        reply({ data: [] });
      }
    })();
    return true;
```

- [ ] **Step 5: Add getPageLinks to apis/index.js**

At the end of `extension/src/lib/apis/index.js`, after `getActiveTabPageContent`, add:

```javascript
/**
 * Get same-origin links from the currently active browser tab.
 * Returns up to 20 links: [{ href, text }]. Never rejects — returns { data: [] } on error.
 */
export const getPageLinks = async () => {
  try {
    const c = getChrome();
    if (!c?.runtime?.sendMessage) return { data: [] };
    const response = await sendMessageWithRetry({ action: 'getActiveTabPageLinks' });
    return { data: Array.isArray(response?.data) ? response.data : [] };
  } catch (_) {
    return { data: [] };
  }
};
```

- [ ] **Step 6: Run tests**

```bash
cd extension && npm test 2>&1 | tail -10
```
Expected: all tests still pass (62+ passing)

- [ ] **Step 7: Commit**

```bash
cd "C:/coding-projects/extension/.worktrees/future-view" && git add content.js background.js extension/src/lib/apis/index.js extension/src/lib/apis/index.test.ts && git commit -m "feat: add getPageLinks — content script handler, background action, and api export"
```

---

### Task 3: Navigation detection — background port + sidebar banner

**Files:**
- Modify: `background.js` (sidebar-nav port, tab event listeners)
- Modify: `extension/src/lib/apis/index.js` (connectNavPort export)
- Modify: `extension/src/lib/components/SpotlightSearch.svelte` (nav port connect, banner UI)

> Testing note: The port/tab event wiring in background.js is not unit-testable without a Chrome API harness. Verify by manual smoke test (described at the end). The Svelte component's reactive state (`pendingNavigation`) is tested via the existing component test patterns or manually.

- [ ] **Step 1: Add sidebar-nav port handling to background.js**

Find `chrome.runtime.onConnect.addListener((port) => {` (line ~1499). Before the existing `if (port.name === "chat-stream")` block, add a guard for the nav port. Replace:

```javascript
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "chat-stream") {
```

with:

```javascript
// Sidebar notification port — used to push navigation events to the sidebar
let sidebarNavPort = null;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "sidebar-nav") {
    sidebarNavPort = port;
    port.onDisconnect.addListener(() => {
      sidebarNavPort = null;
    });
    return;
  }

  if (port.name === "chat-stream") {
```

- [ ] **Step 2: Add tab event listeners to background.js**

Find the end of `background.js` — after all `chrome.runtime.onMessage` handlers and before or after the last listener registration. Add navigation listeners:

```javascript
// Navigation detection — push events to sidebar when it is connected via sidebar-nav port
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!sidebarNavPort) return;
  const url = tab.url || '';
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('edge://') || url.startsWith('about:')) return;
  // Only notify if this is the tab the sidebar is tracking
  if (sidePanelContextTabIdMemory != null && tabId !== sidePanelContextTabIdMemory) return;
  safePortPost(sidebarNavPort, { type: 'navigation', tabId, title: tab.title || '', url });
});

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  if (!sidebarNavPort) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url || '';
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('edge://') || url.startsWith('about:')) return;
    safePortPost(sidebarNavPort, { type: 'navigation', tabId, title: tab.title || '', url });
  } catch (_) {}
});
```

- [ ] **Step 3: Add connectNavPort to apis/index.js**

After the `getPageLinks` export, add:

```javascript
/**
 * Opens a long-lived port to receive navigation events pushed by the background.
 * Returns the port. Caller is responsible for calling port.disconnect() on cleanup.
 * onNav is called with { tabId, title, url } on each navigation event.
 */
export const connectNavPort = (onNav) => {
  const c = getChrome();
  if (!c?.runtime?.connect) return null;
  try {
    const port = c.runtime.connect({ name: 'sidebar-nav' });
    port.onMessage.addListener((msg) => {
      if (msg.type === 'navigation') onNav(msg);
    });
    return port;
  } catch (_) {
    return null;
  }
};
```

- [ ] **Step 4: Add nav port connect and banner to SpotlightSearch.svelte**

In the `<script lang="ts">` section, find the existing imports and add:

```typescript
import { generateOpenAIChatCompletion, getModels, getActiveTabPageContent, getPageLinks, connectNavPort, getSidebarInit, pingSidebarWake } from "../apis";
```

Add state variables near the top of the script (after existing `let` declarations):

```typescript
let navPort: any = null;
let pendingNavigation: { title: string; url: string; tabId: number } | null = null;
let pageLinks: Array<{ href: string; text: string }> = [];
```

Find the `onMount` lifecycle function. Add nav port connection inside the `if (sidebarMode)` block, after the existing init call chain. The pattern should be: connect the port after the sidebar is fully initialized. Find where `sidebarMode` init happens (after pingSidebarWake/getSidebarInit) and add at the end of that block:

```typescript
// Connect nav notification port (sidebar only)
if (sidebarMode) {
  navPort = connectNavPort((nav: { tabId: number; title: string; url: string }) => {
    pendingNavigation = nav;
  });
}
```

Find the `onDestroy` call (if present) or add one to disconnect the port:

```typescript
import { onMount, onDestroy } from 'svelte';
// ...
onDestroy(() => {
  if (navPort) {
    try { navPort.disconnect(); } catch (_) {}
    navPort = null;
  }
});
```

Add an `addNewPageContext` function (near other action handlers):

```typescript
async function addNewPageContext() {
  if (!pendingNavigation) return;
  const nav = pendingNavigation;
  pendingNavigation = null;
  // Fetch the new page's content and inject it as a system context note
  isStreaming = true;
  try {
    const pageResult = await getActiveTabPageContent();
    const content = pageResult?.data?.trim() || '';
    const contextNote = content.length > 0
      ? `[Context update: User navigated to "${nav.title}" (${nav.url}). New page content:\n\n${content.substring(0, 8000)}${content.length > 8000 ? '\n\n[Truncated.]' : ''}]`
      : `[Context update: User navigated to "${nav.title}" (${nav.url}). Page content was not available.]`;
    conversationHistory = [
      ...conversationHistory,
      { role: 'user', content: contextNote }
    ];
    // Acknowledge with a brief assistant note (non-streaming, just update history)
    conversationHistory = [
      ...conversationHistory,
      { role: 'assistant', content: `Got it — I now have context from **${nav.title || nav.url}**.` }
    ];
  } catch (_) {
    pendingNavigation = null;
  } finally {
    isStreaming = false;
  }
}
```

- [ ] **Step 5: Add nav banner to the template**

In the Svelte template, find where the input area / conversation area begins. Add the banner directly above the input box (but below the conversation messages). Look for the `<textarea>` or input wrapper and add immediately before it:

```svelte
{#if sidebarMode && pendingNavigation}
  <div style="background:#1a2a1a;border:1px solid #2a4a2a;border-radius:8px;padding:8px 12px;margin-bottom:8px;display:flex;align-items:center;gap:8px;flex-shrink:0">
    <span style="color:#aaa;font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
      New page: <strong style="color:#eee">{pendingNavigation.title || pendingNavigation.url}</strong>
    </span>
    <button
      on:click={addNewPageContext}
      style="background:#2a4a2a;border:none;color:#4ade80;font-size:10px;padding:3px 8px;border-radius:4px;cursor:pointer;white-space:nowrap;flex-shrink:0"
    >Add to conversation</button>
    <button
      on:click={() => pendingNavigation = null}
      style="background:transparent;border:none;color:#555;cursor:pointer;font-size:16px;line-height:1;flex-shrink:0;padding:0 2px"
      aria-label="Dismiss"
    >×</button>
  </div>
{/if}
```

- [ ] **Step 6: Build and verify**

```bash
cd "C:/coding-projects/extension/.worktrees/future-view/extension" && npm run build 2>&1 | tail -15
```
Expected: build completes with no TypeScript errors

- [ ] **Step 7: Run tests**

```bash
npm test 2>&1 | tail -8
```
Expected: all tests still pass

- [ ] **Step 8: Smoke test navigation banner**

1. Load the unpacked extension from `.worktrees/future-view` in `chrome://extensions`
2. Open any webpage, open the Grace sidebar
3. Navigate to a different page on the same site (or a different site)
4. Verify the banner appears: "New page: [title] — Add to conversation / ×"
5. Click "Add to conversation" — verify a context note appears in the conversation
6. Click × — verify banner dismisses without side effects

- [ ] **Step 9: Commit**

```bash
cd "C:/coding-projects/extension/.worktrees/future-view" && git add background.js extension/src/lib/apis/index.js extension/src/lib/components/SpotlightSearch.svelte && git commit -m "feat: navigation detection — sidebar-nav port, tab listeners, and context banner"
```

---

### Task 4: Future View — link summaries in welcome screen + system prompt

**Files:**
- Modify: `extension/src/lib/components/SpotlightSearch.svelte` (fetch links on open, show in welcome, include in buildSystemPrompt call)

> This task wires together Tasks 1 and 2. The logic: when the sidebar opens, fetch same-origin links in the background and store in `pageLinks`. Show up to 5 in the welcome screen as "Related on this site" chips. Pass the full `pageLinks` array into `buildSystemPrompt()` for the system context.

- [ ] **Step 1: Write a test for buildSystemPrompt with link summaries (already written in Task 1)**

Confirm by running:

```bash
cd extension && npm test -- systemPrompt 2>&1 | tail -5
```
Expected: all systemPrompt tests pass

- [ ] **Step 2: Fetch page links when sidebar opens**

In `SpotlightSearch.svelte`, find where the sidebar init sequence runs (the `if (sidebarMode)` block in `onMount` or the initialization function). After the existing page content fetch, add a link fetch:

```typescript
// After existing getActiveTabPageContent call, add:
try {
  const linksResult = await getPageLinks();
  if (Array.isArray(linksResult?.data)) {
    pageLinks = linksResult.data;
  }
} catch (_) {
  pageLinks = [];
}
```

- [ ] **Step 3: Replace inline systemContent template with buildSystemPrompt**

Add the import at the top of the script:

```typescript
import { buildSystemPrompt } from '../utils/systemPrompt';
```

Find where `systemContent` is built (around line 124 in the original, may have shifted). Replace the entire block that builds `systemContent` from scratch with:

```typescript
let systemContent = buildSystemPrompt({ mode: sidebarMode ? 'sidebar' : 'spotlight' });

if (sidebarMode && isFirstMessage) {
  let pageContext = sidebarPageContext;
  if (!pageContext || pageContext.trim().length === 0) {
    await pingSidebarWake();
    await new Promise((r) => setTimeout(r, 250));
    try {
      const pageResult = await getActiveTabPageContent();
      if (pageResult?.data && pageResult.data.trim().length > 0) {
        pageContext = pageResult.data;
      }
    } catch (_) {}
  }
  systemContent = buildSystemPrompt({
    mode: 'sidebar',
    pageContent: pageContext || '',
    linkSummaries: pageLinks,
  });
}
```

Also update the summarize and explain handlers that set `systemContent` (around line ~282 / 526) to use `buildSystemPrompt`:

For summarize (find the `"You are a helpful assistant that summarizes..."` string):
```typescript
systemContent = buildSystemPrompt({ mode: 'summarize' });
```

For explain (find the `"You are a helpful assistant. ... explains selected text..."` string):
```typescript
systemContent = buildSystemPrompt({ mode: 'explain' });
```

- [ ] **Step 4: Add "Related on this site" to the welcome screen**

Find the welcome screen block in the Svelte template (the block with `{#if conversationHistory.filter...length === 0 && !isStreaming}`). Add a Related links section after the suggestion buttons:

```svelte
{#if pageLinks.length > 0}
  <div style="margin-top:8px">
    <p style="color:var(--grace-text-faint);font-size:10px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px">Related on this site</p>
    <div style="display:flex;flex-direction:column;gap:4px">
      {#each pageLinks.slice(0, 5) as link}
        <a
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:var(--grace-bg-input);border:1px solid var(--grace-border);border-radius:6px;text-decoration:none;color:var(--grace-text-muted);font-size:11px;overflow:hidden"
          title={link.href}
        >
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{link.text}</span>
          <span style="color:var(--grace-text-faint);font-size:9px;margin-left:auto;flex-shrink:0">↗</span>
        </a>
      {/each}
    </div>
  </div>
{/if}
```

- [ ] **Step 5: Build**

```bash
cd "C:/coding-projects/extension/.worktrees/future-view/extension" && npm run build 2>&1 | tail -15
```
Expected: clean build, no TypeScript errors

- [ ] **Step 6: Run full test suite**

```bash
npm test 2>&1 | tail -8
```
Expected: 62+ tests passing, 0 failures

- [ ] **Step 7: Smoke test Future View**

1. Reload the extension in `chrome://extensions`
2. Open a page with same-domain links (e.g. a Wikipedia article or a news site)
3. Open the Grace sidebar
4. Verify "Related on this site" section appears in the welcome screen with up to 5 links
5. Click a link — verify it opens in a new tab
6. Start a conversation; ask "what else is on this site?" — Grace should surface the related links
7. Open a page with no same-origin links (e.g. google.com) — verify section does not appear

- [ ] **Step 8: Commit**

```bash
cd "C:/coding-projects/extension/.worktrees/future-view" && git add extension/src/lib/components/SpotlightSearch.svelte && git commit -m "feat: future view — link summaries in welcome screen and system prompt context"
```

---

## Final verification

After all tasks are committed:

```bash
cd "C:/coding-projects/extension/.worktrees/future-view/extension" && npm test && npm run check && npm run build
```

Expected:
- All tests pass
- No TypeScript / svelte-check errors
- Clean build output in `extension/dist/`
