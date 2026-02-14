// Helper function to check if Chrome APIs are available
const isChromeAPIAvailable = () => {
  try {
    return typeof chrome !== 'undefined' &&
           chrome !== null &&
           typeof chrome.runtime !== 'undefined' &&
           chrome.runtime !== null &&
           typeof chrome.runtime.sendMessage !== 'undefined';
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

export const getModels = async (key, url) => {
  // Check Chrome API availability
  if (!isChromeAPIAvailable()) {
    return Promise.reject(new Error("Extension context invalidated - Chrome APIs not available"));
  }

  // Proxy through background script to avoid CORS
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: "fetchModels",
        url: url,
        key: key,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          const errorMessage = chrome.runtime.lastError.message;
          reject(new Error(errorMessage));
          return;
        }
        if (response.error) {
          reject(new Error(response.error));
          return;
        }

        let models = response.data?.data ?? [];
        models = models
          .filter((models) => models)
          .sort((a, b) => {
            // Compare case-insensitively
            const lowerA = a.name.toLowerCase();
            const lowerB = b.name.toLowerCase();

            if (lowerA < lowerB) return -1;
            if (lowerA > lowerB) return 1;

            // If same case-insensitively, sort by original strings,
            // lowercase will come before uppercase due to ASCII values
            if (a < b) return -1;
            if (a > b) return 1;

            return 0; // They are equal
          });

        // Log model count instead of full array to reduce console noise
        if (models.length > 0) {
          console.debug(`Extension: Loaded ${models.length} model(s)`);
        }
        resolve(models);
      }
    );
  });
};

export const generateOpenAIChatCompletion = async (
  api_key = "",
  body = {},
  url = "http://localhost:8080"
) => {
  // Check Chrome API availability
  if (!isChromeAPIAvailable() || typeof chrome.runtime.connect === 'undefined') {
    return Promise.reject(new Error("Extension context invalidated - Chrome runtime.connect not available"));
  }
  
  // Create a port for streaming data from background script
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: "chat-stream" });
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
