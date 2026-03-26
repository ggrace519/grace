// Use multiple globals so Chrome API is found in content scripts and extension pages.
const getChrome = () => {
  try {
    if (typeof globalThis !== "undefined" && globalThis.chrome) return globalThis.chrome;
    if (typeof self !== "undefined" && self.chrome) return self.chrome;
    if (typeof window !== "undefined" && window.chrome) return window.chrome;
    return undefined;
  } catch {
    return undefined;
  }
};

const isChromeAPIAvailable = () => {
  try {
    const c = getChrome();
    return c != null &&
           typeof c.runtime !== 'undefined' &&
           c.runtime != null &&
           typeof c.runtime.sendMessage === 'function';
  } catch {
    return false;
  }
};

// ========================================================================
// Error handling utilities
// ========================================================================

// User-friendly error messages based on error type
export function getUserFriendlyErrorMessage(error) {
  const errorMessage = error?.message || String(error);

  // Check for network errors
  if (!navigator.onLine) {
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

  // Return the original error if no match
  return errorMessage;
}

export function isContextInvalidatedError(error) {
  const errorMessage = error?.message || String(error);
  return errorMessage.includes("Extension context invalidated");
}

// Wrap API call with consistent error handling
export function withErrorHandling(apiCall) {
  return async (...args) => {
    try {
      return await apiCall(...args);
    } catch (error) {
      const friendlyMessage = getUserFriendlyErrorMessage(error);
      console.error(`Extension: API Error - ${friendlyMessage}`, { originalError: error });

      // Re-throw with user-friendly message
      const wrappedError = new Error(friendlyMessage);
      wrappedError.originalError = error;
      wrappedError.isExtendedError = true;
      throw wrappedError;
    }
  };
}

const isMessagePortClosedError = (err) => {
  const msg = err?.message || String(err);
  return msg.includes("message port closed") || msg.includes("Message port closed");
};

// Send message to background with retries (handles service worker wake-up / port timeout).
function sendMessageWithRetry(message, maxRetries = 6) {
  const c = getChrome();
  if (!c?.runtime?.sendMessage) {
    return Promise.reject(new Error("Extension context invalidated - Chrome APIs not available"));
  }
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const send = () => {
      c.runtime.sendMessage(message, (response) => {
        const lastError = c.runtime?.lastError;
        if (lastError) {
          const msg = lastError.message || "";
          if (isMessagePortClosedError(msg) && attempts < maxRetries) {
            attempts += 1;
            setTimeout(send, 300 * attempts);
            return;
          }
          reject(new Error(msg));
          return;
        }
        resolve(response);
      });
    };
    send();
  });
}

/** Wake the service worker so a follow-up message is less likely to hit "message port closed". */
export const pingSidebarWake = () => {
  const c = getChrome();
  if (!c?.runtime?.sendMessage) return Promise.resolve();
  return sendMessageWithRetry({ action: "ping" }, 4).catch(() => {});
};

export const getModels = async (key, url) => {
  const c = getChrome();
  if (!c?.runtime?.sendMessage) {
    return Promise.reject(new Error("Extension context invalidated - Chrome APIs not available"));
  }

  const response = await sendMessageWithRetry({
    action: "fetchModels",
    url: url,
    key: key,
  });

  if (response?.error) {
    throw new Error(response.error);
  }

  let models = response?.data?.data ?? [];
  models = models
    .filter((m) => m)
    .sort((a, b) => {
      const lowerA = a.name.toLowerCase();
      const lowerB = b.name.toLowerCase();
      if (lowerA < lowerB) return -1;
      if (lowerA > lowerB) return 1;
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    });

  if (models.length > 0) {
    console.debug(`Extension: Loaded ${models.length} model(s)`);
  }
  return models;
};

/**
 * Decrypt API key via background (with retry on port closed).
 * @param {string} encryptedApiKey
 * @returns {Promise<{ decrypted?: string, error?: string }>}
 */
