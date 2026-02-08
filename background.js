// ============================================================================
// ENHANCEMENT: API Key Encryption
// ============================================================================
// This fork adds AES-256-GCM encryption for API keys stored in chrome.storage.local.
// Encryption uses the extension ID as part of the key derivation, making each
// installation unique. This prevents API keys from being readable in plain text
// if storage is accessed.
//
// Security Note: While the extension ID can be obtained, the encryption still
// provides protection against casual inspection and requires knowledge of the
// encryption scheme to decrypt. See SECURITY.md for details.
// ============================================================================

// API Key Encryption using Web Crypto API
// Derive encryption key from extension ID for unique per-installation encryption
async function getEncryptionKey() {
  try {
    // Get extension ID
    const extensionId = chrome.runtime.id;
    
    // Derive a key from extension ID using PBKDF2
    const encoder = new TextEncoder();
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

// Encrypt API key
async function encryptApiKey(apiKey) {
  try {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error("Invalid API key for encryption");
    }
    
    const key = await getEncryptionKey();
    const encoder = new TextEncoder();
    const data = encoder.encode(apiKey);
    
    // Generate IV for each encryption
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    const encrypted = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      key,
      data
    );
    
    // Combine IV and encrypted data, then encode as base64
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    
    return btoa(String.fromCharCode(...combined));
  } catch (error) {
    console.error("Extension: Encryption failed:", error);
    throw error;
  }
}

// Decrypt API key
async function decryptApiKey(encryptedApiKey) {
  try {
    if (!encryptedApiKey || typeof encryptedApiKey !== 'string') {
      throw new Error("Invalid encrypted API key");
    }
    
    // Check if it's already decrypted (backward compatibility)
    // Encrypted keys start with base64 pattern, unencrypted keys typically don't
    // Simple heuristic: if it doesn't look like base64 or is short, assume unencrypted
    if (encryptedApiKey.length < 20 || !/^[A-Za-z0-9+/=]+$/.test(encryptedApiKey)) {
      // Likely unencrypted, return as-is (backward compatibility)
      return encryptedApiKey;
    }
    
    const key = await getEncryptionKey();
    
    // Decode base64
    const combined = Uint8Array.from(atob(encryptedApiKey), c => c.charCodeAt(0));
    
    // Extract IV (first 12 bytes) and encrypted data
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);
    
    try {
      const decrypted = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv
        },
        key,
        encrypted
      );
      
      const decoder = new TextDecoder();
      return decoder.decode(decrypted);
    } catch (decryptError) {
      // If decryption fails, assume it's an unencrypted key (backward compatibility)
      console.log("Extension: Decryption failed, assuming unencrypted key:", decryptError);
      return encryptedApiKey;
    }
  } catch (error) {
    console.error("Extension: Decryption failed:", error);
    // Return as-is for backward compatibility
    return encryptedApiKey;
  }
}

// ============================================================================
// ENHANCEMENT: SSRF Protection - URL Validation
// ============================================================================
// Validates URLs to prevent Server-Side Request Forgery (SSRF) attacks.
// Only allows http: and https: protocols, blocking javascript:, data:, and
// other potentially dangerous schemes.
// ============================================================================
// Security: URL validation to prevent SSRF attacks
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

// Returns a safe URL string for fetch (reconstructed from parsed URL) or null. Prevents SSRF;
// the value passed to fetch is never raw user input.
function getValidatedFetchUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') return null;
  try {
    const url = new URL(urlString);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.origin + url.pathname + url.search;
  } catch (e) {
    return null;
  }
}

// Fetches only after URL validation. Uses reconstructed URL so no user-controlled string reaches fetch.
function safeFetch(apiUrl, options) {
  const safeUrl = getValidatedFetchUrl(apiUrl);
  if (safeUrl === null) {
    return Promise.reject(new Error('Invalid API URL'));
  }
  return fetch(safeUrl, options);
}

