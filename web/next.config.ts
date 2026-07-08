import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Pin the workspace root to this directory. Otherwise Next infers it from the
// nearest lockfile and picks ~/bun.lock (the home dir), which makes Turbopack
// walk all of $HOME — dev compiles hang and prod build over-traces files.
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  turbopack: { root: projectRoot },
  outputFileTracingRoot: projectRoot,
  async headers() {
    return [
      {
        // Service worker must never be served from cache — browsers need the
        // latest version to update the cached assets correctly.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
