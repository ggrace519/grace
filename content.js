/* global document, window, chrome, console, setInterval, clearInterval, setTimeout */
// ============================================================================
// ENHANCEMENT: DOM Ready Initialization
// ============================================================================
// Waits for document.body to exist before initializing the extension to prevent
// "Cannot read properties of null" errors. Includes retry logic and safety
// timeouts. Prevents duplicate initializations.
// ============================================================================

// Prevent multiple initializations
let initialized = false;
let checkBodyInterval = null;

// Injects a CSS file into the page. Placed at function body root for consistent behavior.
function injectCSS(file) {
  try {
    const existingLink = document.querySelector(`link[href="${file}"]`);
    if (!existingLink) {
      const link = document.createElement("link");
      link.href = file;
      link.type = "text/css";
      link.rel = "stylesheet";
      const head = document.head || document.getElementsByTagName("head")[0];
      if (head) {
        head.appendChild(link);
      } else {
        console.warn("Extension: Could not find head element");
      }
    }
  } catch (error) {
    console.error("Extension: Error injecting CSS:", error);
  }
}

// Wait for DOM to be ready before initializing
function initExtension() {
  // Only initialize in main frame to avoid duplicate processing when all_frames: true
  if (window !== window.top) {
    return;
  }

  // Prevent multiple calls
  if (initialized) {
    return;
  }

  try {
    // Ensure body exists
    if (!document.body) {
      console.warn("Extension: document.body not available yet");
      return;
    }

    // Create a div to host the Svelte app (only if it doesn't exist)
    if (!document.getElementById("extension-app")) {
      const appDiv = document.createElement("div");
      appDiv.id = "extension-app";
      document.body.appendChild(appDiv);
    }

    injectCSS(chrome.runtime.getURL("extension/dist/style.css"));

    // App (main.js) is loaded as a content script in manifest so it runs with Chrome APIs.
    // Do not inject via script tag — that runs in page context without chrome.

    initialized = true;
  } catch (error) {
    console.error("Extension: Error initializing:", error);
  }
}

// ============================================================================
// Rovo-style: Provide page context to side panel via message
// ============================================================================
// Listens for "getPageContent" from the background. When the side panel requests
// page context, the background asks this content script (which runs in the tab)
// to extract and return content, avoiding scripting.executeScript for that path.
// ============================================================================

function extractPageContentInTab() {
  function isVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      element.offsetWidth > 0 &&
      element.offsetHeight > 0;
  }

  function shouldExclude(element) {
    if (!element) return true;
    const tagName = element.tagName.toLowerCase();
    const id = (element.id || "").toLowerCase();
    const className = (element.className || "").toLowerCase();

    if (tagName === "nav" || tagName === "header" || tagName === "footer" ||
        tagName === "aside" || tagName === "script" || tagName === "style" ||
        tagName === "noscript" || tagName === "iframe") {
      return true;
    }

    if (id.includes("ad") || className.includes("ad") ||
        className.includes("advertisement") || className.includes("sidebar") ||
        className.includes("cookie") || className.includes("popup") ||
        className.includes("modal") || className.includes("overlay")) {
      return true;
    }

    const role = element.getAttribute("role");
    if (role === "navigation" || role === "banner" || role === "complementary") {
      return true;
    }

    return false;
  }

  try {
    // Strategy 1: semantic HTML5
    let mainContent = document.querySelector("main, article, [role=\"main\"]");
    if (mainContent && isVisible(mainContent)) {
      const excluded = mainContent.querySelectorAll("nav, header, footer, aside, .ad, .advertisement, [id*=\"ad\"], [class*=\"ad\"]");
      excluded.forEach((el) => el.remove());
      const text = (mainContent.innerText || mainContent.textContent || "").trim();
      if (text.length > 100) return text;
    }

    // Strategy 2: common content selectors
    const contentSelectors = [
      ".content", ".post", ".entry", ".article", ".article-content",
      ".main-content", ".post-content", ".entry-content", ".article-body",
      "#content", "#main", "#article", "#post"
    ];
    for (const selector of contentSelectors) {
      const element = document.querySelector(selector);
      if (element && isVisible(element) && !shouldExclude(element)) {
        const clone = element.cloneNode(true);
        const excluded = clone.querySelectorAll("nav, header, footer, aside, .ad, .advertisement, [id*=\"ad\"], [class*=\"ad\"]");
        excluded.forEach((el) => el.remove());
        const text = (clone.innerText || clone.textContent || "").trim();
        if (text.length > 100) return text;
      }
    }

    // Strategy 3: body with exclusions
    const body = document.body.cloneNode(true);
    const bodyExcluded = body.querySelectorAll("nav, header, footer, aside, script, style, .ad, .advertisement, [id*=\"ad\"], [class*=\"ad\"], [role=\"navigation\"], [role=\"banner\"]");
    bodyExcluded.forEach((el) => el.remove());
    const allElements = body.querySelectorAll("*");
    allElements.forEach((el) => {
      if (!isVisible(el)) el.remove();
    });
    let text = (body.innerText || body.textContent || "").trim();
    text = text.replace(/\s+/g, " ").substring(0, 50000);
    if (text.length >= 50) return text;

    // Strategy 4: product/content areas
    const productSelectors = [
      "[itemprop=\"description\"]", ".product-description", ".product-details",
      ".product-info", ".product-content", "[data-product]", ".description",
      ".details", ".specifications", ".features"
    ];
    for (const selector of productSelectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        if (element && isVisible(element)) {
          const elementText = (element.innerText || element.textContent || "").trim();
          if (elementText.length >= 50) {
            return elementText.replace(/\s+/g, " ").substring(0, 50000);
          }
        }
      }
    }

    return text || "";
  } catch (err) {
    return (document.body && (document.body.innerText || document.body.textContent || "").trim()) || "";
  }
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action !== "getPageContent") return false;
    // Only main frame should respond so the side panel gets the tab's main page content.
    if (window !== window.top) return false;
    try {
      const data = extractPageContentInTab();
      sendResponse({ data: data || "" });
    } catch (e) {
      sendResponse({ error: (e && e.message) || "Failed to extract content" });
    }
    return true;
  });
}

// Run immediately if DOM is ready, otherwise wait
if (document.body) {
  initExtension();
} else {
  // Wait for DOM to be ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      initExtension();
    }, { once: true });
  } else {
    // DOM already loaded, but body might not exist yet
    checkBodyInterval = setInterval(() => {
      if (document.body) {
        clearInterval(checkBodyInterval);
        checkBodyInterval = null;
        initExtension();
      }
    }, 10);
    
    // Safety timeout
    setTimeout(() => {
      if (checkBodyInterval) {
        clearInterval(checkBodyInterval);
        checkBodyInterval = null;
      }
      if (document.body && !initialized) {
        initExtension();
      }
    }, 5000);
  }
}
