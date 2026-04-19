// ============================================================================
// Sidebar Entry Point
// ============================================================================
// This file serves as the entry point for the Chrome Side Panel.
// It mounts the same App component but in sidebar mode.
// ============================================================================

import "./app.css";
import App from "./App.svelte";

console.log("Sidebar: Starting initialization...");

function initSidebar(): InstanceType<typeof App> | null {
  console.log("Sidebar: initSidebar called");

  // Check global flag to prevent multiple initializations
  if (window.__openwebui_sidebar_initialized) {
    console.log("Sidebar: Already initialized, skipping");
    return null;
  }

  const targetElement = document.getElementById("extension-app");
  console.log("Sidebar: Target element:", targetElement);

  if (targetElement) {
    // Check if app is already mounted on this element
    if (targetElement.__svelte_app) {
      console.log("Sidebar: App already mounted");
      return targetElement.__svelte_app as InstanceType<typeof App>;
    }

    console.log("Sidebar: Creating new App instance with sidebarMode: true");
    const app = new App({
      target: targetElement,
      props: {
        sidebarMode: true
      }
    });
    // Store reference to prevent duplicate mounts
    targetElement.__svelte_app = app;
    // Set global flag to prevent re-initialization
    window.__openwebui_sidebar_initialized = true;
    console.log("Sidebar: App initialized successfully");
    return app;
  } else {
    console.warn("Extension sidebar target element not found, retrying...");
    setTimeout(initSidebar, 100);
    return null;
  }
}

// Wait for DOM to be ready
if (document.readyState === "loading") {
  console.log("Sidebar: DOM loading, waiting for DOMContentLoaded");
  document.addEventListener("DOMContentLoaded", initSidebar);
} else {
  console.log("Sidebar: DOM already loaded, initializing");
  initSidebar();
}
