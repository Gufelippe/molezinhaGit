import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    // AudioWorklet modules must be real files: `addModule()` rejects the data
    // URIs Vite would inline small assets into.
    assetsInlineLimit: (filePath) => (filePath.includes("workletProcessor") ? false : undefined),
    rollupOptions: {
      output: {
        manualChunks: {
          supabase: ["@supabase/supabase-js"],
          mediasoup: ["mediasoup-client"],
        },
      },
    },
  },
});
