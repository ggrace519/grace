# Security Review - Open WebUI Extension

## Security Analysis Date
2024-12-19

## Overview
This document outlines security vulnerabilities found and fixes applied to the Open WebUI Chrome Extension.

## Vulnerabilities Found & Fixed

### 1. ✅ URL Validation (SSRF Protection)
**Issue**: User-provided URLs were not validated, allowing potential SSRF attacks.
**Risk**: High - Could allow attackers to make requests to internal services.
**Fix**: Added URL validation to ensure only HTTP/HTTPS URLs are accepted and prevent localhost/internal IP access if needed.

### 2. ✅ API Key Storage & Encryption
**Issue**: API keys stored in localStorage as fallback (less secure than chrome.storage).
**Risk**: Medium - localStorage is accessible to all scripts on the page.
**Fix**: 
- Removed localStorage fallback, using only chrome.storage.local which is more secure
- **Added AES-256-GCM encryption** for API keys using Web Crypto API
- Encryption key derived from extension ID using PBKDF2 (100,000 iterations)
- Each extension installation has a unique encryption key
- Backward compatible with existing unencrypted keys

### 3. ✅ Input Sanitization
**Issue**: User inputs sent directly to API without validation.
**Risk**: Medium - Could allow injection attacks.
**Fix**: Added input validation and sanitization before sending to API.

### 4. ✅ Message Action Validation
**Issue**: Background script accepts any action without validation.
**Risk**: Medium - Could allow unauthorized actions.
**Fix**: Added strict action validation in background script.

### 5. ✅ XSS Protection
**Status**: ✅ Safe - Using Svelte's built-in XSS protection (text interpolation, not innerHTML).

### 6. ✅ Content Security Policy
**Status**: ✅ Safe - Extension uses manifest v3 with proper CSP.

### 7. ✅ Script Injection
**Status**: ✅ Safe - Scripts are injected via chrome.scripting API with proper validation.

## Security Best Practices Implemented

1. ✅ API keys encrypted with AES-256-GCM before storage
2. ✅ Encryption key derived from extension ID (unique per installation)
3. ✅ API keys stored in chrome.storage.local (OS-level encryption + application-level encryption)
4. ✅ No eval() or dangerous code execution
5. ✅ No innerHTML usage (Svelte handles escaping)
6. ✅ URL validation before API calls
7. ✅ Input validation and sanitization
8. ✅ Message action validation
9. ✅ Proper error handling without exposing sensitive data
10. ✅ Rate limiting to prevent API abuse
11. ✅ CSP (Content Security Policy) validation and configuration
12. ✅ User-friendly error messages for rate limit violations
13. ✅ Backward compatible with unencrypted keys (automatic migration)

## API Key Encryption Details

The extension now encrypts API keys by default using industry-standard encryption:

- **Algorithm**: AES-256-GCM (Galois/Counter Mode)
- **Key Derivation**: PBKDF2 with SHA-256, 100,000 iterations
- **Key Source**: Extension ID + salt (unique per installation)
- **IV**: Random 12-byte IV generated for each encryption
- **Storage**: Encrypted keys stored in chrome.storage.local (double encryption: OS-level + application-level)

**Security Benefits**:
- API keys are encrypted even if chrome.storage.local is accessed
- Each extension installation has a unique encryption key
- Keys cannot be decrypted without the extension ID
- Backward compatible with existing unencrypted keys

## Remaining Considerations

1. **API Key Exposure**: Encrypted API keys are visible in Chrome DevTools storage, but they are encrypted and cannot be decrypted without the extension ID. This is expected behavior for browser extensions but users should be aware.
2. **Network Traffic**: All API calls go through the background script, which is good for security.
3. **Permissions**: Extension requires `<all_urls>` permission to work on any website. This is necessary for functionality but users should trust the extension.
4. **Encryption Key**: The encryption key is derived from the extension ID. If the extension is uninstalled and reinstalled, the encryption key will change and existing encrypted keys cannot be decrypted (this is by design for security).

## Recommendations

1. ✅ **Rate Limiting**: Implemented - Added rate limiting for API calls
   - Chat completions: 10 requests per minute
   - Model fetching: 5 requests per minute
   - General API calls: 20 requests per minute
2. ✅ **API Key Encryption**: Implemented - API keys are now encrypted by default using AES-256-GCM
3. Add user notification when API key is exposed in console
4. ✅ **CSP Validation**: Implemented - Added CSP validation and manifest CSP configuration

## Testing

### Automated unit tests (Vitest)

Security-critical behavior is covered by unit tests in `extension/`:

- **URL validation (SSRF)**: `background-helpers.test.js` — `isValidUrl`, `getValidatedFetchUrl` reject non-http(s), `javascript:`, `data:` URLs
- **Rate limiting**: `background-helpers.test.js` — keys and config for chat/models/general
- **API layer**: `apis/index.test.js` — getModels and chat completion error handling, Chrome API availability
- **Utils**: `utils/index.test.js` — stream splitting, markdown rendering and escaping

Run: `cd extension && npm test` (or `npm run test:coverage` for coverage).

### Manual verification

All security fixes have been tested and verified:

- ✅ URL validation prevents SSRF
- ✅ Input sanitization prevents injection
- ✅ Message validation prevents unauthorized actions
- ✅ No XSS vulnerabilities found
- ✅ Proper error handling
- ✅ Rate limiting prevents API abuse
- ✅ CSP validation ensures secure content loading
- ✅ API key encryption protects sensitive credentials

### OWASP ZAP and DAST

**OWASP ZAP** (and similar DAST tools) scan a *running web application* by crawling and probing it. This project is a **Chrome extension** that runs in the browser and calls the user’s Open WebUI backend; the extension does not serve its own web app. So:

- **For this repo**: Unit tests and dependency checks (`npm audit`) are the primary automated security testing. Optionally you can point ZAP at the extension’s side panel or popup URL when loaded in Chrome; that is niche and not required for typical development.
- **For the Open WebUI backend**: If you operate or deploy Open WebUI itself, running ZAP (or another DAST tool) against that backend is recommended; see the [Open WebUI](https://github.com/open-webui/open-webui) project for that scope.

## Rate Limiting

The extension implements sensible rate limits to prevent abuse while maintaining functionality:

- **Chat Completions**: 10 requests per minute (allows rapid follow-up questions)
- **Model Fetching**: 5 requests per minute (less frequent operation)
- **General API Calls**: 20 requests per minute (fallback limit)

Rate limits use a sliding window approach stored securely in chrome.storage.local. Users will receive clear error messages if limits are exceeded, with wait times displayed in seconds.

## Content Security Policy

- ✅ CSP configured in manifest.json for extension pages
- ✅ CSP headers validated from API responses
- ✅ No inline scripts or unsafe eval() usage
- ✅ All resources loaded from trusted sources

