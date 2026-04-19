# Grace

**Browser Integrated Conversation Engine** — spotlight search, persistent sidebar, and page AI tools for Chrome.

Grace is a Chrome extension that brings AI assistance directly into your browsing experience. It connects to any OpenAI-compatible backend (Open WebUI, Ollama, etc.) and lets you chat, summarize, and query AI without leaving the page you're on.

---

## Features

### Spotlight Search — `Ctrl+Shift+K`

A modal overlay you can open from any tab. Selected text is pre-populated. Submit to get a streaming response inline, or push it to Open WebUI.

### AI Response Popup

Streaming AI responses appear in a floating modal with full multi-turn conversation history and one-click copy.

### Sidebar Panel — `Ctrl+Shift+L`

Opens Chrome's built-in side panel. The sidebar persists across navigation. On the **first message** of each conversation, Grace automatically includes the current tab's page text as optional context — ask about the page, or chat about anything.

### Direct-to-Input — `Ctrl+Shift+Enter`

With text selected and a text field focused, sends the selection to the AI and writes the response directly into the active input or textarea.

### Context Menu

Right-click any page for:

- **Explain This** — selected text → definitions, examples, related concepts
- **Summarize Page** — full page content → concise summary
- **Open search** — opens the spotlight search overlay
- **Open sidebar** — opens the side panel

### Appearance Settings

Settings → **Appearance** tab:

- **Theme**: Dark / Light / System (follows OS preference)
- **Density**: Compact / Normal / Comfortable
- **Accent color**: 8 presets or a custom hex color picker

Changes apply immediately across all extension surfaces and persist in `chrome.storage.sync`.

---

## Installation

### 1. Clone

```bash
git clone https://github.com/ggrace519/extension.git
cd extension
```

### 2. Build

```bash
cd extension
npm install
npm run build
```

### 3. Load in Chrome

1. Navigate to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the root `extension/` directory (the one containing `manifest.json`)

---

## Configuration

### Provider Setup

1. Open Settings via the extension icon popup or from within the spotlight search
2. Go to the **Providers** tab
3. Add your backend URL (e.g. `http://localhost:8080`) and API key
4. Click the refresh icon to load available models
5. Select your default model

API keys are encrypted with AES-256-GCM before storage.

### Appearance

Settings → **Appearance** tab. Changes take effect immediately and sync across devices.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+K` / `Cmd+Shift+K` | Open spotlight search |
| `Ctrl+Shift+L` / `Cmd+Shift+L` | Open sidebar |
| `Ctrl+Shift+Enter` / `Cmd+Shift+Enter` | Send selected text → write response into focused field |
| `Escape` | Close any overlay |

---

## Development

### Prerequisites

- Node.js 18+
- Chrome / Chromium (Manifest V3)

### Commands

Run from the `extension/` directory:

| Command | Description |
|---------|-------------|
| `npm install` | Install dependencies |
| `npm run dev` | Vite dev server (outside extension context) |
| `npm run build` | Build to `extension/dist/` |
| `npm run check` | Svelte type checking |
| `npm test` | Run unit tests (Vitest) |
| `npm run test:watch` | Watch mode |
| `npm run test:coverage` | Coverage report |

After any source change: `npm run build` → reload extension in `chrome://extensions/`.

### Project Structure

```
extension/
├── manifest.json              # Chrome Manifest V3
├── background.js              # Service worker (API, encryption, rate limiting)
├── content.js                 # Content script (DOM setup)
├── popup.html / popup.js      # Extension icon popup
├── images/                    # Icons
└── extension/
    ├── src/
    │   ├── main.ts            # In-page overlay entry
    │   ├── sidebar.ts         # Side panel entry
    │   ├── settings.ts        # Settings page entry
    │   ├── App.svelte         # Root component
    │   ├── app.css            # Global styles + CSS isolation
    │   └── lib/
    │       ├── appearance.ts  # Theme, density, accent logic
    │       ├── storage.ts     # Storage type definitions
    │       ├── apis/          # Chrome message API helpers
    │       ├── components/    # SpotlightSearch, Settings, etc.
    │       └── utils/         # Markdown, stream splitting
    ├── sidebar.html           # Side panel HTML template
    ├── settings.html          # Settings page HTML template
    ├── dist/                  # Build output (git-ignored)
    └── package.json
```

### Testing

Vitest with jsdom. Tests at `extension/src/**/*.test.{js,ts}`.

| Test file | What it covers |
|-----------|----------------|
| `background-helpers.test.js` | URL validation (SSRF), rate-limit config |
| `apis/index.test.js` | getModels, chat completion, Chrome API stubs |
| `utils/index.test.js` | Stream parsing, markdown rendering |
| `lib/appearance.test.ts` | applyAppearance, resolveTheme, ACCENT_PRESETS |

### CI

On push / PR to `main`, GitHub Actions runs:

1. `npm ci`
2. `npm audit --audit-level=high`
3. `npm run check`
4. `npm run build`
5. `npm test`

---

## Troubleshooting

**Extension not loading** — ensure `extension/dist/` exists (`npm run build`) and you loaded the directory containing `manifest.json`.

**Models not loading** — verify your API URL is reachable and the API key has model-read permissions.

**Shortcuts not working** — some sites intercept `Ctrl+Shift+*`. Check `chrome://extensions/shortcuts` for conflicts.

---

## Permissions

| Permission | Why |
|------------|-----|
| `storage` | Save settings and appearance preferences |
| `scripting` | Inject content scripts |
| `contextMenus` | Right-click menu items |
| `sidePanel` | Chrome side panel API |
| `commands` | Keyboard shortcuts |
| `host_permissions: <all_urls>` | Run on all websites |

---

## Security

See [SECURITY.md](./SECURITY.md) for the full security design.

- AES-256-GCM encryption for API keys (PBKDF2-derived key, unique per installation)
- Rate limiting: 10 chat/min, 5 model-fetch/min, 20 general/min
- SSRF protection via URL validation in the service worker
- Message action whitelist (`ALLOWED_ACTIONS`) in background.js
- No `eval()`, no `innerHTML` on user content

---

## License

License TBD. See [LICENSE](./LICENSE).