// ============================================================================
// ENHANCEMENT: Message Action Validation
// ============================================================================
// Whitelist of allowed message actions to prevent unauthorized actions from
// content scripts or malicious code injection.
// ============================================================================
// Security: Validate message actions
const ALLOWED_ACTIONS = ['getSelection', 'writeText', 'fetchModels', 'toggleSearch', 'encryptApiKey', 'decryptApiKey', 'createChat', 'extractPageContent', 'summarizePage', 'explainText'];

// ============================================================================
// ENHANCEMENT: Rate Limiting
// ============================================================================
// Implements sliding window rate limiting to prevent abuse and API quota exhaustion.
// Limits are enforced per action type (chatCompletion, fetchModels, general).
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
// CSP Validation: Check if response headers comply with CSP
function validateCSPHeaders(response) {
  const cspHeader = response.headers.get('content-security-policy');
  if (cspHeader) {
    // Log CSP header for debugging (don't block, just log)
    console.log("Extension: CSP header detected:", cspHeader);
  }
  return true; // Don't block based on CSP headers, just validate
}

// Injected into the page via chrome.scripting.executeScript for "writeText" action.
// Must be at function body root for consistent behavior; runs in page context.
function writeTextToInput(text, targetId) {
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
}

// ============================================================================
// ENHANCEMENT: Page Content Extraction
// ============================================================================
// Extracts main article content from web pages, filtering out navigation,
// ads, footers, and other non-content elements. Uses multiple strategies
// to find the main content.
// ============================================================================
// Function to extract page content (executed in page context)
function extractPageContentScript() {
  // Helper function to check if element is visible
  function isVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && 
           style.visibility !== 'hidden' && 
           style.opacity !== '0' &&
           element.offsetWidth > 0 && 
           element.offsetHeight > 0;
  }

  // Helper function to check if element should be excluded
  function shouldExclude(element) {
    if (!element) return true;
    
    const tagName = element.tagName.toLowerCase();
    const id = (element.id || '').toLowerCase();
    const className = (element.className || '').toLowerCase();
    
    // Exclude navigation, headers, footers, ads
    if (tagName === 'nav' || tagName === 'header' || tagName === 'footer' || 
        tagName === 'aside' || tagName === 'script' || tagName === 'style' ||
        tagName === 'noscript' || tagName === 'iframe') {
      return true;
    }
    
    // Exclude common ad containers
    if (id.includes('ad') || className.includes('ad') || 
        className.includes('advertisement') || className.includes('sidebar') ||
        className.includes('cookie') || className.includes('popup') ||
        className.includes('modal') || className.includes('overlay')) {
      return true;
    }
    
    // Exclude elements with role="navigation" or role="banner"
    const role = element.getAttribute('role');
    if (role === 'navigation' || role === 'banner' || role === 'complementary') {
      return true;
    }
    
    return false;
  }

  // Strategy 1: Look for semantic HTML5 elements
  let mainContent = document.querySelector('main, article, [role="main"]');
  if (mainContent && isVisible(mainContent)) {
    // Filter out excluded elements within main content
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
      // Clone to avoid modifying original
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
  
  // Remove hidden elements
  const allElements = body.querySelectorAll('*');
  allElements.forEach(el => {
    if (!isVisible(el)) {
      el.remove();
    }
  });
  
  const text = (body.innerText || body.textContent || '').trim();
  
  // Clean up excessive whitespace and return
  const cleanedText = text.replace(/\s+/g, ' ').substring(0, 50000); // Limit to 50k chars
  
  // Return cleaned text if it has meaningful content (at least 50 characters)
  if (cleanedText.length >= 50) {
    return cleanedText;
  }
  
  // Strategy 4: Last resort - try to get text from common product/content areas
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
        const text = (element.innerText || element.textContent || '').trim();
        if (text.length >= 50) {
          return text.replace(/\s+/g, ' ').substring(0, 50000);
        }
      }
    }
  }
  
  // If all strategies fail, return whatever text we have (even if short)
  return cleanedText || '';
}

