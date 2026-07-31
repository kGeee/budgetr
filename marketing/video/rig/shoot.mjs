// Runner: node shoot.mjs [shot-name] [format]
//
// Captures a shot in both deliverable formats — 16:9 desktop and 9:16 phone —
// by running the same shot script twice against differently shaped viewports.
// Pass a format to shoot just one.
//
//   cd /Users/kevingeorge/dev/budgetr-video/web
//   DEMO_DB=1 PORT=3100 npm start
//   cd -; node shoot.mjs 01-price-creep && node compose.mjs 01-price-creep

import path from "node:path";
import { FORMATS, FPS, openStage } from "./lib/capture.mjs";

const name = process.argv[2] ?? "01-price-creep";
const only = process.argv[3];
const base = process.env.BASE_URL ?? "http://localhost:3100";
const formats = only ? [only] : Object.keys(FORMATS);

const shot = await import(`./shots/${name}.mjs`);

for (const format of formats) {
  const outDir = path.join(import.meta.dirname, "out", name, format, "frames");
  const started = Date.now();
  const { browser, page, rec, fmt } = await openStage({ url: base + (shot.START ?? "/"), format, outDir });
  try {
    await shot.shoot({ page, rec, base, fmt });
  } finally {
    await browser.close();
  }
  const wall = ((Date.now() - started) / 1000).toFixed(0);
  console.log(
    `✓ ${name} [${format} ${fmt.out}]: ${rec.n} frames = ${rec.seconds.toFixed(1)}s at ${FPS}fps (${wall}s)`,
  );
}
