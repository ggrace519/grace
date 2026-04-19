/* global chrome */
// ============================================================================
// Open WebUI Extension - Background Service Worker
// ============================================================================
// Handles API calls, context menus, keyboard shortcuts, and message passing.
// See SECURITY.md for security details.
// ============================================================================

// ============================================================================
// ENHANCEMENT: User-Friendly Error Messages
// ============================================================================
// Provides helper function to generate user-friendly error messages based on
// error types, for consistent error reporting to the UI.
// ============================================================================

/**
 * User-friendly error messages based on error type
 */
function getUserFriendlyErrorMessage(error) {
  const errorMessage = error?.message || String(error);

  // Check for network errors
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return "No internet connection. Please check your connection and try again.";
  }

  // Extension context invalidated
  if (errorMessage.includes("Extension context invalidated") ||
      errorMessage.includes("chrome.runtime")) {
    return "Extension context invalidated. Please reload the extension.";
  }

  // Rate limit errors
  if (errorMessage.includes("Rate limit") || errorMessage.includes("429")) {
    return "Rate limit exceeded. Please wait a moment and try again.";
  }

  // Invalid URL errors
  if (errorMessage.includes("Invalid URL") || errorMessage.includes("SSRF")) {
    return "Invalid API URL. Please check your configuration.";
  }

  // Invalid API key
  if (errorMessage.includes("Invalid API key") || errorMessage.includes("401")) {
    return "Invalid API key. Please check your configuration.";
  }

  // Connection errors
  if (errorMessage.includes("Failed to fetch") ||
      errorMessage.includes("NetworkError") ||
      errorMessage.includes("ECONNREFUSED")) {
    return "Could not connect to Open WebUI. Please check the URL and ensure the server is running.";
  }

  // Timeout errors
  if (errorMessage.includes("timeout") || errorMessage.includes("timed out")) {
    return "Request timed out. Please try again.";
  }

  // Generic server errors
  if (errorMessage.includes("500") || errorMessage.includes("Internal Server Error")) {
    return "Server error. Please try again later.";
  }

  // Content extraction errors
  if (errorMessage.includes("Could not extract") || errorMessage.includes("No content")) {
    return "Could not extract content from this page. The page might be protected or have minimal text.";
  }

  // Return the original error if no match
  return errorMessage;
}

// ============================================================================
// ENHANCEMENT: SSRF Protection - URL Validation
// ============================================================================
// Validates URLs to prevent Server-Side Request Forgery (SSRF) attacks.
// Only allows http: and https: protocols, blocking javascript:, data:, and
// other potentially dangerous schemes.
// ============================================================================

// SSRF blocklist: hostnames/IPs that must never be requested (cloud metadata, etc.)
const SSRF_BLOCKED_HOSTS = [
  '169.254.169.254',           // AWS/GCP/Azure metadata
  'metadata.google.internal',
  'metadata.google.com',
  'metadata',
];

function isBlockedHost(host) {
  if (!host || typeof host !== 'string') return true;
  const normalized = host.toLowerCase().trim();
  if (SSRF_BLOCKED_HOSTS.some((blocked) => normalized === blocked.toLowerCase())) return true;
  if (normalized.startsWith('169.254.')) return true; // link-local metadata range
  return false;
}

// Returns a safe URL string for fetch (reconstructed from parsed URL) or null. Prevents SSRF;
// the value passed to fetch is never raw user input.
function getValidatedFetchUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') return null;
  try {
    const url = new URL(urlString);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (isBlockedHost(url.hostname)) return null;
    return url.origin + url.pathname + url.search;
  } catch (e) {
    return null;
  }
}

// Fetches only after URL validation. Uses reconstructed URL so no user-controlled string reaches fetch.
// SECURITY: Only the validated, reconstructed URL is passed to fetch; raw user input is never used.
function safeFetch(apiUrl, options) {
  const safeUrl = getValidatedFetchUrl(apiUrl);
  if (safeUrl === null) {
    return Promise.reject(new Error('Invalid API URL'));
  }
  return fetch(safeUrl, options);
}

// URL validation to prevent SSRF attacks
function isValidUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    return false;
  }

  try {
    const url = new URL(urlString);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return false;
    }
    if (url.protocol === 'javascript:' || url.protocol === 'data:') {
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

// ============================================================================
// ENHANCEMENT: Message Action Validation
// ============================================================================
// Whitelist of allowed message actions to prevent unauthorized actions from
// content scripts or malicious code injection.
// ============================================================================
const ALLOWED_ACTIONS = ['ping', 'getSelection', 'writeText', 'fetchModels', 'toggleSearch', 'encryptApiKey', 'decryptApiKey', 'createChat', 'extractPageContent', 'getActiveTabPageContent', 'getSidebarInit', 'summarizePage', 'explainText', 'openSidePanel', 'openSearchFromPopup', 'openSidebarFromPopup', 'openSettings', 'saveProvider', 'deleteProvider', 'setActiveProvider', 'setActiveModel', 'decryptProviderKey', 'saveAppearance'];

// ============================================================================
// ENHANCEMENT: Rate Limiting
// ============================================================================
// Implements sliding window rate limiting to prevent abuse and API quota exhaustion.
// Uses chrome.storage.local to persist request history across extension reloads.
// ============================================================================

// Rate Limiting Configuration (fixed keys only; no dynamic access)
const RATE_LIMIT_CHAT = { max: 10, window: 60000 };
const RATE_LIMIT_FETCH_MODELS = { max: 5, window: 60000 };
const RATE_LIMIT_GENERAL = { max: 20, window: 60000 };

function getRateLimitConfig(actionType) {
  if (actionType === 'chatCompletion') return RATE_LIMIT_CHAT;
  if (actionType === 'fetchModels') return RATE_LIMIT_FETCH_MODELS;
  return RATE_LIMIT_GENERAL;
}

function getStoredRequestsForAction(raw, actionType) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  if (actionType === 'chatCompletion' && Array.isArray(raw.chatCompletion)) return raw.chatCompletion;
  if (actionType === 'fetchModels' && Array.isArray(raw.fetchModels)) return raw.fetchModels;
  if (actionType === 'general' && Array.isArray(raw.general)) return raw.general;
  return [];
}

function buildRateLimitStorage(raw, actionType, updatedRequests) {
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    if (Array.isArray(raw.chatCompletion)) out.chatCompletion = raw.chatCompletion;
    if (Array.isArray(raw.fetchModels)) out.fetchModels = raw.fetchModels;
    if (Array.isArray(raw.general)) out.general = raw.general;
  }
  if (actionType === 'chatCompletion') out.chatCompletion = updatedRequests;
  else if (actionType === 'fetchModels') out.fetchModels = updatedRequests;
  else out.general = updatedRequests;
  return out;
}