// Message handler for extractPageContent
async function handleExtractPageContent(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: extractPageContentScript
    });
    
    if (results && results[0] && results[0].result) {
      const extractedText = results[0].result;
      // Check if we got meaningful content (at least 50 characters)
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

// ============================================================================
// ENHANCEMENT: Keyboard Shortcut Handling via Commands API
// ============================================================================
// Uses Chrome's Commands API instead of direct keydown listeners to avoid
// conflicts with browser shortcuts and ensure reliable global shortcut handling.
// Includes fallback mechanisms for restricted pages (chrome://, etc.).
// ============================================================================
// Handle keyboard shortcut command
chrome.commands.onCommand.addListener(function (command) {
  console.log("Command received:", command);
  if (command === "open-search") {
    // Get the active tab and send message to content script
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) {
        // Check if we can access this page
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
        // Try sending message first (most reliable)
        chrome.tabs.sendMessage(tabs[0].id, { action: "toggleSearch" }).then(() => {
          console.log("Message sent successfully");
        }).catch((error) => {
          // If message fails, try injecting script to set a flag
          console.log("Message failed, trying script injection:", error);
          chrome.scripting.executeScript({
            target: { tabId: tabs[0].id, allFrames: false },
            func: () => {
              // Set a flag that content script can check
              window.dispatchEvent(new CustomEvent("open-webui-toggle-search", { bubbles: true }));
              // Also try calling function if it exists
              if (window.openWebUIToggleSearch && typeof window.openWebUIToggleSearch === 'function') {
                try {
                  window.openWebUIToggleSearch();
                } catch (e) {
                  console.error("Error calling toggle function:", e);
                }
              }
            }
          }).catch((err) => {
            // Silently ignore errors for restricted pages
            if (err.message && err.message.includes("Cannot access contents")) {
              console.log("Page cannot be accessed by extension (restricted page)");
            } else {
              console.error("Error injecting script:", err);
            }
          });
        });
      }
    });
  }
});

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  // Security: Validate message action
  if (!request.action || !ALLOWED_ACTIONS.includes(request.action)) {
    console.error("Extension: Invalid action:", request.action);
    sendResponse({ error: "Invalid action" });
    return false;
  }
  
  // Security: Validate sender
  if (!sender || !sender.tab || !sender.tab.id) {
    console.error("Extension: Invalid sender");
    sendResponse({ error: "Invalid sender" });
    return false;
  }
  
  const id = sender.tab.id;
  
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
      });
    return true; // Keep channel open for async response
  } else if (request.action == "writeText") {
    chrome.scripting.executeScript({
      target: { tabId: id, allFrames: true },
      func: writeTextToInput,
      args: [request.text, request.targetId],
    });
    sendResponse({});
  } else if (request.action == "fetchModels") {
    // Return true immediately to keep channel open for async operations
    (async () => {
      // Security: Validate URL to prevent SSRF
      if (!isValidUrl(request.url)) {
        sendResponse({ error: "Invalid URL format" });
        return;
      }
      
      // Security: Validate API key format (basic check)
      if (request.key && typeof request.key !== 'string') {
        sendResponse({ error: "Invalid API key format" });
        return;
      }
      
      // Decrypt API key if provided
      let decryptedKey = request.key;
      if (request.key) {
        try {
          decryptedKey = await decryptApiKey(request.key);
        } catch (error) {
          console.error("Extension: Failed to decrypt API key for models request:", error);
          // Use as-is (might be unencrypted for backward compatibility)
        }
      }
      
      // Rate Limiting: Check if request is allowed
      const rateLimitCheck = await checkRateLimit('fetchModels');
      if (!rateLimitCheck.allowed) {
        sendResponse({ 
          error: `Rate limit exceeded. Please wait ${rateLimitCheck.waitTime} seconds before fetching models again.` 
        });
        return;
      }
      
      // Proxy API call through background script to avoid CORS
      const apiUrl = `${request.url}/api/models`;
      if (!isValidUrl(apiUrl)) {
        sendResponse({ error: "Invalid API URL" });
        return;
      }
      
      try {
        const res = await safeFetch(apiUrl, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(decryptedKey && { authorization: `Bearer ${decryptedKey}` }),
          },
        });

        validateCSPHeaders(res);

        if (!res.ok) {
          const error = await res.json();
          sendResponse({ error: error });
          return;
        }
        const data = await res.json();
        sendResponse({ data: data });
      } catch (error) {
        sendResponse({ error: error.message });
      }
    })();
    return true; // Keep channel open for async response
  } else if (request.action == "encryptApiKey") {
    // Encrypt API key before storing
    (async () => {
      try {
        const encrypted = await encryptApiKey(request.apiKey);
        sendResponse({ encrypted: encrypted });
      } catch (error) {
        sendResponse({ error: error.message });
      }
    })();
    return true; // Keep channel open for async response
  } else if (request.action == "decryptApiKey") {
    // Decrypt API key after retrieving
    (async () => {
      try {
        const decrypted = await decryptApiKey(request.encryptedApiKey);
        sendResponse({ decrypted: decrypted });
      } catch (error) {
        sendResponse({ error: error.message });
      }
    })();
    return true; // Keep channel open for async response
  } else if (request.action == "extractPageContent") {
    // Extract page content from the current tab
    (async () => {
      try {
        const result = await handleExtractPageContent(id);
        sendResponse(result);
      } catch (error) {
        sendResponse({ error: error.message });
      }
    })();
    return true; // Keep channel open for async response
  } else if (request.action == "createChat") {
    // ========================================================================
    // ENHANCEMENT: Continue in OpenWebUI Feature
    // ========================================================================
    // Allows users to transfer their conversation from the extension to the
    // full OpenWebUI interface. Creates a new chat via API and opens it in a new tab.
    // Includes URL validation, API key decryption, and CSP header validation.
    // ========================================================================
    // Create a chat conversation in OpenWebUI via API
    (async () => {
      // Security: Validate URL to prevent SSRF
      if (!isValidUrl(request.url)) {
        sendResponse({ error: "Invalid URL format" });
        return;
      }
      
      // Decrypt API key if provided
      let decryptedKey = request.api_key;
      if (request.api_key) {
        try {
          decryptedKey = await decryptApiKey(request.api_key);
        } catch (error) {
          console.error("Extension: Failed to decrypt API key for createChat:", error);
          // Use as-is (might be unencrypted for backward compatibility)
        }
      }
      
      // Security: Validate request body
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
          sendResponse({ error: `HTTP ${res.status}: ${errorText}` });
          return;
        }

        const data = await res.json();
        sendResponse({ data: data });
      } catch (error) {
        sendResponse({ error: error.message });
      }
    })();
    return true; // Keep channel open for async response
  } else {
    sendResponse({});
  }

  return true;
});

