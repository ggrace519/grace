import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [svelte()],
  base: "./",
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        sidebar: resolve(__dirname, "sidebar.html"),
      },
      output: {
        dir: "dist/",
        entryFileNames: "[name].js",
        assetFileNames: "style.css",
        chunkFileNames: "chunk.js",
      },
    },
  },
});
