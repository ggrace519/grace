# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Chrome extension for Open WebUI that provides a spotlight-style search interface for quick AI interactions. The extension connects to a local or remote Open WebUI instance (running Ollama or other LLM backends) and allows users to:

- Get AI responses directly in input fields via keyboard shortcuts
- Open a persistent sidebar panel for AI chat
- Extract and summarize page content
- Get explanations for selected text
- Maintain conversation history with follow-up questions

## Architecture

### High-Level Structure

```
extension/
├── manifest.json          # Chrome Manifest V3 configuration
├── background.js          # Service worker (API calls, rate limiting, context menus)
├── content.js             # Content script injector ( DOM setup )
├── extension/             # Svelte frontend application
│   ├── src/
│   │   ├── main.ts        # Svelte app entry point (page overlay)
│   │   ├── sidebar.ts     # Side panel entry point
│   │   ├── App.svelte     # Root component
│   │   └── lib/
│   │       ├── apis/      # API helpers (background script communication)
│   │       ├── components/ # Svelte components (SpotlightSearch)
│   │       ├── utils/     # Markdown rendering, stream splitting
│   │       └── background/ # Security modules (encryption, rate limiting, URL validation)
│   ├── sidebar.html       # Side panel HTML template
│   ├── dist/              # Build output (main.js, style.css, sidebar.html)
│   └── package.json
```

### Component Relationship

```
User Action → content.js → background.js (Service Worker) → Open WebUI API
                                ↓
                      Returns via ports/messages
                                ↓
                      content.js → Svelte App → User Interface
```

### Key Architectural Patterns

1. **Manifest V3 Architecture**: Uses service workers instead of background pages
2. **Message Passing**: Content scripts communicate with background service worker via `chrome.runtime.sendMessage`
3. **Streaming via Ports**: Chat completions use `chrome.runtime.connect()` with ReadableStreams for real-time response streaming
4. **Security-First Design**:
   - API keys encrypted with AES-256-GCM (key derived from extension ID)
   - SSRF protection via URL validation
   - Rate limiting on all API endpoints
   - Message action whitelist

## Development Commands

### Prerequisites
- Node.js 18+
- Chrome/Chromium-based browser

### Commands (in `extension/` directory)

| Command | Description |
|---------|-------------|
| `npm install` | Install dependencies |
| `npm run dev` | Start Vite dev server (for testing outside extension) |
| `npm run build` | Build production bundle to `extension/dist/` |
| `npm run check` | Run Svelte type checking |
| `npm test` | Run Vitest tests |
| `npm run test:watch` | Watch mode for tests |
| `npm run test:coverage` | Run tests with coverage report |

## Common Tasks

### Adding a New Feature

1. **For UI changes**: Modify Svelte components in `extension/src/lib/components/`
2. **For background logic**: Add functions in `background.js` or modules in `extension/src/lib/background/`
3. **For API integration**: Update `extension/src/lib/apis/index.js`
4. **After changes**: Rebuild with `npm run build` and reload extension in Chrome

### Modifying Security Features

- **Encryption**: `extension/src/lib/background/encryption.js` (AES-256-GCM)
- **Rate Limiting**: `extension/src/lib/background/rateLimit.js` (sliding window)
- **URL Validation**: `extension/src/lib/background/urlValidation.js` (SSRF protection)
- **Content Security Policy**: Configured in `manifest.json`

## Testing

Tests use Vitest with Node environment:
- Test files: `extension/src/**/*.test.{js,ts}`
- Run: `npm test`
- Coverage: `npm run test:coverage`

## Keyboard Shortcuts

- `Ctrl+Shift+K` / `Cmd+Shift+K`: Open spotlight search
- `Ctrl+Shift+L` / `Cmd+Shift+L`: Open Open WebUI sidebar (side panel)
- `Ctrl+Shift+Enter` / `Cmd+Shift+Enter`: Send selected text for AI response

## Context Menu Items

- **Summarize Page**: Extract main content and get AI summary
- **Explain This**: Get AI explanation for selected text
- **Open sidebar**: Open the AI chat in Chrome’s side panel

## Build Output

The Svelte app builds to `extension/dist/`:
- `main.js` - Compiled JavaScript bundle
- `style.css` - Compiled CSS styles
- `vite.svg` - Asset file

This directory is git-ignored. Rebuild with `npm run build` after any source changes.
