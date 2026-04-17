// ============================================================================
// Settings Entry Point
// ============================================================================
// This file serves as the entry point for the Chrome Extension Settings page.
// ============================================================================

import "./app.css";
import Settings from "./lib/components/Settings.svelte";

function initSettings(): InstanceType<typeof Settings> | null {
  const targetElement = document.getElementById("settings-app");

  if (targetElement) {
    const app = new Settings({
      target: targetElement,
    });
    return app;
  } else {
    console.warn("Settings app target element not found, retrying...");
    setTimeout(initSettings, 100);
    return null;
  }
}

// Wait for DOM to be ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSettings);
} else {
  initSettings();
}

export default initSettings();
