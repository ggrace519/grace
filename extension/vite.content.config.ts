import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Builds the in-page content script as a single IIFE file so it runs without
 * "type": "module" in the manifest. This avoids "Cannot use import statement
 * outside a module" in environments where content script modules aren't supported.
 */
export default defineConfig({
  plugins: [svelte()],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, "src/main.ts"),
      output: {
        entryFileNames: "main-content.js",
        format: "iife",
        inlineDynamicImports: true,
      },
    },
  },
});
