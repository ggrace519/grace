# AGENTS.md — Grace

Guide for AI assistants working on this codebase.

---

## Project Overview

Grace is a Chrome Extension (Manifest V3) providing browser-integrated AI assistance:

- **Spotlight search** (`Ctrl+Shift+K`) — modal overlay, selected text pre-populated
- **AI response popup** — streaming responses with multi-turn conversation history
- **Sidebar panel** (`Ctrl+Shift+L`) — persistent side panel; first message includes current tab content as optional context
- **Direct-to-input** (`Ctrl+Shift+Enter`) — writes AI response into the focused field
- **Context menu** — Explain This, Summarize Page, Open search, Open sidebar
- **Appearance settings** — theme, density, accent color; stored in `chrome.storage.sync`

---

## Architecture

### Core Files

| File | Role |
|------|------|
| `manifest.json` | Extension manifest — permissions, content scripts, commands, side panel |
| `background.js` | Service worker — API calls, encryption, rate limiting, context menus, page content extraction |
| `content.js` | Content script — creates `#extension-app` mount point, injects stylesheet |
| `popup.html / popup.js` | Extension icon popup |
| `extension/src/main.ts` | In-page overlay entry — mounts Svelte app |
| `extension/src/sidebar.ts` | Side panel entry — mounts app with `sidebarMode: true` |
| `extension/src/settings.ts` | Settings page entry |
| `extension/src/App.svelte` | Root Svelte component |
| `extension/src/app.css` | Global styles, Tailwind directives, CSS isolation overrides, Grace design tokens |
| `extension/src/lib/appearance.ts` | `applyAppearance`, `loadAndApplyAppearance`, `resolveTheme`, `ACCENT_PRESETS` |
| `extension/src/lib/storage.ts` | TypeScript interfaces for stored data (`AppearanceSettings`, etc.) |
| `extension/src/lib/apis/index.js` | Chrome message API helpers (`sendMessageWithRetry`, `getSidebarInit`, etc.) |
| `extension/src/lib/components/SpotlightSearch.svelte` | Main UI — all user interactions, conversation state, streaming display |
| `extension/src/lib/components/Settings.svelte` | Settings page — Providers, Appearance, Shortcuts, About tabs |

### Message Flow

```
User action
  → content.js / popup / sidebar / settings
  → chrome.runtime.sendMessage / connect (port)
  → background.js service worker
  → Open WebUI / OpenAI-compatible API
  → response via sendResponse or port (streaming)
  → Svelte component → DOM update
```

---

## Critical Patterns

### Frame Isolation

Content scripts run with `all_frames: false` (manifest), but always guard anyway:

```javascript
if (window !== window.top) return;
```

This appears in `content.js`, `main.ts`, and `SpotlightSearch.svelte` onMount.

### Duplicate Initialization Prevention

Entry points use a global flag and a DOM flag:

```typescript
// settings.ts, sidebar.ts
if ((window as any).__grace_settings_initialized) return null;
(window as any).__grace_settings_initialized = true;

// Also guard on the target element:
if ((targetElement as any).__svelte_app) return (targetElement as any).__svelte_app;
(targetElement as any).__svelte_app = app;
```

Do **not** add `export default initFn()` at the bottom of entry files — this was the historical double-render bug.

### sendMessageWithRetry

The service worker suspends after ~30s of inactivity. Use `sendMessageWithRetry` (in `apis/index.js`) for any message that could hit a cold worker. It retries on "message port closed" errors with exponential backoff.

### Sidebar Init Sequence

The sidebar sends multiple messages on startup. To avoid port-closed races:

1. Call `pingSidebarWake()` — wakes the worker
2. Wait ~250ms
3. Call `getSidebarInit()` — returns config only (no models, no page content)
4. Call `getActiveTabPageContent()` and `getModels()` separately, both via `sendMessageWithRetry`

When adding new background actions used by the sidebar, keep the handler minimal (reply quickly) and let the caller retry.

### Appearance

Appearance is applied by setting attributes and a CSS custom property on `document.documentElement`:

```typescript
root.setAttribute('data-grace-theme', resolveTheme(settings.theme)); // 'dark' | 'light'
root.setAttribute('data-grace-density', settings.density);
root.style.setProperty('--grace-accent', settings.accentColor);
```

CSS in `app.css` targets `[data-grace-theme="light"]` and `[data-grace-density="compact|comfortable"]` for overrides. The `--grace-*` custom properties are the source of truth for colors.

