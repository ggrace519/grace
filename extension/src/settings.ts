import "./app.css";
import Settings from "./lib/components/Settings.svelte";
import { loadAndApplyAppearance } from "./lib/appearance";

function initSettings(): InstanceType<typeof Settings> | null {
  if ((window as any).__grace_settings_initialized) return null;

  const targetElement = document.getElementById("settings-app");
  if (targetElement) {
    if ((targetElement as any).__svelte_app) {
      return (targetElement as any).__svelte_app as InstanceType<typeof Settings>;
    }
    loadAndApplyAppearance().catch(() => {});
    const app = new Settings({ target: targetElement });
    (targetElement as any).__svelte_app = app;
    (window as any).__grace_settings_initialized = true;
    return app;
  } else {
    setTimeout(initSettings, 100);
    return null;
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSettings);
} else {
  initSettings();
}
