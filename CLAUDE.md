# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Chrome extension (Manifest V3) for Open WebUI that provides a spotlight-style search interface for quick AI interactions. It is a **security-enhanced fork** of the [open-webui/extension](https://github.com/open-webui/extension).

**License Compliance (CRITICAL)**: The BSD-style license requires preserving "Open WebUI" branding in the extension name, context menu titles, and all user-facing text. Never remove or alter copyright notices or "Open WebUI" branding.

## Architecture

### Component Overview

```
manifest.json          # Permissions, commands, content scripts, service worker declaration
background.js          # Service worker: API calls, encryption, rate limiting, context menus
content.js             # Injected into all pages: creates #extension-app div, injects CSS
extension/src/
  main.ts              # Mounts Svelte app onto #extension-app (page overlay)
  sidebar.ts           # Same app with sidebarMode:true for Chrome side panel
  lib/
    components/SpotlightSearch.svelte  # All UI: search, responses, conversation history
    apis/index.js                      # Background script communication helpers
    utils/index.js                     # splitStream() SSE parser, renderMarkdown()
    background/                        # Security modules (imported by background.js)
      encryption.js                    # AES-256-GCM API key encrypt/decrypt
      rateLimit.js                     # Sliding window rate limiter
      urlValidation.js                 # SSRF protection
    background-helpers.js              # URL validation + rate limit logic (testable, kept in sync with background.js)
```

### Data Flow

```
User Action → content.js → chrome.runtime.sendMessage → background.js → Open WebUI API
                                                              ↓ (streaming: chrome.runtime.connect port)
                                          SpotlightSearch.svelte ← content.js ← background.js
```

Chat completions stream via `chrome.runtime.connect()` ports with `ReadableStream`; all other messages use `chrome.runtime.sendMessage`.

### Key Architectural Patterns

**Frame Isolation (CRITICAL)**: Content scripts run with `all_frames: true`, so every initialization point must guard against iframes:
```javascript
if (window !== window.top) return; // content.js, main.ts, SpotlightSearch.svelte onMount
```

**Duplicate Initialization Prevention**: `main.ts` uses a global flag `__openwebui_extension_initialized` to prevent re-mounting on extension reload.

**Message Action Whitelist**: `background.js` validates all incoming messages against `ALLOWED_ACTIONS`:
`getSelection`, `writeText`, `fetchModels`, `toggleSearch`, `encryptApiKey`, `decryptApiKey`, `createChat`, `extractPageContent`, `openSidePanel`

Note: `summarizePage` and `explainText` flow **background → content** (triggered by context menu) and are never received as incoming messages, so they are not in this whitelist.

**CSS Isolation**: Extension UI is scoped under `#extension-app` with `!important` rules in `app.css` to prevent host-page CSS interference.

**Context Menu Timing**: Menu registration uses delays (100ms after removing, 50ms between items) and a guard flag to avoid race conditions between parent and child menu creation.

## Development Commands

All commands run from the `extension/` directory:

```bash
npm install           # Install dependencies
npm run build         # Build to extension/dist/ (required before loading/reloading in Chrome)
npm run check         # Svelte type checking
npm test              # Run all Vitest tests once
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
npm run test:deps     # npm audit for dependency vulnerabilities
```

**Run a single test file**:
```bash
npx vitest run src/lib/utils/index.test.js
```

**CI pipeline** (GitHub Actions on push/PR to main/master, working dir: `extension/`):
1. `npm ci` → `npm audit --audit-level=high` → `npm run check` → `npm run build` → `npm test`

## Build Output

Vite builds two entry points into `extension/dist/`:
- `main.js` + `sidebar.js` — compiled JS bundles
- `style.css` — compiled styles
- `sidebar.html` — copied from template

The `dist/` directory is git-ignored; rebuild after any source changes then reload the extension in Chrome (`chrome://extensions/` → refresh icon).

## Testing

Test files live alongside source at `extension/src/**/*.test.{js,ts}`:

| Test file | What's covered |
|-----------|---------------|
| `background-helpers.test.js` | URL validation (SSRF), rate-limit configs, validated fetch URLs |
| `apis/index.test.js` | `getModels`, chat completion, Chrome API message handling |
| `utils/index.test.js` | Stream parsing (`splitStream`), markdown rendering, safe HTML escaping |

`background-helpers.js` extracts pure logic from `background.js` to make it unit-testable — keep these two files in sync.

## Security Features

- **Encryption**: API keys stored encrypted (AES-256-GCM, key derived from extension ID via PBKDF2 100k iterations) — `background.js` `encryptApiKey()`/`decryptApiKey()`
- **Rate limits**: chat completions 10/min, model fetching 5/min, general 20/min
- **SSRF protection**: `urlValidation.js` validates URLs before any fetch; only `http:` and `https:` are allowed
- **CSP**: `manifest.json` sets `script-src 'self'; object-src 'self';`

## Adding Features

**New context menu item**: Register in `background.js` → `registerContextMenus()`, handle in `chrome.contextMenus.onClicked`, add the action string to `ALLOWED_ACTIONS`, handle in `SpotlightSearch.svelte` message listener.

**New API endpoint**: Add handler in `background.js`, add action to `ALLOWED_ACTIONS`, call via `chrome.runtime.sendMessage` from `apis/index.js`.

**After any change**: `npm run build` → reload extension in Chrome → test on multiple sites including complex ones (CSS isolation issues often appear on sites like homedepot.com).
