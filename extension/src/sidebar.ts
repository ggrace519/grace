import "./app.css";
import App from "./App.svelte";
import { loadAndApplyAppearance, applyAppearance, DEFAULT_APPEARANCE } from "./lib/appearance";
import type { AppearanceSettings } from "./lib/storage";

function initSidebar(): InstanceType<typeof App> | null {
  if ((window as any).__openwebui_sidebar_initialized) return null;

  const targetElement = document.getElementById("extension-app");

  if (targetElement) {
    if ((targetElement as any).__svelte_app) {
      return (targetElement as any).__svelte_app as InstanceType<typeof App>;
    }

    loadAndApplyAppearance().catch(() => {});

    const app = new App({
      target: targetElement,
      props: { sidebarMode: true },
    });
    (targetElement as any).__svelte_app = app;
    (window as any).__openwebui_sidebar_initialized = true;

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.appearance) {
        const newValue = changes.appearance.newValue as Partial<AppearanceSettings> | undefined;
        const updated: AppearanceSettings = {
          ...DEFAULT_APPEARANCE,
          ...(newValue ?? {}),
        };
        applyAppearance(updated);
      }
    });

    return app;
  } else {
    setTimeout(initSidebar, 100);
    return null;
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSidebar);
} else {
  initSidebar();
}