export const decryptApiKeyFromBackground = async (encryptedApiKey) => {
  try {
    const response = await sendMessageWithRetry({
      action: "decryptApiKey",
      encryptedApiKey: encryptedApiKey,
    });
    return response || {};
  } catch (e) {
    return { error: e?.message || String(e) };
  }
};

/**
 * Encrypt API key via background (with retry on port closed). Use when saving config.
 * @param {string} apiKey
 * @returns {Promise<{ encrypted?: string, error?: string }>}
 */
export const encryptApiKeyViaBackground = async (apiKey) => {
  try {
    const response = await sendMessageWithRetry({
      action: "encryptApiKey",
      apiKey: apiKey,
    });
    return response || {};
  } catch (e) {
    return { error: e?.message || String(e) };
  }
};

/**
 * Single round-trip for sidebar init: config (decrypted key), models, and page content.
 * Use in sidebar onMount to avoid multiple message round-trips and "message port closed" errors.
 * @returns {Promise<{ url?: string, key?: string, model?: string, models?: Array, pageContent?: string, error?: string }>}
 */
export const getSidebarInit = async () => {
  try {
    const c = getChrome();
    if (!c?.runtime?.sendMessage) {
      return { error: "Chrome APIs not available" };
    }
    const response = await sendMessageWithRetry({ action: "getSidebarInit" });
    if (response?.error) {
      return { error: response.error };
    }
    return {
      url: response.url ?? "",
      key: response.key ?? "",
      model: response.model ?? "",
      models: Array.isArray(response.models) ? response.models : [],
      pageContent: typeof response.pageContent === "string" ? response.pageContent : "",
    };
  } catch (e) {
    return { error: (e?.message && String(e.message)) || "Failed to load" };
  }
};

/**
 * Get the main text content of the currently active browser tab.
 * Used by the sidebar to include page context in the conversation.
 * Always attempts the message send so the side panel (extension context) can get page content
 * even if isChromeAPIAvailable() is false due to timing or environment.
 * @returns {Promise<{ data?: string, error?: string }>}
 */
export const getActiveTabPageContent = async () => {
  try {
    const c = getChrome();
    if (!c?.runtime?.sendMessage) {
      return { error: "Chrome APIs not available" };
    }
    const response = await sendMessageWithRetry({ action: "getActiveTabPageContent" });
    if (response?.error) {
      return { error: response.error };
    }
    return { data: response?.data ?? "" };
  } catch (e) {
    return { error: (e?.message && String(e.message)) || "Chrome APIs not available" };
  }
};

export const generateOpenAIChatCompletion = async (
  api_key = "",
  body = {},
  url = "http://localhost:8080"
) => {
  const c = getChrome();
  if (!c?.runtime?.connect) {
    return Promise.reject(new Error("Extension context invalidated - Chrome runtime.connect not available"));
  }

  // Create a port for streaming data from background script
  return new Promise((resolve, reject) => {
    const port = c.runtime.connect({ name: "chat-stream" });
    let controller = null;
    let streamEnded = false;
    
    // Create a ReadableStream that reads from the port
    const stream = new ReadableStream({
      start(ctrl) {
        controller = ctrl;
      }
    });
    
    port.onMessage.addListener((msg) => {
      if (msg.error) {
        if (controller) {
          controller.error(new Error(msg.error));
        }
        port.disconnect();
        reject(new Error(msg.error));
        return;
      }
      
      if (msg.done) {
        streamEnded = true;
        if (controller) {
          controller.close();
        }
        port.disconnect();
        return;
      }
      
      if (msg.chunk && controller) {
        controller.enqueue(new TextEncoder().encode(msg.chunk));
      }
    });
    
    port.onDisconnect.addListener(() => {
      if (!streamEnded && controller) {
        controller.error(new Error("Stream disconnected unexpectedly"));
      }
    });
    
    // Create Response-like object immediately
    const response = {
      ok: true,
      status: 200,
      body: stream,
    };
    
    // Send the fetch request
    port.postMessage({
      action: "fetchChatCompletion",
      url: url,
      api_key: api_key,
      body: body,
    });
    
    // Resolve immediately with the stream
    resolve([response, { abort: () => { port.disconnect(); } }]);
  });
};
