// Short #5 — the vendor merge
//
// NO SCRIPT EXISTS FOR THIS ONE, and the slate's hook doesn't match the data.
//
// ../../README.md pitches it as: "'SQ *BLUE BOTTLE' and 'BLUEBOTTLE.COM' are
// the same coffee shop". That pair isn't in the seeded data — lib/demo-data.ts
// has a single "BLUE BOTTLE" merchant, and the one vendor group it seeds merges
// "Whole Foods Market" and "Trader Joe's" into a canonical "Groceries"
// (demo-data.ts, "Vendor group"). So this shoots the merge that exists.
//
// That leaves a decision that isn't the rig's to make: either the hook changes
// to the grocery framing (weaker — two different shops legitimately grouped
// reads as a category, not as de-duplication), or the seeder gains a genuine
// alias pair so the sharper hook becomes true. The second is better copy AND
// better demo data, since messy merchant strings are the actual problem this
// feature solves. Flagged rather than papered over.
//
// Beats follow the five-beat template from
// ../../../scripts/02-short-price-creep.md. Proposed cut, not approved copy.

import {
  easeInOut,
  easeOut,
  frameOn,
  hideSlate,
  overlayOpacity,
  quiet,
  scrollMax,
  setOverlay,
  showSlate,
  titleBeat,
} from "../lib/capture.mjs";

export const START = "/vendors";

async function setZoom(page, z) {
  await page.evaluate((v) => {
    document.documentElement.style.zoom = String(v);
  }, z);
}

export async function shoot({ page, rec, base, fmt }) {
  // ── 0:00–0:03 · HOOK ──────────────────────────────────────────────────
  // The merged row, which reads "2 vendors · 88 txns" — one line that contains
  // the whole feature.
  await setZoom(page, fmt.zoom.hero);
  const hookY = await frameOn(page, "2 vendors", 0.32);
  await setOverlay(page, { title: "Two shops, one line", sub: "88 transactions, added up properly" });
  await overlayOpacity(page, 0);
  await rec.animate(0.9, easeOut, (t) => overlayOpacity(page, t));
  await rec.pushIn(fmt.zoom.hero, fmt.zoom.heroTo, 2.1, easeInOut, hookY);

  // ── 0:03–0:12 · THE PAIN ──────────────────────────────────────────────
  // 28 vendors, ranked. The scroll is the argument: a statement gives you this
  // as four hundred undifferentiated lines.
  await setZoom(page, fmt.zoom.beat);
  await quiet(page);
  const depth = await scrollMax(page);
  await rec.hold(0.7);
  await rec.scroll(0, Math.min(depth, 2400), 7.6, easeInOut);
  await rec.hold(0.7);

  // ── 0:12–0:32 · THE SCREEN ────────────────────────────────────────────
  const beats = [
    { needle: "28 vendors", title: "Grouped, not typed", sub: "Built from your transaction history", hold: 4.8 },
    { needle: "2 vendors", title: "Two names, one vendor", sub: "So the total is the real total", hold: 5.2 },
    { needle: "Amazon", title: "And the ones you'd rather not total", sub: "35 transactions", hold: 4.8 },
  ];

  let y = await frameOn(page, beats[0].needle);
  for (const [i, beat] of beats.entries()) {
    const to = await frameOn(page, beat.needle);
    if (i > 0) await rec.scroll(y, to, 1.4, easeInOut);
    y = to;
    await titleBeat(rec, page, { title: beat.title, sub: beat.sub, inSec: 0.35, holdSec: beat.hold, outSec: 0.35 });
  }

  // ── 0:32–0:38 · THE DIFFERENTIATOR ────────────────────────────────────
  await showSlate(page, {
    kicker: "SHOOT THIS BY HAND",
    title: "Finder — budgetr.db",
    sub: 'The database file on the desktop. "No account, no cloud, nothing uploaded — the whole app is a file you own."',
  });
  await rec.hold(6);
  await hideSlate(page);

  // ── 0:38–0:42 · CTA ───────────────────────────────────────────────────
  await page.goto(`${base}/overview`, { waitUntil: "networkidle" });
  await quiet(page);
  await rec.hold(0.8);
  await titleBeat(rec, page, {
    title: "budgetr",
    sub: "Runs on your Mac · buy it once",
    inSec: 0.5,
    holdSec: 2.3,
    outSec: 0.4,
  });
}