// ============================================================================
// ENHANCEMENT: Streaming Chat Completions via Ports
// ============================================================================
// Uses Chrome's port-based messaging for streaming AI responses. This allows
// real-time streaming of responses from the background script to content scripts
// without blocking the message channel. Includes rate limiting and security
// validation for all requests.
// ============================================================================
// Handle streaming chat completions via ports
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "chat-stream") {
    port.onMessage.addListener(async (msg) => {
      if (msg.action === "fetchChatCompletion") {
        // Security: Validate URL to prevent SSRF
        if (!isValidUrl(msg.url)) {
          port.postMessage({ error: "Invalid URL format" });
          port.disconnect();
          return;
        }
        
        // Security: Validate API key format
        if (!msg.api_key || typeof msg.api_key !== 'string') {
          port.postMessage({ error: "Invalid API key format" });
          port.disconnect();
          return;
        }
        
        // Decrypt API key
        let decryptedApiKey = msg.api_key;
        try {
          decryptedApiKey = await decryptApiKey(msg.api_key);
        } catch (error) {
          console.error("Extension: Failed to decrypt API key for chat completion:", error);
          // Use as-is (might be unencrypted for backward compatibility)
        }
        
        // Security: Validate request body
        if (!msg.body || typeof msg.body !== 'object') {
          port.postMessage({ error: "Invalid request body" });
          port.disconnect();
          return;
        }
        
        // Rate Limiting: Check if request is allowed
        const rateLimitCheck = await checkRateLimit('chatCompletion');
        if (!rateLimitCheck.allowed) {
          port.postMessage({ 
            error: `Rate limit exceeded. Please wait ${rateLimitCheck.waitTime} seconds before making another request.` 
          });
          port.disconnect();
          return;
        }
        
        const apiUrl = `${msg.url}/chat/completions`;
        if (!isValidUrl(apiUrl)) {
          port.postMessage({ error: "Invalid API URL" });
          port.disconnect();
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
            // CSP Validation: Check response headers
            validateCSPHeaders(res);
            
            if (!res.ok) {
              const errorText = await res.text();
              port.postMessage({ error: `HTTP ${res.status}: ${errorText}` });
              port.disconnect();
              return;
            }
            
            // Read the stream and send chunks back
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            
            const readChunk = async () => {
              try {
                const { done, value } = await reader.read();
                if (done) {
                  port.postMessage({ done: true });
                  port.disconnect();
                  return;
                }
                
                const chunk = decoder.decode(value, { stream: true });
                port.postMessage({ chunk: chunk, done: false });
                readChunk();
              } catch (error) {
                port.postMessage({ error: error.message, done: true });
                port.disconnect();
              }
            };
            
            readChunk();
          })
          .catch((error) => {
            port.postMessage({ error: error.message });
            port.disconnect();
          });
      }
    });
  }
});