function getRateLimitKey(actionType) {
  if (typeof actionType !== 'string') return 'general';
  if (actionType === 'chatCompletion' || actionType === 'fetchModels') return actionType;
  return 'general';
}

// Rate Limiting: Check if request should be allowed (no dynamic object key access)
async function checkRateLimit(actionType) {
  const key = getRateLimitKey(actionType);
  const limit = getRateLimitConfig(key);
  const now = Date.now();

  try {
    const stored = await chrome.storage.local.get(['rateLimit']);
    const raw = stored.rateLimit;
    let requests = getStoredRequestsForAction(raw, key);

    requests = requests.filter(timestamp => now - timestamp < limit.window);

    if (requests.length >= limit.max) {
      const oldestRequest = requests[0];
      const waitTime = limit.window - (now - oldestRequest);
      return {
        allowed: false,
        waitTime: Math.ceil(waitTime / 1000)
      };
    }

    requests = requests.concat(now);
    const rateLimitData = buildRateLimitStorage(raw, key, requests);
    await chrome.storage.local.set({ rateLimit: rateLimitData });

    return { allowed: true };
  } catch (error) {
    console.error("Extension: Rate limit check failed:", error);
    return { allowed: true };
  }
}

// ============================================================================
// ENHANCEMENT: Content Security Policy (CSP) Validation
// ============================================================================
// Logs CSP headers from API responses for security monitoring. This helps
// identify potential security issues with API responses.
// ============================================================================
function validateCSPHeaders(response) {
  const cspHeader = response.headers.get('content-security-policy');
  if (cspHeader) {
    // Log CSP header for debugging (don't block, just log)
    console.log("Extension: CSP header detected:", cspHeader);
  }
  return true; // Don't block based on CSP headers, just validate
}

// ============================================================================
// ENHANCEMENT: API Key Encryption
// ============================================================================
// This fork adds AES-256-GCM encryption for API keys stored in chrome.storage.local.
// Encryption uses the extension ID as part of the key derivation, making each
// installation unique. This prevents API keys from being readable in plain text
// if storage is accessed.
// ============================================================================

// API Key Encryption using Web Crypto API
async function getEncryptionKey() {
  try {
    const extensionId = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id)
      ? chrome.runtime.id
      : '';

    const encoder = typeof TextEncoder !== 'undefined'
      ? new TextEncoder()
      : null;
    if (!encoder) {
      throw new Error('TextEncoder is not available in this environment');
    }
    const password = encoder.encode(extensionId + 'open-webui-extension-salt');
    const salt = encoder.encode('open-webui-api-key-encryption-salt-v1');

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      password,
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );

    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      {
        name: 'AES-GCM',
        length: 256
      },
      false,
      ['encrypt', 'decrypt']
    );

    return key;
  } catch (error) {
    console.error("Extension: Failed to get encryption key:", error);
    throw error;
  }
}

async function encryptApiKey(apiKey) {
  try {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error("Invalid API key for encryption");
    }

    const key = await getEncryptionKey();
    const encoder = new TextEncoder();
    const data = encoder.encode(apiKey);

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      data
    );

    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);

    return btoa(String.fromCharCode(...combined));
  } catch (error) {
    console.error("Extension: Encryption failed:", error);
    throw error;
  }
}

async function decryptApiKey(encryptedApiKey) {
  try {
    if (!encryptedApiKey || typeof encryptedApiKey !== 'string') {
      throw new Error("Invalid encrypted API key");
    }

    // Check if it's already decrypted (backward compatibility)
    if (encryptedApiKey.length < 20 || !/^[A-Za-z0-9+/=]+$/.test(encryptedApiKey)) {
      return encryptedApiKey;
    }

    const key = await getEncryptionKey();
    const combined = Uint8Array.from(atob(encryptedApiKey), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);

    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        encrypted
      );
      return new TextDecoder().decode(decrypted);
    } catch (decryptError) {
      console.log("Extension: Decryption failed, assuming unencrypted key");
      return encryptedApiKey;
    }
  } catch (error) {
    console.error("Extension: Decryption failed:", error);
    return encryptedApiKey;
  }
}

// ============================================================================
// ENHANCEMENT: Page Content Extraction
// ============================================================================
// Extracts main article content from web pages, filtering out navigation,
// ads, footers, and other non-content elements. Uses multiple strategies
// to find the main content.
// ============================================================================

function extractPageContentScript() {
  function isVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           style.opacity !== '0' &&
           element.offsetWidth > 0 &&
           element.offsetHeight > 0;
  }

  function shouldExclude(element) {
    if (!element) return true;
    const tagName = element.tagName.toLowerCase();
    const id = (element.id || '').toLowerCase();
    const className = (element.className || '').toLowerCase();

    if (tagName === 'nav' || tagName === 'header' || tagName === 'footer' ||
        tagName === 'aside' || tagName === 'script' || tagName === 'style' ||
        tagName === 'noscript' || tagName === 'iframe') {
      return true;
    }

    if (id.includes('ad') || className.includes('ad') ||
        className.includes('advertisement') || className.includes('sidebar') ||
        className.includes('cookie') || className.includes('popup') ||
        className.includes('modal') || className.includes('overlay')) {
      return true;
    }

    const role = element.getAttribute('role');
    if (role === 'navigation' || role === 'banner' || role === 'complementary') {
      return true;
    }

    return false;
  }

  // Strategy 1: Look for semantic HTML5 elements
  let mainContent = document.querySelector('main, article, [role="main"]');
  if (mainContent && isVisible(mainContent)) {
    const excluded = mainContent.querySelectorAll('nav, header, footer, aside, .ad, .advertisement, [id*="ad"], [class*="ad"]');
    excluded.forEach(el => el.remove());
    const text = mainContent.innerText || mainContent.textContent || '';
    if (text.trim().length > 100) {
      return text.trim();
    }
  }

  // Strategy 2: Look for common content class names
  const contentSelectors = [
    '.content', '.post', '.entry', '.article', '.article-content',
    '.main-content', '.post-content', '.entry-content', '.article-body',
    '#content', '#main', '#article', '#post'
  ];

  for (const selector of contentSelectors) {
    const element = document.querySelector(selector);
    if (element && isVisible(element) && !shouldExclude(element)) {
      const clone = element.cloneNode(true);
      const excluded = clone.querySelectorAll('nav, header, footer, aside, .ad, .advertisement, [id*="ad"], [class*="ad"]');
      excluded.forEach(el => el.remove());
      const text = (clone.innerText || clone.textContent || '').trim();
      if (text.length > 100) {
        return text;
      }
    }
  }

  // Strategy 3: Extract all visible text but filter out excluded elements
  const body = document.body.cloneNode(true);
  const excluded = body.querySelectorAll('nav, header, footer, aside, script, style, .ad, .advertisement, [id*="ad"], [class*="ad"], [role="navigation"], [role="banner"]');
  excluded.forEach(el => el.remove());

  const allElements = body.querySelectorAll('*');
  allElements.forEach(el => {
    if (!isVisible(el)) {
      el.remove();
    }
  });

  const text = (body.innerText || body.textContent || '').trim();
  const cleanedText = text.replace(/\s+/g, ' ').substring(0, 50000);

  if (cleanedText.length >= 50) {
    return cleanedText;
  }

  // Strategy 4: Last resort - try common product/content areas
  const productSelectors = [
    '[itemprop="description"]',
    '.product-description',
    '.product-details',
    '.product-info',
    '.product-content',
    '[data-product]',
    '.description',
    '.details',
    '.specifications',
    '.features'
  ];

  for (const selector of productSelectors) {
    const elements = document.querySelectorAll(selector);
    for (const element of elements) {
      if (element && isVisible(element)) {
        const elementText = (element.innerText || element.textContent || '').trim();
        if (elementText.length >= 50) {
          return elementText.replace(/\s+/g, ' ').substring(0, 50000);
        }
      }
    }
  }

  return cleanedText || '';
}

