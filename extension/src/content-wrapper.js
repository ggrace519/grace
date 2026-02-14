// ============================================================================
// Simple wrapper to initialize Svelte app from content script context
// This file is plain JS (no ES modules) for content script compatibility
// ============================================================================

(function() {
  'use strict';

  // Prevent multiple initializations
  if (window.__openwebui_extension_initialized) {
    return;
  }

  // Wait for extension-app element
  function initApp() {
    var targetElement = document.getElementById("extension-app");
    if (!targetElement) {
      console.warn("Extension: extension-app element not found, retrying...");
      setTimeout(initApp, 100);
      return;
    }

    // Check if already mounted
    if (targetElement.__svelte_app) {
      return;
    }

    // Load the Svelte app
    // The actual Svelte initialization happens via the bundled main.js
    window.__openwebui_extension_initialized = true;
    console.log("Extension: Content script wrapper initialized");
  }

  // Start initialization
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
  } else {
    initApp();
  }
})();
