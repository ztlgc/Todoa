import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } },
  test: {
    include: ["docs/audit-journal-2026-10-24/*.probe.ts", "docs/audit-journal-2026-10-24/*.probe.tsx"],
    maxWorkers: 1,
    testTimeout: 10000,
  },
});
