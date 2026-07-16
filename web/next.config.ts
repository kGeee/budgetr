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
  // A LOCAL marketing-only build (MARKETING_ONLY=1) writes to a separate output
  // dir so it can be previewed without clobbering the local app's `.next` that
  // the launchd `next start` service serves. On Vercel (VERCEL=1) there's no such
  // conflict, and a non-standard distDir only confuses the platform's Next build
  // — so there we always use the standard `.next`.
  distDir: process.env.MARKETING_ONLY && !process.env.VERCEL ? ".next-marketing" : ".next",
  // The desktop shell loads the dev server via http://127.0.0.1:<port>, but Next
  // serves its dev resources (HMR / Fast Refresh client chunks) under the
  // `localhost` origin and 403s cross-origin requests by default. Without this
  // the Electron window renders but never hydrates — the UI loads frozen.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
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