Call `loadAndApplyAppearance()` **before** mounting any Svelte app to avoid a flash of unstyled content.

In the sidebar, listen for storage changes to apply live updates:

```typescript
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.appearance) {
    applyAppearance({ ...DEFAULT_APPEARANCE, ...changes.appearance.newValue });
  }
});
```

### CSS Isolation

Extension UI is scoped under `#extension-app` with `!important` overrides. When adding new UI elements that appear on host pages, scope them under `#extension-app` and add `!important` to any property that host-page CSS could override.

### Security Invariants

- **Always** encrypt API keys before storage — use `encryptApiKey` / `decryptApiKey` in `background.js`
- **Always** validate message actions against `ALLOWED_ACTIONS` — add new actions there when adding new background handlers
- **Always** validate URLs with `isValidUrl` before outbound requests
- **Always** check rate limits before API calls
- **Never** use `eval()` or `innerHTML` on user-provided content

---

## Adding Features

### New context menu item

1. Register in `background.js` → `registerContextMenus()`
2. Handle click in `chrome.contextMenus.onClicked`
3. Add the action string to `ALLOWED_ACTIONS`
4. Handle in `SpotlightSearch.svelte` message listener

### New background action

1. Add handler in `background.js`
2. Add to `ALLOWED_ACTIONS`
3. Add caller in `apis/index.js` using `sendMessageWithRetry`
4. Keep the handler fast — reply before doing heavy work, or use the retry pattern

### New UI styles

1. Add `--grace-*` custom properties to `:root` in `app.css` if it's a new token
2. Use `var(--grace-*)` in component styles — no hardcoded colors
3. Scope to `#extension-app` with `!important` if the rule targets host-page surfaces

---

## Development Workflow

1. Edit source files in `extension/src/`
2. `cd extension && npm run build`
3. Reload extension in `chrome://extensions/`
4. Test on a real page

### Testing Checklist

- [ ] Main frame only (not iframes)
- [ ] With text selected / without text selected
- [ ] Keyboard shortcuts: `Ctrl+Shift+K`, `Ctrl+Shift+L`, `Ctrl+Shift+Enter`
- [ ] Context menu: Explain This, Summarize Page, Open search, Open sidebar
- [ ] Appearance tab: theme switch, density switch, accent color change
- [ ] Appearance persists after extension reload
- [ ] No duplicate console logs
- [ ] Modal displays correctly (not full-screen, not obscured)
- [ ] `npm test` — all tests pass

### Debugging

- **Browser console** — content script logs
- **Service worker console** — `chrome://extensions/` → "service worker" link
- **Storage** — DevTools → Application → Storage → Extension Storage
- Use `console.log('Grace:', ...)` prefix for easy filtering
- Test on `about:blank` first to eliminate host-page interference

---

## File Structure (full)

```
extension/
├── manifest.json
├── background.js
├── content.js
├── popup.html
├── popup.js
├── LICENSE
├── README.md
├── SECURITY.md
├── AGENTS.md
├── CLAUDE.md
├── images/
└── extension/
    ├── src/
    │   ├── main.ts
    │   ├── sidebar.ts
    │   ├── settings.ts
    │   ├── App.svelte
    │   ├── app.css
    │   ├── global.d.ts
    │   └── lib/
    │       ├── appearance.ts
    │       ├── appearance.test.ts
    │       ├── storage.ts
    │       ├── apis/
    │       │   ├── index.js
    │       │   └── index.test.js
    │       ├── components/
    │       │   ├── SpotlightSearch.svelte
    │       │   ├── Settings.svelte
    │       │   ├── ProviderSwitcher.svelte
    │       │   └── SlashCommandMenu.svelte
    │       └── utils/
    │           ├── index.js
    │           └── index.test.js
    ├── sidebar.html
    ├── settings.html
    ├── dist/                  # git-ignored build output
    ├── vite.config.ts
    ├── vite.content.config.ts
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── tsconfig.json
    └── package.json
```

---

## Key Dependencies

| Package | Purpose |
|---------|---------|
| Svelte 4 | UI framework |
| TypeScript | Type safety |
| Vite | Build tool (two configs: main app + IIFE content bundle) |
| Tailwind CSS | Utility classes (prefixed `tlwd-`) |
| marked | Markdown → HTML |
| Vitest | Unit tests |
