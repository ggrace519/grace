# Multi-Provider Support + Claude API + Settings Redesign

**Date:** 2026-04-17
**Branch:** add-feature--Include-current-web-page-as-context-for-the-model (base for this work)
**Status:** Approved — ready for implementation planning

---

## Overview

Replace the single-provider config (URL + API key + model) with a multi-provider system. Add native Anthropic/Claude API support alongside the existing OpenAI-compatible path. Move all configuration out of the spotlight UI into a dedicated settings page. Add a provider/model switcher to the spotlight and sidebar, and add slash commands in the chat input. Remove all Open WebUI branding.

---

## 1. Data Model

### Storage Schema (new)

```json
{
  "providers": [
    {
      "id": "<uuid>",
      "name": "My Claude",
      "type": "anthropic",
      "encryptedKey": "<aes-256-gcm encrypted>",
      "url": null
    },
    {
      "id": "<uuid>",
      "name": "Local Ollama",
      "type": "openai-compatible",
      "encryptedKey": "<aes-256-gcm encrypted>",
      "url": "http://localhost:11434"
    }
  ],
  "activeProviderId": "<uuid>",
  "activeModel": "claude-sonnet-4-6"
}
```

### Provider Types

| Field | `anthropic` | `openai-compatible` |
|-------|-------------|---------------------|
| `url` | null (hardcoded to `https://api.anthropic.com`) | required |
| `encryptedKey` | Anthropic API key | OpenAI-compatible key |

### Migration

On extension startup, if the old `{url, key, model}` schema is detected and no `providers` array exists:
1. Create a single provider entry of type `openai-compatible` named `"My OpenAI Service"` using the existing `url` and `key`
2. Set `activeModel` from the existing `model` value
3. Delete the old keys from storage

Migration is one-way and runs once. No data is lost.

---

## 2. Architecture

### New Files

| File | Purpose |
|------|---------|
| `settings.html` | Entry point for settings tab |
| `extension/src/settings.ts` | Svelte mount for settings page |
| `extension/src/lib/components/Settings.svelte` | Full settings UI |
| `extension/src/lib/apis/providers.ts` | Provider-aware API routing (Anthropic vs OpenAI-compatible) |

### Modified Files

| File | Changes |
|------|---------|
| `manifest.json` | Add `settings.html` entry; add Settings context menu item; remove Open WebUI context menu item; update name/description |
| `background.js` | Add `openSettings` action; add Anthropic-aware routing in fetch/stream handlers; run migration on startup; remove OpenWebUI references |
| `extension/src/lib/components/SpotlightSearch.svelte` | Remove embedded config form; add provider+model switcher; add slash command handling; remove OpenWebUI references |
| `extension/src/lib/apis/index.js` | Update `getSidebarInit` and storage reads to new schema |
| `vite.config.ts` | Add `settings` as a Rollup entry point |

### Vite Build Entries

```
main       → dist/main.js        (spotlight overlay)
sidebar    → dist/sidebar.js     (side panel)
settings   → dist/settings.js    (settings tab)   ← new
```

---

## 3. Settings Page

**Access:** Right-click context menu → "Settings" → opens `chrome-extension://.../settings.html` in a new tab.

**Layout:** Horizontal tab bar across the top. Four tabs:

### Providers tab (default)

- List of configured providers, each showing: name, type badge (Anthropic / OpenAI-compatible), active model
- Active provider has a green dot and "Active" badge
- Each provider has an **Edit** button; inactive providers also have a **Set Active** button
- **Add Provider** button at the bottom of the list

**Add / Edit provider form (inline expansion below the provider list):**

For `anthropic` type:
- Name (text input)
- API Key (password input)
- Model is selected from a fetched list via `/v1/models` after key is entered

For `openai-compatible` type:
- Name (text input)
- Server URL (text input, validated)
- API Key (password input)
- Model is selected from a fetched list after URL + key are entered

**Delete** is available in the edit form, with a confirmation step.

### Appearance tab
- Placeholder for future theme/font options. Shows "Coming soon" for now.

### Shortcuts tab
- Read-only display of current keyboard shortcuts (Ctrl+Shift+K, Ctrl+Shift+L, Ctrl+Shift+Enter). Editing shortcuts is a Chrome-level action — display `chrome://extensions/shortcuts` as copyable text with a note to paste it into the address bar.