async function handleExtractPageContent(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: extractPageContentScript
    });

    if (results && results[0] && results[0].result) {
      const extractedText = results[0].result;
      if (extractedText && extractedText.trim().length >= 50) {
        return { data: extractedText };
      } else {
        return { error: "Could not extract enough content from this page. The page might be heavily JavaScript-rendered or have minimal text content." };
      }
    } else {
      return { error: "No content extracted. The page might be protected or inaccessible." };
    }
  } catch (error) {
    console.error("Extension: Error extracting page content:", error);
    return { error: error.message || "Failed to extract content" };
  }
}

// Key for storing which tab's context the side panel should use (session only)
const SIDE_PANEL_CONTEXT_TAB_KEY = "sidePanelContextTabId";
// In-memory so getActiveTabPageContent can read it without awaiting storage (avoids message port timeout)
let sidePanelContextTabIdMemory = null;

/** Returns the tab id the side panel should use for context (memory, session, or current tab). */
async function getContextTabId() {
  const tryUseTabId = async (id) => {
    if (id == null) return null;
    try {
      const tab = await chrome.tabs.get(id);
      if (tab && tab.id && tab.url) {
        const u = tab.url;
        if (!u.startsWith("chrome://") && !u.startsWith("chrome-extension://") && !u.startsWith("edge://") && !u.startsWith("about:")) {
          return tab.id;
        }
      }
    } catch (_) {}
    return null;
  };
  let tabId = await tryUseTabId(sidePanelContextTabIdMemory);
  if (tabId != null) return tabId;
  const stored = await chrome.storage.session.get(SIDE_PANEL_CONTEXT_TAB_KEY).catch(() => ({}));
  tabId = await tryUseTabId(stored[SIDE_PANEL_CONTEXT_TAB_KEY]);
  if (tabId != null) return tabId;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs && tabs[0] && tabs[0].id) return tabs[0].id;
  const fallback = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return (fallback && fallback[0] && fallback[0].id) ? fallback[0].id : null;
}

/** Get page content for a given tab (content script first, then executeScript). */
async function getPageContentForTabId(tabId) {
  if (!tabId) return { error: "No tab" };
  try {
    const contentScriptResponse = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { action: "getPageContent" }, (response) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(response);
      });
    });
    if (contentScriptResponse && (contentScriptResponse.data !== undefined || contentScriptResponse.error)) {
      const data = contentScriptResponse.data ?? "";
      const trimmed = typeof data === "string" ? data.trim() : "";
      if (trimmed.length >= 50) return { data: contentScriptResponse.data };
      if (contentScriptResponse.error) return { error: contentScriptResponse.error };
    }
  } catch (_) {}
  return await handleExtractPageContent(tabId);
}

function runToggleSearchForTab(tab, focusTab = false) {
  if (!tab || !tab.id) return;
  const url = tab.url || "";
  if (url.startsWith("chrome://") ||
      url.startsWith("chrome-extension://") ||
      url.startsWith("chrome-search://") ||
      url.startsWith("edge://") ||
      url.startsWith("about:")) {
    return;
  }
  const tabId = tab.id;
  const doSend = () => {
    chrome.tabs.sendMessage(tabId, { action: "toggleSearch" }).catch(() => {
      chrome.scripting.executeScript({
        target: { tabId: tabId, allFrames: false },
        func: () => {
          window.dispatchEvent(new CustomEvent("open-webui-toggle-search", { bubbles: true }));
          if (window.openWebUIToggleSearch && typeof window.openWebUIToggleSearch === "function") {
            try {
              window.openWebUIToggleSearch();
            } catch (e) {}
          }
        }
      }).catch(() => {});
    });
  };
  if (focusTab && tab.windowId) {
    chrome.tabs.update(tabId, { active: true }).then(() => {
      return chrome.windows.update(tab.windowId, { focused: true });
    }).then(doSend).catch(doSend);
  } else {
    doSend();
  }
}

