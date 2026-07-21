import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Pin the workspace root explicitly. Otherwise Next infers it from the
// nearest lockfile and picks ~/bun.lock (the home dir), which makes Turbopack
// walk all of $HOME — dev compiles hang and prod build over-traces files.
// The root is the REPO root (one level up), not web/: the @budgetr/* packages
// are file:-linked from ../packages, and Turbopack refuses to resolve through
// symlinks that escape its root.
const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(projectRoot);

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  // The output dir is ALWAYS the standard `.next` — that's what deploy platforms
  // (Vercel) expect. Only an explicit local opt-in, MARKETING_PREVIEW=1, writes
  // to a separate `.next-marketing` dir: that's for previewing the marketing
  // build ON THIS MACHINE without clobbering the `.next` the launchd `next start`
  // service serves. It is deliberately NOT keyed off MARKETING_ONLY (which sets
  // the marketing *behaviour* and IS set on Vercel) — a distDir that depends on
  // ambient env is exactly what broke the Vercel build (it looked for `.next`
  // but found `.next-marketing`). Local marketing preview: MARKETING_ONLY=1
  // MARKETING_PREVIEW=1 npm run build.
  distDir: process.env.MARKETING_PREVIEW ? ".next-marketing" : ".next",
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
