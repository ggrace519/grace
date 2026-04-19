# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Grace is a standalone Chrome extension (Browser Integrated Conversation Engine) that connects to any OpenAI-compatible backend and allows users to:

- Get AI responses directly in input fields via keyboard shortcuts
- Open a persistent sidebar panel for AI chat (first message can include the current tab’s page content as context)
- Extract and summarize page content
- Get explanations for selected text
- Maintain conversation history with follow-up questions
- Customize appearance (theme, density, accent color) via the Settings page

## Architecture

### High-Level Structure

```
extension/
├── manifest.json           # Chrome Manifest V3 (content scripts, side panel, popup, commands)
├── background.js           # Service worker (API calls, rate limiting, context menus)
├── content.js              # Content script (DOM setup for in-page app)
├── popup.html / popup.js   # Extension icon popup ("Open search" / "Open sidebar")
├── extension/
│   ├── src/
│   │   ├── main.ts         # Svelte entry for in-page overlay
│   │   ├── sidebar.ts     # Side panel entry (mounts app with sidebarMode: true)
│   │   ├── App.svelte      # Root component
│   │   └── lib/
│   │       ├── apis/       # API helpers (sendMessageWithRetry, getSidebarInit, etc.)
│   │       ├── components/ # SpotlightSearch.svelte (main UI)
│   │       └── utils/      # Markdown, stream splitting
│   ├── vite.content.config.ts  # Builds IIFE bundle for content script
│   ├── dist/               # Build output (git-ignored)
│   │   ├── main.js, sidebar.js, chunk.js, style.css
│   │   ├── index.html, sidebar.html
│   │   └── main-content.js # In-page app bundle (no modules)
│   └── package.json
```

### Component Relationship

```
User Action → content.js / popup / side panel / command
       → background.js (Service Worker) → Open WebUI API
       → Returns via sendResponse or ports (streaming)
       → Svelte App (SpotlightSearch) → UI
```

### Key Architectural Patterns

1. **Manifest V3**: Service worker (no long-lived background page).
2. **Message passing**: UI talks to background via `chrome.runtime.sendMessage`. Use **sendMessageWithRetry** (in `apis/index.js`) for actions that can hit "message port closed" when the worker is cold.
3. **Streaming**: Chat uses `chrome.runtime.connect()` and ReadableStreams; background uses `safePortPost` / `safePortDisconnect` to avoid disconnected-port errors.
4. **Side panel**: Opens only in response to a user gesture (icon click, command, context menu, or popup button). Background must call `sidePanel.open()` synchronously in that gesture; do not `await` before `open()`.
5. **Security**: API keys encrypted (AES-256-GCM), URL validation (SSRF), rate limiting, message action whitelist (`ALLOWED_ACTIONS`).

## Sidebar Init & "Message Port Closed"

The service worker can suspend quickly. If the sidebar sends several messages in a row (decrypt, models, page content), the port may close before a response ("The message port closed before a response was received"). The code mitigates this by:

1. **Ping first**: Sidebar calls **ping** (via `pingSidebarWake()`), then waits ~250ms, then sends **getSidebarInit**. The worker wakes on ping and is still warm for init.
2. **Fast getSidebarInit**: Background handler returns only **config** (storage + decrypt). It does **not** fetch models or page content there, so it can reply quickly.
3. **Separate calls with retry**: After init, the sidebar gets page content via **getActiveTabPageContent** and models via **getModels**, both using **sendMessageWithRetry** (4 retries, 200×attempts ms delay).
4. **Reply-once in background**: Async handlers use a single `reply(payload)` helper so `sendResponse` is only called once; duplicate or late responses can close the port.

When adding new background actions used by the sidebar or on cold start, prefer minimal work before `sendResponse`, or use the same reply-once + retry pattern.

## Development Commands

### Prerequisites

- Node.js 18+
- Chrome/Chromium-based browser

### Commands (in `extension/` directory)

| Command | Description |
|---------|-------------|
| `npm install` | Install dependencies |
| `npm run dev` | Vite dev server (testing outside extension) |
| `npm run build` | Build main app + content script → `extension/dist/` |
| `npm run check` | Svelte type checking |
| `npm test` | Vitest tests |
| `npm run test:watch` | Watch mode |
| `npm run test:coverage` | Coverage report |

After code changes: run `npm run build` and reload the extension in `chrome://extensions`.

## Common Tasks

### Adding a new feature

- **UI**: `extension/src/lib/components/SpotlightSearch.svelte`
- **Background**: `background.js` (add to `ALLOWED_ACTIONS` if it’s a new message action)
- **APIs**: `extension/src/lib/apis/index.js` (use `sendMessageWithRetry` for cold-start-safe calls)

### Modifying security

- **Encryption**: `background.js` (encryptApiKey / decryptApiKey)
- **Rate limiting**: `background.js` (`checkRateLimit`)
- **URL validation**: `background.js` (`isValidUrl`)

## Testing

- Vitest, Node env
- Tests: `extension/src/**/*.test.{js,ts}`
- `npm test` / `npm run test:coverage`

## Keyboard Shortcuts

- **Ctrl+Shift+K** / **Cmd+Shift+K**: Open spotlight search
- **Ctrl+Shift+L** / **Cmd+Shift+L**: Open sidebar (side panel)
- **Ctrl+Shift+Enter** / **Cmd+Shift+Enter**: Send selected text for AI response

## Context Menu

- **Summarize Page**, **Explain This**, **Open search**, **Open sidebar**

## Build Output

`extension/dist/` (git-ignored):

- `main.js`, `sidebar.js`, `chunk.js`, `style.css`, `index.html`, `sidebar.html` (main + side panel)
- `main-content.js` (IIFE for content script; loaded by manifest)

Rebuild with `npm run build` after any source change.