// ============================================================================
// ENHANCEMENT: Keyboard Shortcut Handling via Commands API
// ============================================================================
chrome.commands.onCommand.addListener(function (command) {
  console.log("Command received:", command);
  if (command === "open-search") {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) {
        const url = tabs[0].url || "";
        if (url.startsWith("chrome://") ||
            url.startsWith("chrome-extension://") ||
            url.startsWith("chrome-search://") ||
            url.startsWith("edge://") ||
            url.startsWith("about:")) {
          console.log("Extension cannot access this page:", url);
          return;
        }

        console.log("Sending toggleSearch message to tab:", tabs[0].id);
        chrome.tabs.sendMessage(tabs[0].id, { action: "toggleSearch" }).then(() => {
          console.log("Message sent successfully");
        }).catch((error) => {
          console.log("Message failed, trying script injection:", error);
          chrome.scripting.executeScript({
            target: { tabId: tabs[0].id, allFrames: false },
            func: () => {
              window.dispatchEvent(new CustomEvent("open-webui-toggle-search", { bubbles: true }));
              if (window.openWebUIToggleSearch && typeof window.openWebUIToggleSearch === 'function') {
                try {
                  window.openWebUIToggleSearch();
                } catch (e) {
                  console.error("Error calling toggle function:", e);
                }
              }
            }
          }).catch((err) => {
            if (err.message && err.message.includes("Cannot access contents")) {
              console.log("Page cannot be accessed by extension (restricted page)");
            } else {
              console.error("Error injecting script:", err);
            }
          });
        });
      }
    });
  } else if (command === "open-sidebar") {
    // Open immediately (user gesture); set context tab after.
    chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = (tabs && tabs[0]) ? tabs[0] : null;
      const tabId = tab ? tab.id : null;
      if (tabId != null) {
        sidePanelContextTabIdMemory = tabId;
        chrome.storage.session.set({ [SIDE_PANEL_CONTEXT_TAB_KEY]: tabId }).catch(() => {});
      } else {
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, (ft) => {
          const id = (ft && ft[0]) ? ft[0].id : null;
          if (id != null) {
            sidePanelContextTabIdMemory = id;
            chrome.storage.session.set({ [SIDE_PANEL_CONTEXT_TAB_KEY]: id }).catch(() => {});
          }
        });
      }
    });
  }
});

// ============================================================================
// ENHANCEMENT: Context Menu Registration
// ============================================================================
let isRegisteringMenus = false;
function registerContextMenus() {
  if (isRegisteringMenus) {
    console.log("Extension: Context menu registration already in progress, skipping...");
    return;
  }

  isRegisteringMenus = true;

  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime.lastError) {
      // Silently ignore - this is expected on first install
    }

    setTimeout(() => {
      chrome.contextMenus.create({
        id: 'ai-extension',
        title: 'AI Extension',
        contexts: ['all']
      }, () => {
        if (chrome.runtime.lastError) {
          console.error("Extension: Error creating AI Extension context menu:", chrome.runtime.lastError.message);
          isRegisteringMenus = false;
          return;
        }

        console.log("Extension: AI Extension context menu created successfully");

        setTimeout(() => {
          chrome.contextMenus.create({
            id: 'summarize-page',
            parentId: 'ai-extension',
            title: 'Summarize Page',
            contexts: ['all']
          }, () => {
            if (chrome.runtime.lastError) {
              console.error("Extension: Error creating summarize context menu:", chrome.runtime.lastError.message);
            } else {
              console.log("Extension: Summarize context menu created successfully");
            }
          });

          chrome.contextMenus.create({
            id: 'explain-text',
            parentId: 'ai-extension',
            title: 'Explain This',
            contexts: ['selection']
          }, () => {
            if (chrome.runtime.lastError) {
              console.error("Extension: Error creating explain text context menu:", chrome.runtime.lastError.message);
            } else {
              console.log("Extension: Explain text context menu created successfully");
            }
          });

          chrome.contextMenus.create({
            id: 'open-search',
            parentId: 'ai-extension',
            title: 'Open search',
            contexts: ['all']
          }, () => {
            if (chrome.runtime.lastError) {
              console.error("Extension: Error creating open search context menu:", chrome.runtime.lastError.message);
            } else {
              console.log("Extension: Open search context menu created successfully");
            }
          });

          chrome.contextMenus.create({
            id: 'open-sidebar',
            parentId: 'ai-extension',
            title: 'Open sidebar',
            contexts: ['all']
          }, () => {
            if (chrome.runtime.lastError) {
              console.error("Extension: Error creating open sidebar context menu:", chrome.runtime.lastError.message);
            } else {
              console.log("Extension: Open sidebar context menu created successfully");
            }
          });

          chrome.contextMenus.create({
            id: 'open-settings',
            parentId: 'ai-extension',
            title: 'Settings',
            contexts: ['all']
          }, () => {
            if (chrome.runtime.lastError) {
              console.error("Extension: Error creating settings context menu:", chrome.runtime.lastError.message);
            } else {
              console.log("Extension: Settings context menu created successfully");
            }
          });
        }, 50);
      });
    }, 100);

    setTimeout(() => {
      isRegisteringMenus = false;
    }, 500);
  });
}

// Register on install/update
chrome.runtime.onInstalled.addListener((details) => {
  console.log("Extension: onInstalled event:", details.reason);
  registerContextMenus();

  // Migrate old {url, key, model} schema to multi-provider schema
  chrome.storage.local.get(null, (allData) => {
    if (Array.isArray(allData.providers)) return; // already migrated
    if (!allData.url && !allData.key) return;      // nothing to migrate

    const id = crypto.randomUUID();
    const newSchema = {
      providers: [{
        id,
        name: 'My OpenAI Service',
        type: 'openai-compatible',
        encryptedKey: allData.key ?? '',
        url: allData.url || null,
      }],
      activeProviderId: id,
      activeModel: allData.model ?? '',
    };
    chrome.storage.local.set(newSchema, () => {
      chrome.storage.local.remove(['url', 'key', 'model']);
    });
  });
});

// Register on startup
chrome.runtime.onStartup.addListener(() => {
  console.log("Extension: Chrome started, ensuring context menus exist");
  registerContextMenus();

  chrome.storage.local.get(null, (allData) => {
    if (Array.isArray(allData.providers)) return;
    if (!allData.url && !allData.key) return;
    const id = crypto.randomUUID();
    const newSchema = {
      providers: [{
        id,
        name: 'My OpenAI Service',
        type: 'openai-compatible',
        encryptedKey: allData.key ?? '',
        url: allData.url || null,
      }],
      activeProviderId: id,
      activeModel: allData.model ?? '',
    };
    chrome.storage.local.set(newSchema, () => {
      chrome.storage.local.remove(['url', 'key', 'model']);
    });
  });
});

// ============================================================================
// ENHANCEMENT: Extension Icon Click Handler (only when no popup)
// ============================================================================
chrome.action.onClicked.addListener((tab) => {
  try {
    // Must open synchronously in this handler (user gesture); storage can run after.
    chrome.sidePanel.open({ tabId: tab.id });
    if (tab && tab.id != null) {
      sidePanelContextTabIdMemory = tab.id;
      chrome.storage.session.set({ [SIDE_PANEL_CONTEXT_TAB_KEY]: tab.id }).catch(() => {});
    }
  } catch (error) {
    console.error("Error opening side panel:", error);
  }
});

