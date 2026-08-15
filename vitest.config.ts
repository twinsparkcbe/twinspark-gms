import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.test.ts"],
    exclude: ["node_modules", ".next"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // Real Next.js resolves "server-only" to a no-op under the
      // "react-server" bundling condition; Vitest runs plain Node, where the
      // package would otherwise throw on import.
      "server-only": path.resolve(__dirname, "./test/empty-module.ts"),
    },
  },
});
