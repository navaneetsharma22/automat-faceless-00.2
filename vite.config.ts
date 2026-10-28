import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const buildId = `automat-faceless-0.1.0-${Date.now().toString(36)}`;
const environment = (
  globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }
).process?.env;
const selectedBuildId = environment?.AUTOMAT_BUILD_ID ?? buildId;
const connectorOnly = environment?.AUTOMAT_CONNECTOR_BUILD === "1";

export default defineConfig({
  plugins: [react()],
  define: {
    __AUTOMAT_BUILD_ID__: JSON.stringify(selectedBuildId),
  },
  build: {
    emptyOutDir: !connectorOnly,
    copyPublicDir: !connectorOnly,
    rollupOptions: {
      input: connectorOnly
        ? { connectionProbe: "src/platforms/shared/connectionProbe.ts" }
        : {
            dashboard: "index.html",
            background: "src/background/index.ts",
          },
      output: {
        ...(connectorOnly
          ? {
              format: "iife" as const,
              inlineDynamicImports: true,
              entryFileNames: "connection-probe.js",
              name: "AutomatFacelessConnector",
            }
          : {
              entryFileNames: (chunk: { name: string }) =>
                chunk.name === "background"
                  ? "background.js"
                  : "assets/[name]-[hash].js",
            }),
      },
    },
  },
  test: {
    environment: "node",
    exclude: ["tests/browser/**", "node_modules/**", "dist/**"],
  },
});