### About tab
- Extension name, version (from `manifest.json`), link to repo/support.

---

## 4. Provider + Model Switcher

**Location:** Top of both the spotlight overlay and the sidebar, above the chat input.

**Layout (Option A — two separate pills):**

```
[ ● My Claude ▾ ]  [ claude-sonnet-4-6 ▾ ]          ⚙ Settings
```

- Left pill: provider selector — clicking opens a dropdown listing all configured providers. Selecting one sets it as active and refreshes the model list.
- Right pill: model selector — clicking opens a dropdown of models available for the active provider. Selecting one sets `activeModel`.
- ⚙ Settings: clicking opens the settings tab.

**Behaviour:**
- If no providers are configured, both pills show "No provider" and clicking either opens the settings tab.
- Model list is fetched on provider switch. While fetching, the model pill shows a spinner.
- Active selections persist to `chrome.storage.local` immediately on change — no Save button needed.

---

## 5. Slash Commands

**Trigger:** User types `/` at the start of the input field (or after clearing the field).

**UI:** A compact menu appears above the input, listing available commands. Arrow keys move selection; Enter executes; Escape dismisses and leaves the `/` in the input as literal text.

**Commands:**

| Command | Action |
|---------|--------|
| `/model` | Opens the model dropdown (same as clicking the model pill) |
| `/provider` | Opens the provider dropdown (same as clicking the provider pill) |
| `/settings` | Opens the settings tab |
| `/clear` | Clears the current conversation (with confirmation if messages exist) |
| `/help` | Inserts a help message into the chat listing all commands |

**Filtering:** As the user types beyond `/`, the list filters to matching commands (e.g., `/mo` shows `/model`). If no commands match, the menu disappears and the text is treated as a normal message.

---

## 6. Anthropic API Integration

### Endpoint & Auth

```
POST https://api.anthropic.com/v1/messages
Headers:
  x-api-key: {decryptedKey}
  anthropic-version: 2023-06-01
  content-type: application/json
```

### Request Format

Anthropic does not accept system messages in the `messages` array. System messages are extracted and passed as a top-level `system` field. A `max_tokens` field is required (default: 8096).

```json
{
  "model": "claude-sonnet-4-6",
  "system": "You are a helpful assistant.",
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "max_tokens": 8096,
  "stream": true
}
```

### Streaming Response

Anthropic's SSE stream uses different event types than OpenAI. The `providers.ts` layer normalises them into the internal delta format the UI already consumes:

| Anthropic event | Internal delta |
|-----------------|---------------|
| `content_block_delta` with `delta.type = "text_delta"` | `delta.content = delta.text` |
| `message_stop` | stream end signal |

### Model Fetching

```
GET https://api.anthropic.com/v1/models
Headers:
  x-api-key: {decryptedKey}
  anthropic-version: 2023-06-01
```

Returns a list of available models. Filtered to show only `claude-*` models.

### Routing

`providers.ts` exports a single `sendChatRequest(provider, model, messages, onDelta, onDone, onError)` function. Internally it branches on `provider.type`:
- `anthropic` → Anthropic format
- `openai-compatible` → existing OpenAI format

All background message handlers call this instead of the current direct fetch logic.

---

## 7. Rebrand

- `manifest.json`: name set to `"AI Extension"` (placeholder — replace with final name before shipping)
- Remove OpenWebUI logo assets from `images/`
- Remove "Open in OpenWebUI" context menu item from `background.js`
- Replace with "Settings" context menu item
- Remove any `openwebui` hardcoded strings in class names, IDs, copy, and comments
- `ALLOWED_ACTIONS` in `background.js`: add `openSettings`, remove any OpenWebUI-specific actions

---

## 8. What Is Not Changing

- AES-256-GCM encryption for API keys — unchanged, applied per-provider
- Rate limiting — unchanged
- URL validation / SSRF protection — unchanged, applied to `openai-compatible` URLs
- Streaming via `chrome.runtime.connect()` — unchanged
- Page content extraction for sidebar context — unchanged
- Keyboard shortcuts (Ctrl+Shift+K, Ctrl+Shift+L, Ctrl+Shift+Enter) — unchanged

---

## 9. Out of Scope

- OAuth / third-party login
- Hosted backend or user accounts
- Billing or usage tracking
- Appearance / theme customisation (tab exists but shows "coming soon")