// Register immediately when service worker loads
registerContextMenus();

// ============================================================================
// ENHANCEMENT: Context Menu Click Handler
// ============================================================================
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'summarize-page') {
    const url = tab.url || "";
    if (url.startsWith("chrome://") ||
        url.startsWith("chrome-extension://") ||
        url.startsWith("chrome-search://") ||
        url.startsWith("edge://") ||
        url.startsWith("about:")) {
      console.log("Extension cannot access this page:", url);
      return;
    }

    try {
      const extractResult = await handleExtractPageContent(tab.id);

      if (extractResult.error) {
        console.error("Extension: Failed to extract content:", extractResult.error);
        chrome.tabs.sendMessage(tab.id, {
          action: "summarizePage",
          error: getUserFriendlyErrorMessage(extractResult.error)
        }).catch(() => {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              console.error("Extension: Failed to extract page content");
            }
          });
        });
        return;
      }

      chrome.tabs.sendMessage(tab.id, {
        action: "summarizePage",
        content: extractResult.data
      }).catch((error) => {
        console.log("Message failed, trying script injection:", error);
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (content) => {
            window.dispatchEvent(new CustomEvent("open-webui-summarize-page", {
              bubbles: true,
              detail: { content: content }
            }));
          },
          args: [extractResult.data]
        }).catch((err) => {
          console.error("Extension: Error injecting summarize script:", err);
        });
      });
    } catch (error) {
      const friendlyError = getUserFriendlyErrorMessage(error);
      console.error("Extension: Error in context menu handler:", friendlyError);
    }
  } else if (info.menuItemId === 'explain-text') {
    const url = tab.url || "";
    if (url.startsWith("chrome://") ||
        url.startsWith("chrome-extension://") ||
        url.startsWith("chrome-search://") ||
        url.startsWith("edge://") ||
        url.startsWith("about:")) {
      console.log("Extension cannot access this page:", url);
      return;
    }

    const selectedText = info.selectionText || "";

    if (!selectedText || selectedText.trim().length === 0) {
      console.warn("Extension: No text selected for explanation");
      chrome.tabs.sendMessage(tab.id, {
        action: "explainText",
        error: "No text was selected. Please select some text and try again."
      }).catch(() => {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            console.error("Extension: No text selected for explanation");
          }
        });
      });
      return;
    }

    chrome.tabs.sendMessage(tab.id, {
      action: "explainText",
      text: selectedText.trim()
    }).catch((error) => {
      console.log("Message failed, trying script injection:", error);
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (text) => {
          window.dispatchEvent(new CustomEvent("open-webui-explain-text", {
            bubbles: true,
            detail: { text: text }
          }));
        },
        args: [selectedText.trim()]
      }).catch((err) => {
        console.error("Extension: Error injecting explain text script:", err);
      });
    });
  } else if (info.menuItemId === 'open-search') {
    if (!tab || !tab.id) return;
    const url = tab.url || "";
    if (url.startsWith("chrome://") ||
        url.startsWith("chrome-extension://") ||
        url.startsWith("chrome-search://") ||
        url.startsWith("edge://") ||
        url.startsWith("about:")) {
      console.log("Extension cannot access this page:", url);
      return;
    }
    chrome.tabs.sendMessage(tab.id, { action: "toggleSearch" }).then(() => {
      console.log("Extension: Open search message sent to tab");
    }).catch((error) => {
      console.log("Open search message failed, trying script injection:", error);
      chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: false },
        func: () => {
          window.dispatchEvent(new CustomEvent("open-webui-toggle-search", { bubbles: true }));
          if (window.openWebUIToggleSearch && typeof window.openWebUIToggleSearch === "function") {
            try {
              window.openWebUIToggleSearch();
            } catch (e) {
              console.error("Extension: Error calling toggle function:", e);
            }
          }
        }
      }).catch((err) => {
        if (err.message && err.message.includes("Cannot access contents")) {
          console.log("Extension: Page cannot be accessed (restricted page)");
        } else {
          console.error("Extension: Error injecting open search script:", err);
        }
      });
    });
  } else if (info.menuItemId === 'open-sidebar') {
    // Open immediately (user gesture); set context tab after.
    chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
    if (tab && tab.id != null) {
      sidePanelContextTabIdMemory = tab.id;
      chrome.storage.session.set({ [SIDE_PANEL_CONTEXT_TAB_KEY]: tab.id }).catch(() => {});
    }
  } else if (info.menuItemId === 'open-settings') {
    chrome.tabs.create({ url: chrome.runtime.getURL('extension/dist/settings.html') });
    return;
  }
});