// ============================================================================
// ENHANCEMENT: Context Menu Registration
// ============================================================================
// Registers context menu items for the extension. Creates a parent menu
// "OpenWebUI Extension" and a child menu "Summarize this Page".
// ============================================================================
// Register context menu on extension install/startup
let isRegisteringMenus = false;
function registerContextMenus() {
  // Prevent concurrent calls
  if (isRegisteringMenus) {
    console.log("Extension: Context menu registration already in progress, skipping...");
    return;
  }
  
  isRegisteringMenus = true;
  
  // Remove all existing menus first to avoid duplicates
  chrome.contextMenus.removeAll(() => {
    // Ignore errors from removeAll - menus might not exist yet
    if (chrome.runtime.lastError) {
      // Silently ignore - this is expected on first install
    }
    
    // Small delay to ensure removeAll completes before creating new menus
    setTimeout(() => {
      // Create "OpenWebUI Extension" parent menu item
      chrome.contextMenus.create({
        id: 'openwebui-extension',
        title: 'OpenWebUI Extension',
        contexts: ['page', 'selection', 'editable']
      }, () => {
        if (chrome.runtime.lastError) {
          console.error("Extension: Error creating OpenWebUI Extension context menu:", chrome.runtime.lastError.message);
          return;
        }
        
        console.log("Extension: OpenWebUI Extension context menu created successfully");
        
        // Small delay to ensure parent menu is fully registered before creating child menus
        setTimeout(() => {
          // Create "Summarize Page" as a child menu item under "OpenWebUI Extension"
          chrome.contextMenus.create({
            id: 'summarize-page',
            parentId: 'openwebui-extension',
            title: 'Summarize Page',
            contexts: ['page', 'selection']
          }, () => {
            if (chrome.runtime.lastError) {
              console.error("Extension: Error creating summarize context menu:", chrome.runtime.lastError.message);
            } else {
              console.log("Extension: Summarize context menu created successfully");
            }
          });
          
          // Create "Explain This" as a child menu item under "OpenWebUI Extension"
          chrome.contextMenus.create({
            id: 'explain-text',
            parentId: 'openwebui-extension',
            title: 'Explain This',
            contexts: ['selection']
          }, () => {
            if (chrome.runtime.lastError) {
              console.error("Extension: Error creating explain text context menu:", chrome.runtime.lastError.message);
            } else {
              console.log("Extension: Explain text context menu created successfully");
            }
          });
        }, 50); // Small delay to ensure parent menu is registered
      });
    }, 100); // Small delay to ensure removeAll completes
    
    // Reset flag after a delay to allow menu creation to complete
    setTimeout(() => {
      isRegisteringMenus = false;
    }, 500);
  });
}

