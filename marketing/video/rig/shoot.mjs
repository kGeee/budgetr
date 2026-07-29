// Runner: node shoot.mjs [shot-name]
//
// Captures a shot's frame sequence into out/<shot>/frames. Point it at a
// DEMO_DB server — the engine refuses anything else (lib/capture.mjs).
//
//   cd /Users/kevingeorge/dev/budgetr-video/web
//   DEMO_DB=1 PORT=3100 npm start
//   cd -; node shoot.mjs 01-price-creep && node compose.mjs 01-price-creep

import path from "node:path";
import { FPS, openStage } from "./lib/capture.mjs";

const name = process.argv[2] ?? "01-price-creep";
const base = process.env.BASE_URL ?? "http://localhost:3100";
const outDir = path.join(import.meta.dirname, "out", name, "frames");

const shot = await import(`./shots/${name}.mjs`);
const started = Date.now();

const { browser, page, rec } = await openStage({ url: base + (shot.START ?? "/"), outDir });
try {
  await shot.shoot({ page, rec, base });
} finally {
  await browser.close();
}

const wall = ((Date.now() - started) / 1000).toFixed(0);
console.log(`✓ ${name}: ${rec.n} frames = ${rec.seconds.toFixed(1)}s at ${FPS}fps (captured in ${wall}s)`);
console.log(`  ${outDir}`);