// ============================================================================
// ENHANCEMENT: Message Handler
// ============================================================================
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  // Validate message action (sync — must complete before any await so the port stays open)
  if (!request.action || !ALLOWED_ACTIONS.includes(request.action)) {
    console.error("Extension: Invalid action:", request.action);
    sendResponse({ error: "Invalid action" });
    return false;
  }

  // Ping: wake service worker; reply immediately (sync — no async needed).
  if (request.action === "ping") {
    sendResponse({ pong: true });
    return false;
  }

  // All remaining handlers are async. Run them in an IIFE and return true
  // synchronously so Chrome keeps the message port open for sendResponse.
  // (Declaring the listener itself as `async` returns a Promise, which Chrome
  //  treats as a non-true return value and immediately closes the port.)
  (async () => {
    // Validate sender - allow certain actions without tab validation
    const actionsWithoutTab = ['ping', 'getSidebarInit', 'fetchModels', 'encryptApiKey', 'decryptApiKey', 'openSidePanel', 'getActiveTabPageContent', 'openSearchFromPopup', 'openSidebarFromPopup', 'openSettings', 'saveProvider', 'deleteProvider', 'setActiveProvider', 'setActiveModel', 'decryptProviderKey', 'saveAppearance'];
    const needsTab = !actionsWithoutTab.includes(request.action);

    // For actions that need a tab, try to get it from the message or query active tab
    let id = sender?.tab?.id;
    if (needsTab && !id) {
      // Try to get the active tab
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs && tabs[0]) {
          id = tabs[0].id;
        }
      } catch (e) {
        // Continue without tab ID
      }
    }

    // If action needs a tab but we don't have one, return error
    if (needsTab && !id) {
      console.error("Extension: No tab available for action:", request.action);
      sendResponse({ error: "No tab available" });
      return;
    }

  if (request.action == "getSelection") {
    chrome.scripting
      .executeScript({
        target: { tabId: id, allFrames: true },
        func: () => {
          return window.getSelection().toString();
        },
      })
      .then((res) => {
        sendResponse({ data: res[0]["result"] });
      })
      .catch((err) => {
        sendResponse({ error: getUserFriendlyErrorMessage(err) });
      });
    return true;
  } else if (request.action == "writeText") {
    chrome.scripting.executeScript({
      target: { tabId: id, allFrames: true },
      func: (text, targetId) => {
        if (typeof text !== 'string') {
          console.error("Extension: Invalid text type");
          return;
        }
        if (targetId && typeof targetId !== 'string') {
          console.error("Extension: Invalid targetId type");
          return;
        }

        let targetElement = null;

        if (targetId) {
          targetElement = document.getElementById(targetId);
        }

        if (!targetElement) {
          const activeElement = document.activeElement;
          if (
            activeElement &&
            (activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA")
          ) {
            targetElement = activeElement;
          }
        }

        if (!targetElement) {
          const inputs = document.querySelectorAll("input, textarea");
          for (const input of inputs) {
            if (input.offsetParent !== null) {
              targetElement = input;
              break;
            }
          }
        }

        if (targetElement) {
          targetElement.value = `${targetElement.value}${text}`;
          const event = new Event("input", { bubbles: true });
          targetElement.dispatchEvent(event);
          if (targetElement.tagName === "TEXTAREA") {
            targetElement.scrollTop = targetElement.scrollHeight;
          }
        } else {
          console.warn("No active input or textarea field found.");
        }
      },
      args: [request.text, request.targetId],
    });
    sendResponse({});
  } else if (request.action == "fetchModels") {
    (async () => {
      let responded = false;
      const reply = (payload) => {
        if (responded) return;
        responded = true;
        try { sendResponse(payload); } catch (e) {}
      };
      const { url, key, rawKey, providerType } = request;

      // rawKey is used from the Settings form (unencrypted, typed by user)
      // key is the encrypted key from storage (needs decryption)
      let decryptedKey = '';
      if (rawKey) {
        decryptedKey = rawKey;
      } else if (key) {
        try {
          decryptedKey = await decryptApiKey(key);
        } catch (e) {
          return reply({ error: 'Failed to decrypt API key' });
        }
      }

      const rateLimitCheck = await checkRateLimit("fetchModels");
      if (!rateLimitCheck.allowed) {
        reply({ error: `Rate limit exceeded. Please wait ${rateLimitCheck.waitTime} seconds before fetching models again.` });
        return;
      }

      if (providerType === 'anthropic') {
        try {
          const resp = await fetch('https://api.anthropic.com/v1/models', {
            headers: {
              'x-api-key': decryptedKey,
              'anthropic-version': '2023-06-01',
            },
          });
          if (!resp.ok) {
            const err = await resp.text().catch(() => '');
            return reply({ error: `Anthropic models error: ${resp.status} ${err}` });
          }
          const anthropicData = await resp.json();
          const models = (anthropicData.data || [])
            .filter((m) => m.id && m.id.startsWith('claude-'))
            .map((m) => ({ id: m.id, name: m.display_name || m.id }));
          return reply({ data: { data: models } });
        } catch (e) {
          return reply({ error: e.message });
        }
      }

      // OpenAI-compatible path
      const apiUrl = `${url}/api/models`;
      const validatedUrl = getValidatedFetchUrl(apiUrl);
      if (!validatedUrl) return reply({ error: 'Invalid server URL' });
      try {
        const resp = await fetch(validatedUrl, {
          headers: { Authorization: `Bearer ${decryptedKey}` },
        });
        if (!resp.ok) {
          const err = await resp.text().catch(() => '');
          return reply({ error: `Models error: ${resp.status} ${err}` });
        }
        const data = await resp.json();
        return reply({ data });
      } catch (e) {
        return reply({ error: e.message });
      }
    })();
    return true;
  } else if (request.action == "encryptApiKey") {
    (async () => {
      let responded = false;
      const reply = (payload) => {
        if (responded) return;
        responded = true;
        try { sendResponse(payload); } catch (e) {}
      };
      try {
        const encrypted = await encryptApiKey(request.apiKey);
        reply({ encrypted: encrypted });
      } catch (error) {
        reply({ error: getUserFriendlyErrorMessage(error) });
      }
    })();
    return true;
  } else if (request.action == "decryptApiKey") {
    (async () => {
      let responded = false;
      const reply = (payload) => {
        if (responded) return;
        responded = true;
        try { sendResponse(payload); } catch (e) {}
      };
      try {
        const decrypted = await decryptApiKey(request.encryptedApiKey);
        reply({ decrypted: decrypted });
      } catch (error) {
        reply({ error: getUserFriendlyErrorMessage(error) });
      }
    })();
    return true;
  } else if (request.action == "extractPageContent") {
    (async () => {
      try {
        const result = await handleExtractPageContent(id);
        sendResponse(result);
      } catch (error) {
        const friendlyError = getUserFriendlyErrorMessage(error);
        sendResponse({ error: friendlyError });
      }
    })();
    return true;
  } else if (request.action == "getActiveTabPageContent") {
    (async () => {
      let responded = false;
      const reply = (payload) => {
        if (responded) return;
        responded = true;
        try { sendResponse(payload); } catch (e) {}
      };
      try {
        const tabId = await getContextTabId();
        if (!tabId) {
          reply({ error: "No active tab" });
          return;
        }
        const tab = await chrome.tabs.get(tabId);
        const url = tab && tab.url ? tab.url : "";
        if (url.startsWith("chrome://") || url.startsWith("chrome-extension://") || url.startsWith("edge://") || url.startsWith("about:")) {
          reply({ error: "Cannot access this page" });
          return;
        }
        const result = await getPageContentForTabId(tabId);
        reply(result.data !== undefined ? { data: result.data } : { error: result.error || "No content" });
      } catch (error) {
        reply({ error: getUserFriendlyErrorMessage(error) });
      }
    })();
    return true;
  } else if (request.action == "getSidebarInit") {
    // Config + decrypt only (no tab/page content). Reply as fast as possible to avoid "message port closed".
    // Sidebar then gets page content and models in separate messages (with retry).
    (async () => {
      let responded = false;
      const reply = (payload) => {
        if (responded) return;
        responded = true;
        try { sendResponse(payload); } catch (e) {}
      };
      chrome.storage.local.get(['providers', 'activeProviderId', 'activeModel'], async (data) => {
        const providers = data.providers || [];
        const activeProviderId = data.activeProviderId || '';
        const activeModel = data.activeModel || '';
        const activeProvider = providers.find((p) => p.id === activeProviderId);

        if (!activeProvider) {
          return reply({ providers, activeProviderId, activeModel, key: '', url: '' });
        }

        let decryptedKey = '';
        try {
          decryptedKey = await decryptApiKey(activeProvider.encryptedKey);
        } catch (e) {
          return reply({ error: 'Failed to decrypt API key', providers, activeProviderId, activeModel });
        }

        reply({
          providers,
          activeProviderId,
          activeModel,
          providerType: activeProvider.type,
          url: activeProvider.url || '',
          key: decryptedKey,
        });
      });
    })();
    return true;
  } else if (request.action == "createChat") {
    (async () => {
      if (!isValidUrl(request.url)) {
        sendResponse({ error: "Invalid URL format" });
        return;
      }

      let decryptedKey = request.api_key;
      if (request.api_key) {
        try {
          decryptedKey = await decryptApiKey(request.api_key);
        } catch (error) {
          console.error("Extension: Failed to decrypt API key for createChat:", error);
        }
      }

      if (!request.body || typeof request.body !== 'object') {
        sendResponse({ error: "Invalid request body" });
        return;
      }

      const apiUrl = `${request.url}/api/chats`;
      if (!isValidUrl(apiUrl)) {
        sendResponse({ error: "Invalid API URL" });
        return;
      }

      try {
        const res = await safeFetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(decryptedKey && { Authorization: `Bearer ${decryptedKey}` }),
          },
          body: JSON.stringify(request.body),
        });

        validateCSPHeaders(res);

        if (!res.ok) {
          const errorText = await res.text();
          const friendlyError = getUserFriendlyErrorMessage({ message: `HTTP ${res.status}: ${errorText}` });
          sendResponse({ error: friendlyError });
          return;
        }

        const data = await res.json();
        sendResponse({ data: data });
      } catch (error) {
        const friendlyError = getUserFriendlyErrorMessage(error);
        sendResponse({ error: friendlyError });
      }
    })();
    return true;
  } else if (request.action == "openSidePanel") {
    // Note: open() may only be called in response to a user gesture; when invoked via message the gesture is often lost.
    chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT })
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ error: err && err.message ? err.message : "User gesture required" }));
    return true;
  } else if (request.action == "openSearchFromPopup") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const t = (tabs && tabs[0]) ? tabs[0] : null;
      if (t) {
        runToggleSearchForTab(t, true);
        sendResponse({});
      } else {
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, (fallbackTabs) => {
          const ft = (fallbackTabs && fallbackTabs[0]) ? fallbackTabs[0] : null;
          if (ft) runToggleSearchForTab(ft, true);
          sendResponse(ft ? {} : { error: "No active tab" });
        });
      }
    });
    return true;
  } else if (request.action == "openSidebarFromPopup") {
    // Popup opens the panel itself (user gesture); we only set context tab here.
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const t = (tabs && tabs[0]) ? tabs[0] : null;
      const tabId = t && t.id != null ? t.id : null;
      if (tabId != null) {
        sidePanelContextTabIdMemory = tabId;
        chrome.storage.session.set({ [SIDE_PANEL_CONTEXT_TAB_KEY]: tabId }).catch(() => {});
        sendResponse({ success: true });
      } else {
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, (ft) => {
          const id = (ft && ft[0]) ? ft[0].id : null;
          if (id != null) {
            sidePanelContextTabIdMemory = id;
            chrome.storage.session.set({ [SIDE_PANEL_CONTEXT_TAB_KEY]: id }).catch(() => {});
          }
          sendResponse({ success: true });
        });
      }
    });
    return true;
  } else if (request.action == "openSettings") {
    (async () => {
      let responded = false;
      const reply = (payload) => {
        if (responded) return;
        responded = true;
        try { sendResponse(payload); } catch (e) {}
      };
      chrome.tabs.create({ url: chrome.runtime.getURL('extension/dist/settings.html') });
      reply({ success: true });
    })();
    return true;
  } else if (request.action === 'saveAppearance') {
    (() => {
      let responded = false;
      const reply = (payload) => {
        if (responded) return;
        responded = true;
        try { sendResponse(payload); } catch (e) {}
      };
      const a = request.appearance;
      const validThemes = ['dark', 'light', 'system'];
      const validDensities = ['compact', 'normal', 'comfortable'];
      const validHex = /^#[0-9a-fA-F]{6}$/;
      if (
        a && typeof a === 'object' &&
        validThemes.includes(a.theme) &&
        validDensities.includes(a.density) &&
        typeof a.accentColor === 'string' && validHex.test(a.accentColor)
      ) {
        chrome.storage.sync.set({ appearance: { theme: a.theme, density: a.density, accentColor: a.accentColor } }, () => {
          reply({ ok: true });
        });
      } else {
        reply({ ok: false, error: 'Invalid appearance payload' });
      }
    })();
    return true;

  } else if (request.action == "saveProvider") {
    (async () => {
      let responded = false;
      const reply = (payload) => {
        if (responded) return;
        responded = true;
        try { sendResponse(payload); } catch (e) {}
      };
      chrome.storage.local.get(['providers'], async (data) => {
        let providers = data.providers || [];
        let encryptedKey;
        try {
          encryptedKey = await encryptApiKey(request.provider.rawKey);
        } catch (e) {
          return reply({ error: 'Encryption failed' });
        }

        if (request.provider.id) {
          // Update existing
          providers = providers.map((p) =>
            p.id === request.provider.id
              ? { ...p, name: request.provider.name, type: request.provider.type, url: request.provider.url || null, encryptedKey }
              : p
          );
        } else {
          // Create new
          const newProvider = {
            id: crypto.randomUUID(),
            name: request.provider.name,
            type: request.provider.type,
            url: request.provider.url || null,
            encryptedKey,
          };
          providers = [...providers, newProvider];
        }

        chrome.storage.local.set({ providers }, () => reply({ success: true, providers }));
      });
    })();
    return true;
  } else if (request.action == "deleteProvider") {
    (async () => {
      let responded = false;
      const reply = (payload) => {
        if (responded) return;
        responded = true;
        try { sendResponse(payload); } catch (e) {}
      };
      chrome.storage.local.get(['providers', 'activeProviderId'], (data) => {
        const providers = (data.providers || []).filter((p) => p.id !== request.providerId);
        const updates = { providers };
        if (data.activeProviderId === request.providerId) {
          updates.activeProviderId = providers[0]?.id ?? '';
        }
        chrome.storage.local.set(updates, () => reply({ success: true, providers }));
      });
    })();
    return true;
  } else if (request.action == "setActiveProvider") {
    (async () => {
      let responded = false;
      const reply = (payload) => {
        if (responded) return;
        responded = true;
        try { sendResponse(payload); } catch (e) {}
      };
      chrome.storage.local.set({ activeProviderId: request.providerId }, () =>
        reply({ success: true })
      );
    })();
    return true;
  } else if (request.action == "setActiveModel") {
    (async () => {
      let responded = false;
      const reply = (payload) => {
        if (responded) return;
        responded = true;
        try { sendResponse(payload); } catch (e) {}
      };
      chrome.storage.local.set({ activeModel: request.model }, () =>
        reply({ success: true })
      );
    })();
    return true;
  } else if (request.action == "decryptProviderKey") {
    (async () => {
      let responded = false;
      const reply = (payload) => {
        if (responded) return;
        responded = true;
        try { sendResponse(payload); } catch (e) {}
      };
      chrome.storage.local.get(['providers'], async (data) => {
        const provider = (data.providers || []).find((p) => p.id === request.providerId);
        if (!provider) return reply({ error: 'Provider not found' });
        try {
          const key = await decryptApiKey(provider.encryptedKey);
          reply({ key });
        } catch (e) {
          reply({ error: 'Decryption failed' });
        }
      });
    })();
    return true;
  } else {
    sendResponse({});
  }
  })();
  return true;
});

