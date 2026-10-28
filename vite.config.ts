import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        dashboard: "index.html",
        connectionProbe: "src/platforms/shared/connectionProbe.ts",
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "connectionProbe"
            ? "connection-probe.js"
            : "assets/[name]-[hash].js",
      },
    },
  },
  test: {
    environment: "node",
  },
});
