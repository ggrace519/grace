// ============================================================================
// ENHANCEMENT: DOM Element Wait Before Mounting
// ============================================================================
// Waits for the extension-app element to exist before mounting the Svelte app.
// This prevents "Cannot read properties of undefined" errors when the content
// script runs before the DOM is fully ready. Includes retry logic.
// ============================================================================

import "./app.css";
import App from "./App.svelte";

function initApp(): InstanceType<typeof App> | null {
  // Only initialize in main frame to avoid duplicate processing when all_frames: true
  if (window !== window.top) {
    return null;
  }

  // Check global flag to prevent multiple initializations across script reloads
  if (window.__openwebui_extension_initialized) {
    return null;
  }

  const targetElement = document.getElementById("extension-app");
  if (targetElement) {
    // Check if app is already mounted on this element
    if (targetElement.__svelte_app) {
      return targetElement.__svelte_app as InstanceType<typeof App>;
    }

    const app = new App({
      target: targetElement,
    });
    // Store reference to prevent duplicate mounts
    targetElement.__svelte_app = app;
    // Set global flag to prevent re-initialization
    window.__openwebui_extension_initialized = true;
    return app;
  } else {
    console.warn("Extension app target element not found, retrying...");
    // Retry after a short delay
    setTimeout(initApp, 100);
    return null;
  }
}

// Wait for DOM to be ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  // DOM already loaded
  initApp();
}
export default initApp();