// ============================================================================
// ENHANCEMENT: Streaming Chat Completions via Ports
// ============================================================================
function safePortPost(port, message) {
  try {
    port.postMessage(message);
  } catch (e) {
    if (e?.message && !e.message.includes("disconnected")) {
      console.error("Extension: port.postMessage error", e);
    }
  }
}

function safePortDisconnect(port) {
  try {
    port.disconnect();
  } catch (e) {
    if (e?.message && !e.message.includes("disconnected")) {
      console.error("Extension: port.disconnect error", e);
    }
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "chat-stream") {
    port.onMessage.addListener(async (msg) => {
      if (msg.action === "fetchChatCompletion") {
        // Validate URL
        if (!isValidUrl(msg.url)) {
          safePortPost(port, { error: "Invalid URL format" });
          safePortDisconnect(port);
          return;
        }

        // Validate API key format
        if (!msg.api_key || typeof msg.api_key !== 'string') {
          safePortPost(port, { error: "Invalid API key format" });
          safePortDisconnect(port);
          return;
        }

        // Decrypt API key
        let decryptedApiKey = msg.api_key;
        try {
          decryptedApiKey = await decryptApiKey(msg.api_key);
        } catch (error) {
          console.error("Extension: Failed to decrypt API key for chat completion:", error);
        }

        // Validate request body
        if (!msg.body || typeof msg.body !== 'object') {
          safePortPost(port, { error: "Invalid request body" });
          safePortDisconnect(port);
          return;
        }

        // Rate Limiting
        const rateLimitCheck = await checkRateLimit('chatCompletion');
        if (!rateLimitCheck.allowed) {
          safePortPost(port, {
            error: `Rate limit exceeded. Please wait ${rateLimitCheck.waitTime} seconds before making another request.`
          });
          safePortDisconnect(port);
          return;
        }

        if (msg.providerType === 'anthropic') {
          let decryptedKey = '';
          try {
            decryptedKey = await decryptApiKey(msg.key);
          } catch (e) {
            safePortPost(port, { error: 'Failed to decrypt API key' });
            safePortDisconnect(port);
            return;
          }

          // Build Anthropic request body: extract system message, set max_tokens
          const systemMsg = (msg.body.messages || []).find((m) => m.role === 'system');
          const userMessages = (msg.body.messages || []).filter((m) => m.role !== 'system');
          const anthropicBody = {
            model: msg.body.model,
            messages: userMessages,
            max_tokens: 8096,
            stream: true,
          };
          if (systemMsg) anthropicBody.system = systemMsg.content;

          let response;
          try {
            response = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'x-api-key': decryptedKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
              },
              body: JSON.stringify(anthropicBody),
            });
          } catch (e) {
            safePortPost(port, { error: e.message });
            safePortDisconnect(port);
            return;
          }

          if (!response.ok) {
            const errText = await response.text().catch(() => '');
            safePortPost(port, { error: `${response.status}: ${errText}` });
            safePortDisconnect(port);
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // last partial line stays in buffer

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data: ')) continue;
              const jsonStr = trimmed.slice(6);
              let parsed;
              try { parsed = JSON.parse(jsonStr); } catch { continue; }

              if (parsed.type === 'message_stop') {
                safePortPost(port, { line: 'data: [DONE]' });
                safePortDisconnect(port);
                return;
              }
              if (
                parsed.type === 'content_block_delta' &&
                parsed.delta?.type === 'text_delta'
              ) {
                const normalized = `data: ${JSON.stringify({ choices: [{ delta: { content: parsed.delta.text } }] })}`;
                safePortPost(port, { line: normalized });
              }
            }
          }
          safePortDisconnect(port);
          return;
        }
        // Existing OpenAI-compatible path continues below...

        const apiUrl = `${msg.url}/chat/completions`;
        if (!isValidUrl(apiUrl)) {
          safePortPost(port, { error: "Invalid API URL" });
          safePortDisconnect(port);
          return;
        }

        safeFetch(apiUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${decryptedApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(msg.body),
        })
          .then(async (res) => {
            validateCSPHeaders(res);

            if (!res.ok) {
              const errorText = await res.text();
              const friendlyError = getUserFriendlyErrorMessage({ message: `HTTP ${res.status}: ${errorText}` });
              safePortPost(port, { error: friendlyError });
              safePortDisconnect(port);
              return;
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();

            const readChunk = async () => {
              try {
                const { done, value } = await reader.read();
                if (done) {
                  safePortPost(port, { done: true });
                  safePortDisconnect(port);
                  return;
                }

                const chunk = decoder.decode(value, { stream: true });
                safePortPost(port, { chunk: chunk, done: false });
                readChunk();
              } catch (error) {
                const friendlyError = getUserFriendlyErrorMessage(error);
                safePortPost(port, { error: friendlyError, done: true });
                safePortDisconnect(port);
              }
            };

            readChunk();
          })
          .catch((error) => {
            const friendlyError = getUserFriendlyErrorMessage(error);
            safePortPost(port, { error: friendlyError });
            safePortDisconnect(port);
          });
      }
    });
  }
});