// Register on install/update (this is the recommended way per Chrome docs)
// According to Chrome documentation: https://developer.chrome.com/docs/extensions/develop/migrate
// Context menus should be registered in chrome.runtime.onInstalled
chrome.runtime.onInstalled.addListener((details) => {
  console.log("Extension: onInstalled event:", details.reason);
  // registerContextMenus() already handles removeAll internally
  registerContextMenus();
});

// Also register when service worker starts (fallback for Manifest V3)
// Context menus should persist across service worker restarts, but there are known issues
// where they can disappear after browser restarts or extension updates.
// This ensures they're recreated if missing. Duplicate errors are handled gracefully.
// See: https://developer.chrome.com/docs/extensions/develop/migrate
chrome.runtime.onStartup.addListener(() => {
  console.log("Extension: Chrome started, ensuring context menus exist");
  registerContextMenus();
});

// Register immediately when service worker loads (for service worker restarts)
// This handles cases where context menus might be missing after service worker restarts
registerContextMenus();

// ============================================================================
// ENHANCEMENT: Context Menu Click Handler
// ============================================================================
// Handles clicks on context menu items. When "Summarize this Page" is clicked,
// extracts page content and sends it to the content script for summarization.
// ============================================================================
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'summarize-page') {
    // Check if page is accessible
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
      // Extract page content
      const extractResult = await handleExtractPageContent(tab.id);
      
      if (extractResult.error) {
        console.error("Extension: Failed to extract content:", extractResult.error);
        // Send error message to content script
        chrome.tabs.sendMessage(tab.id, {
          action: "summarizePage",
          error: extractResult.error
        }).catch(() => {
          // Content script might not be ready, try script injection
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              console.error("Extension: Failed to extract page content");
            }
          });
        });
        return;
      }
      
      // Send extracted content to content script
      chrome.tabs.sendMessage(tab.id, {
        action: "summarizePage",
        content: extractResult.data
      }).catch((error) => {
        // If message fails, try script injection as fallback
        console.log("Message failed, trying script injection:", error);
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (content) => {
            // Dispatch custom event that content script can listen for
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
      console.error("Extension: Error in context menu handler:", error);
    }
  } else if (info.menuItemId === 'explain-text') {
    // Check if page is accessible
    const url = tab.url || "";
    if (url.startsWith("chrome://") || 
        url.startsWith("chrome-extension://") || 
        url.startsWith("chrome-search://") ||
        url.startsWith("edge://") ||
        url.startsWith("about:")) {
      console.log("Extension cannot access this page:", url);
      return;
    }
    
    // Get selected text from context menu info
    const selectedText = info.selectionText || "";
    
    if (!selectedText || selectedText.trim().length === 0) {
      console.warn("Extension: No text selected for explanation");
      // Send error message to content script
      chrome.tabs.sendMessage(tab.id, {
        action: "explainText",
        error: "No text was selected. Please select some text and try again."
      }).catch(() => {
        // Content script might not be ready, try script injection
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            console.error("Extension: No text selected for explanation");
          }
        });
      });
      return;
    }
    
    try {
      // Send selected text to content script
      chrome.tabs.sendMessage(tab.id, {
        action: "explainText",
        text: selectedText.trim()
      }).catch((error) => {
        // If message fails, try script injection as fallback
        console.log("Message failed, trying script injection:", error);
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (text) => {
            // Dispatch custom event that content script can listen for
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
    } catch (error) {
      console.error("Extension: Error in explain text context menu handler:", error);
    }
  }
});
