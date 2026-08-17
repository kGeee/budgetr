import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Resolve the "@/…" path alias (tsconfig paths) for the test runner.
const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": root },
  },
  test: {
    environment: "node",
    // Component tests render to static markup with react-dom/server — no DOM
    // needed, and enough to catch a control that stopped being a control (a line
    // name that is no longer an <input>, a missing tax field). Behaviour still
    // belongs in the pure lib/ tests.
    include: ["lib/**/*.test.ts", "components/**/*.test.tsx"],
  },
});
