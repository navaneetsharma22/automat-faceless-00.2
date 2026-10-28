import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const buildId = `automat-faceless-0.1.0-${Date.now().toString(36)}`;

export default defineConfig({
  plugins: [react()],
  define: {
    __AUTOMAT_BUILD_ID__: JSON.stringify(buildId),
  },
  build: {
    rollupOptions: {
      input: {
        dashboard: "index.html",
        background: "src/background/index.ts",
        connectionProbe: "src/platforms/shared/connectionProbe.ts",
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "background"
            ? "background.js"
            : chunk.name === "connectionProbe"
              ? "connection-probe.js"
              : "assets/[name]-[hash].js",
      },
    },
  },
  test: {
    environment: "node",
    exclude: ["tests/browser/**", "node_modules/**", "dist/**"],
  },
});
