import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const v2Root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: v2Root,
  publicDir: path.join(v2Root, "public"),
  plugins: [react()],
  build: {
    outDir: path.join(v2Root, ".build"),
    emptyOutDir: false,
    sourcemap: false,
    rollupOptions: {
      input: {
        app: path.join(v2Root, "app.html")
      }
    }
  },
  resolve: {
    alias: {
      "@app": path.join(v2Root, "src/app"),
      "@components": path.join(v2Root, "src/components"),
      "@features": path.join(v2Root, "src/features"),
      "@lib": path.join(v2Root, "src/lib"),
      types: path.join(v2Root, "src/types")
    }
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: [path.join(v2Root, "testing/setup.ts")]
  }
});
