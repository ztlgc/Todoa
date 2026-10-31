import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } },
  test: { include: ["docs/journal-remediation-2026-10-24/history.benchmark.ts"], maxWorkers: 1, testTimeout: 60000 },
});
