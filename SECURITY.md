# Security — Grace

## Overview

Grace is a Chrome extension (Manifest V3) that calls user-configured AI backends. This document describes the security model, implemented protections, and known considerations.

---

## API Key Storage

**Risk**: API keys stored in browser storage are visible to anyone with DevTools access to the extension.

**Mitigation**: Keys are encrypted with **AES-256-GCM** before being written to `chrome.storage.local`.

- Encryption key derived from the extension's installation ID via **PBKDF2** (SHA-256, 100,000 iterations)
- Each installation has a unique derived key — encrypted blobs cannot be ported between installations
- A random 12-byte IV is generated per encryption operation
- If a stored key appears unencrypted (migration path from older versions), it is used as-is and re-encrypted on next save

Keys are decrypted only in the service worker (`background.js`) and are never sent to any surface other than the configured backend URL.

---

## SSRF Protection

All user-supplied URLs are validated in the service worker before any outbound request is made.

- Only `http://` and `https://` schemes are accepted
- `javascript:`, `data:`, and other schemes are rejected
- URL validation runs in `isValidUrl()` and `getValidatedFetchUrl()` in `background.js`

Tests: `background-helpers.test.js` — covers rejection of non-http(s), `javascript:`, and `data:` URLs.

---

## Rate Limiting

Implemented as a sliding-window counter in `chrome.storage.local`:

| Endpoint type | Limit |
|---------------|-------|
| Chat completions | 10 requests / minute |
| Model fetching | 5 requests / minute |
| General API calls | 20 requests / minute |

Users receive a clear error message with a countdown when a limit is hit.

---

## Message Action Validation

Content scripts and extension pages communicate with the service worker via `chrome.runtime.sendMessage`. The service worker rejects any message whose `action` field is not in the `ALLOWED_ACTIONS` whitelist in `background.js`. Unknown or malformed actions return an error response — they are never executed.

---

## XSS

- Svelte's template engine escapes all interpolated values by default — user-provided text is never rendered as raw HTML
- Markdown is rendered via the `marked` library to sanitized HTML; the output is displayed with `{@html}` only in the markdown content region, which is scoped and isolated
- No `eval()` or `Function()` constructor usage anywhere in the codebase

---

## Content Security Policy

Defined in `manifest.json`:

```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'self';"
}
```

No inline scripts, no `unsafe-eval`, no external script sources.

---

## CSS Isolation

Extension UI is mounted inside `#extension-app` with scoped `!important` overrides to prevent host-page styles from leaking in. This is a UX concern, but it also prevents host pages from visually spoofing extension UI elements.

---

## Permissions Rationale

| Permission | Justification |
|------------|---------------|
| `storage` | Persist settings and encrypted API keys |
| `scripting` | Inject content script into page |
| `contextMenus` | Register right-click menu items |
| `sidePanel` | Open Chrome side panel |
| `commands` | Register keyboard shortcuts |
| `host_permissions: <all_urls>` | Extension must run on any page the user visits |

The `<all_urls>` permission is broad by necessity — the spotlight search and direct-to-input features must work on any site.

---

## Known Considerations

**Encrypted keys visible in DevTools storage** — the encrypted blob is visible under Application → Storage → Extension Storage. It cannot be decrypted without the installation-specific derived key, which is not stored directly.

**Key loss on reinstall** — if the extension is uninstalled and reinstalled, the derived key changes and previously encrypted API keys cannot be recovered. Users must re-enter their keys. This is intentional.

**`<all_urls>` permission** — content scripts run on all pages. The content script only creates a DOM mount point and loads the Svelte bundle; it does not read or transmit page content except when the user explicitly invokes a summarize/explain/sidebar feature.

**Network traffic** — all API calls are routed through the service worker, not the content script. The content script never makes direct network requests.

---

## Automated Tests

Run: `cd extension && npm test`

| Test file | Coverage |
|-----------|----------|
| `background-helpers.test.js` | `isValidUrl`, `getValidatedFetchUrl`, rate-limit keys |
| `apis/index.test.js` | `getModels`, `generateOpenAIChatCompletion`, Chrome API error paths |
| `utils/index.test.js` | Stream parsing, markdown rendering and escaping |
| `lib/appearance.test.ts` | Appearance logic (no security impact, included for completeness) |

Dependency vulnerabilities: `npm audit --audit-level=high` runs in CI on every push.
