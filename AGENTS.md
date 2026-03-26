# AGENTS.md - Guide for LLMs Working on This Project

This document provides essential information for AI assistants working on the Open WebUI Chrome Extension project.

## 📋 Project Overview

This is a Chrome Extension (Manifest V3) that integrates with Open WebUI to provide:
- Spotlight-style search interface (`Ctrl+Shift+K`)
- Sidebar panel for persistent AI chat (`Ctrl+Shift+L` or context menu "Open sidebar"). On the first message in a conversation, the current tab’s page content is included as optional context so the user can ask about the page or have any conversation
- AI-powered text explanations via context menu
- Page summarization via context menu
- Direct AI responses in input fields (`Ctrl+Shift+Enter`)
- Conversation history and follow-up questions
- Streaming AI responses

**Important**: This is a fork of the original [Open WebUI Extension](https://github.com/open-webui/extension) with security enhancements and additional features.

## 🏗️ Architecture

### Core Components

1. **`manifest.json`** - Chrome Extension manifest (Manifest V3)
   - Defines permissions, content scripts, background worker, commands
   - Content scripts run on `all_frames: true` (important for iframe handling)

2. **`background.js`** - Service Worker (Background Script)
   - Handles API calls to Open WebUI backend
   - Manages context menu registration
   - Encrypts/decrypts API keys (AES-256-GCM)
   - Implements rate limiting
   - Validates all messages from content scripts
   - Extracts page content for summarization

3. **`content.js`** - Content Script
   - Injected into all web pages
   - Creates `#extension-app` div for Svelte app
   - Injects CSS stylesheet
   - **CRITICAL**: Only runs in main frame (`window !== window.top` check)

4. **`extension/src/main.ts`** - Svelte App Entry Point
   - Mounts Svelte app to `#extension-app`
   - **CRITICAL**: Prevents duplicate initialization with global flag
   - Only runs in main frame

5. **`extension/src/lib/components/SpotlightSearch.svelte`** - Main UI Component
   - Handles all user interactions
   - Manages conversation history
   - Displays streaming responses
   - Handles keyboard shortcuts
   - Implements "Explain This", "Summarize Page", and sidebar mode. In sidebar mode, the first message in a conversation fetches the active tab’s content via `getActiveTabPageContent` and injects it into the system prompt as optional context
   - **CRITICAL**: `onMount` only runs in main frame

6. **`extension/src/sidebar.ts`** - Side Panel Entry Point
   - Mounts the same App/SpotlightSearch in Chrome side panel with `sidebarMode: true`
   - Uses `extension/sidebar.html` as template; build outputs to `dist/sidebar.html`

7. **`extension/src/lib/utils/index.js`** - Utility Functions
   - `splitStream()` - Parses streaming SSE responses
   - `renderMarkdown()` - Converts markdown to HTML using `marked` library

8. **`extension/src/app.css`** - Global Styles
   - Tailwind CSS directives
   - CSS isolation rules with `!important` to prevent website CSS conflicts
   - Markdown content styling

## 🔑 Key Patterns & Conventions

### 1. Frame Isolation (CRITICAL)

**Problem**: Content scripts run with `all_frames: true`, causing duplicate initialization in iframes.

**Solution**: Always check `window !== window.top` before initialization:
```javascript
// In content.js
if (window !== window.top) {
  return;
}

// In main.ts
if (window !== window.top) {
  return null;
}

// In SpotlightSearch.svelte onMount
if (window !== window.top) {
  return;
}
```

### 2. Duplicate Initialization Prevention

**Problem**: Script reloads can cause multiple initializations.

**Solution**: Use global flags:
```javascript
// In main.ts
const GLOBAL_INIT_KEY = '__openwebui_extension_initialized';
if ((window as any)[GLOBAL_INIT_KEY]) {
  return null;
}
(window as any)[GLOBAL_INIT_KEY] = true;
```

### 3. Message Passing

**Background ↔ Content Script Communication**:
- Content script sends: `chrome.runtime.sendMessage({ action: '...', ... })`
- Background responds: `sendResponse({ ... })` or returns Promise
- Background sends to content: `chrome.tabs.sendMessage(tabId, { action: '...', ... })`

**Allowed Actions** (defined in `ALLOWED_ACTIONS` array):
- `getSelection`, `writeText`, `fetchModels`, `toggleSearch`
- `encryptApiKey`, `decryptApiKey`, `createChat`
- `extractPageContent`, `getActiveTabPageContent` (sidebar: current tab content as context)
- `summarizePage`, `explainText`, `openSidePanel`

### 4. Error Handling

**Extension Context Invalidated**:
```javascript
if (error.message && error.message.includes('Extension context invalidated')) {
  // Gracefully stop, don't show error to user
  return;
}
```

**Rate Limiting**:
- Check `response.status === 429`
- Display user-friendly error message
- Don't retry immediately

### 5. CSS Isolation

**Problem**: Website CSS can interfere with extension UI.

**Solution**: Use scoped selectors with `!important`:
```css
#extension-app #openwebui-response-modal {
  position: fixed !important;
  z-index: 2147483647 !important;
  /* ... */
}
```

### 6. Context Menu Registration

**Timing Issues**: Parent menu must exist before child menus.

**Solution**: Use delays and guard flags:
```javascript
let isRegisteringMenus = false;
// Remove all menus first
// Wait 100ms
// Create parent menu
// Wait 50ms
// Create child menus
```

## 🔒 Security Requirements

### 1. API Key Encryption
- All API keys encrypted with AES-256-GCM before storage
- Key derived from extension ID using PBKDF2 (100,000 iterations)
- See `encryptApiKey()` and `decryptApiKey()` in `background.js`

### 2. Rate Limiting
- Chat completions: 10/min
- Model fetching: 5/min
- General API: 20/min
- Implemented in `background.js` with `rateLimiters` object

### 3. Input Validation
- All user inputs validated before API calls
- URL validation prevents SSRF attacks
- Message actions whitelisted in `ALLOWED_ACTIONS`

### 4. Content Security Policy
- Defined in `manifest.json`
- `script-src 'self'; object-src 'self';`

## 📜 License Compliance

**CRITICAL**: This project uses a modified BSD license that requires:

1. **Copyright Notice**: Must retain "Copyright (c) 2023-2025 Timothy Jaeryang Baek (Open WebUI)"
2. **Branding**: Must maintain "Open WebUI" branding in:
   - Extension name (`manifest.json`: "Open WebUI Extension")
   - Context menu titles ("OpenWebUI Extension")
   - User-facing text
   - Documentation

**DO NOT**:
- Remove or alter "Open WebUI" branding
- Change extension name to remove "Open WebUI"
- Remove copyright notices

**See**: `LICENSE` file for full terms.

## 🛠️ Development Workflow

### 1. Making Changes

1. **Edit source files** in `extension/src/`
2. **Build**: `cd extension && npm run build`
3. **Reload extension** in Chrome (`chrome://extensions/` → refresh icon)
4. **Test** on a webpage

### 2. Testing Checklist

- [ ] Test in main frame (not iframe)
- [ ] Test with text selected
- [ ] Test without text selected
- [ ] Test keyboard shortcuts (search `Ctrl+Shift+K`, sidebar `Ctrl+Shift+L`)
- [ ] Test context menu options (Explain This, Summarize Page, Open sidebar)
- [ ] Test on different websites (especially complex ones like homedepot.com)
- [ ] Check console for errors
- [ ] Verify no duplicate initializations
- [ ] Verify modal displays correctly (CSS isolation)

### 3. Common Issues & Solutions

**Issue**: Modal not displaying correctly
- **Check**: CSS isolation rules in `app.css`
- **Solution**: Add more specific selectors with `!important`

**Issue**: "Extension context invalidated" errors
- **Cause**: Extension reloaded during use
- **Solution**: Handle gracefully, don't show error to user

**Issue**: Duplicate console logs
- **Cause**: Script running in iframes
- **Solution**: Add `window !== window.top` checks

**Issue**: Context menu not appearing
- **Check**: Menu registration timing
- **Solution**: Ensure parent menu exists before child menus

**Issue**: "No content extracted"
- **Cause**: Page content extraction failed
- **Solution**: Improve extraction logic in `extractPageContentScript()` (Strategy 4 for product pages)

## 📁 File Structure

```
extension/
├── manifest.json              # Extension manifest
├── background.js              # Service worker (API calls, encryption, rate limiting)
├── content.js                 # Content script (DOM setup)
├── LICENSE                    # License file (MUST maintain)
├── README.md                  # User documentation
├── SECURITY.md                # Security documentation
├── AGENTS.md                  # This file
├── images/                    # Extension icons
└── extension/                 # Svelte application
    ├── src/
    │   ├── main.ts            # Entry point (mounts Svelte app on page)
    │   ├── sidebar.ts         # Side panel entry point (sidebarMode)
    │   ├── App.svelte         # Root component (minimal wrapper)
    │   ├── app.css            # Global styles + CSS isolation
    │   └── lib/
    │       ├── components/
    │       │   └── SpotlightSearch.svelte  # Main UI component
    │       ├── apis/
    │       │   └── index.js   # API utilities
    │       └── utils/
    │           └── index.js   # Utilities (splitStream, renderMarkdown)
    ├── sidebar.html           # Side panel HTML template
    ├── dist/                  # Build output (main.js, style.css, sidebar.html)
    └── package.json           # Dependencies and scripts
```

## 🎯 Common Tasks

### Adding a New Context Menu Option

1. **Register menu** in `background.js` → `registerContextMenus()`:
   ```javascript
   chrome.contextMenus.create({
     id: 'new-feature',
     parentId: 'openwebui-extension',
     title: 'New Feature',
     contexts: ['selection'] // or ['page', 'selection']
   });
   ```

2. **Handle click** in `background.js` → `chrome.contextMenus.onClicked`:
   ```javascript
   else if (info.menuItemId === 'new-feature') {
     // Send message to content script
     chrome.tabs.sendMessage(tabId, { action: 'newFeature', ... });
   }
   ```

3. **Add action** to `ALLOWED_ACTIONS` array in `background.js`

4. **Handle in content script** (`SpotlightSearch.svelte`):
   ```javascript
   // In message listener
   if (request.action === 'newFeature') {
     // Handle the action
   }
   ```

### Adding a New API Endpoint

1. **Add function** in `background.js`:
   ```javascript
   async function handleNewEndpoint(data) {
     // Validate input
     // Check rate limits
     // Make API call
     // Return result
   }
   ```

2. **Add to message handler**:
   ```javascript
   if (message.action === 'newEndpoint') {
     const result = await handleNewEndpoint(message.data);
     return { data: result };
   }
   ```

3. **Add to `ALLOWED_ACTIONS`**

### Modifying UI Styles

1. **Edit** `extension/src/app.css` for global styles
2. **Edit** component `.svelte` files for component-specific styles
3. **Use Tailwind classes** with `tlwd-` prefix (if configured)
4. **Add CSS isolation** rules if website CSS interferes

### Adding Markdown Support

- Already implemented using `marked` library
- Use `renderMarkdown()` from `utils/index.js`
- Display with `{@html renderMarkdown(text)}` in Svelte
- Style markdown elements in `app.css` under `.markdown-content`

## 🐛 Debugging Tips

1. **Check browser console** for errors
2. **Check extension service worker** (`chrome://extensions/` → "service worker" link)
3. **Use `console.log()`** with "Extension:" prefix for easy filtering
4. **Test on simple pages first** (e.g., `about:blank`)
5. **Reload extension** after code changes
6. **Check `chrome.storage.local`** for stored config (DevTools → Application → Storage)

## 📝 Code Style Guidelines

1. **Use descriptive variable names**
2. **Add comments** for complex logic
3. **Handle errors gracefully** with user-friendly messages
4. **Use async/await** for async operations
5. **Validate inputs** before API calls
6. **Check `chrome.runtime.lastError`** after Chrome API calls
7. **Use TypeScript** for type safety (`.ts` files)
8. **Follow Svelte conventions** (reactive statements, lifecycle hooks)

## ⚠️ Important Warnings

1. **NEVER** remove Open WebUI branding
2. **NEVER** remove copyright notices
3. **ALWAYS** check `window !== window.top` before initialization
4. **ALWAYS** validate message actions against `ALLOWED_ACTIONS`
5. **ALWAYS** encrypt API keys before storage
6. **ALWAYS** check rate limits before API calls
7. **ALWAYS** handle "Extension context invalidated" errors gracefully
8. **ALWAYS** test on multiple websites, especially complex ones

## 🔗 Key Dependencies

- **Svelte** - UI framework
- **Tailwind CSS** - Styling
- **marked** - Markdown rendering
- **Vite** - Build tool
- **TypeScript** - Type safety

## 📚 Additional Resources

- [Chrome Extension Manifest V3 Docs](https://developer.chrome.com/docs/extensions/mv3/)
- [Svelte Documentation](https://svelte.dev/docs)
- [Open WebUI API Documentation](https://github.com/open-webui/open-webui)
- Original Extension: [open-webui/extension](https://github.com/open-webui/extension)

## 🎓 Learning the Codebase

**Start here**:
1. Read `manifest.json` to understand structure
2. Read `content.js` to see initialization
3. Read `background.js` to understand API integration
4. Read `SpotlightSearch.svelte` to understand UI logic
5. Read `LICENSE` to understand legal requirements

**Key functions to understand**:
- `registerContextMenus()` - Context menu setup
- `handleExtractPageContent()` - Page content extraction
- `chatCompletion()` - AI API calls
- `encryptApiKey()` / `decryptApiKey()` - Security
- `explainText()` / `summarizePage()` - Feature implementations

---

**Last Updated**: 2026-02-14
**Maintainer**: See README.md for attribution

