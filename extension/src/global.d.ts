/**
 * Global type extensions for the Open WebUI Extension.
 * Avoids explicit 'any' and declares Chrome API availability in extension context.
 */
declare global {
  interface Window {
    __openwebui_extension_initialized?: boolean;
    openWebUIToggleSearch?: () => void;
  }
  interface HTMLElement {
    __svelte_app?: unknown;
  }
}

export {};
