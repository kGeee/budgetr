// Short #2 — "Every subscription you forgot about"
//
// NO SCRIPT EXISTS FOR THIS ONE. The pilot slate in ../../README.md gives it a
// hook, a screen and a reason ("Auto-detected, zero manual entry") and nothing
// else. The beats below are built on the five-beat template that
// ../../../scripts/02-short-price-creep.md declares itself to be —
// hook (0–3) → the pain (3–12) → the screen (12–32) → the differentiator
// (32–38) → CTA (38–42) — and the on-screen copy is drawn from what the page
// actually renders. Treat this as a proposed cut, not an approved script: the
// words want a pass before anyone records voice over them.
//
// Everything named on screen is real seeded data: Sunset Apartments $2,400,
// Equinox $188.08, Netflix $17.07, and a detected total of ~$2,829.72/period.

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

export const START = "/recurring";

async function setZoom(page, z) {
  await page.evaluate((v) => {
    document.documentElement.style.zoom = String(v);
  }, z);
}

export async function shoot({ page, rec, base, fmt }) {
  // ── 0:00–0:03 · HOOK ──────────────────────────────────────────────────
  // The total, not a subscription. The number nobody has ever added up.
  await setZoom(page, fmt.zoom.hero);
  // Read the figure off the page rather than hardcoding it. The seeder is
  // deterministic today, but a title card that quietly disagrees with the
  // screen behind it is the worst possible failure for this kind of video.
  const total = await page.evaluate(() => {
    const t = document.querySelector("main")?.innerText ?? "";
    return /~?(\$[\d,]+\.\d{2})\s*\/\s*period/i.exec(t)?.[1] ?? null;
  });
  if (!total) throw new Error("Couldn't read the per-period total off /recurring");
  console.log(`    detected recurring total: ${total} / period`);

  const hookY = await frameOn(page, "/ period", 0.32);
  await setOverlay(page, { title: total, sub: "Every month, on repeat" });
  await overlayOpacity(page, 0);
  await rec.animate(0.9, easeOut, (t) => overlayOpacity(page, t));
  await rec.pushIn(fmt.zoom.hero, fmt.zoom.heroTo, 2.1, easeInOut, hookY);

  // ── 0:03–0:12 · THE PAIN ──────────────────────────────────────────────
  // Nobody enters these by hand — so nobody has the list. Scroll the one the
  // app built for itself out of the transaction history.
  await setZoom(page, fmt.zoom.beat);
  await quiet(page);
  const depth = await scrollMax(page);
  await rec.hold(0.7);
  await rec.scroll(0, Math.min(depth, 2200), 7.6, easeInOut);
  await rec.hold(0.7);

  // ── 0:12–0:32 · THE SCREEN ────────────────────────────────────────────
  // Three of them, one beat each, cheapest last — the small ones are the ones
  // people genuinely forget.
  const beats = [
    { needle: "Sunset Apartments", title: "Rent", sub: "Detected, not entered", hold: 4.6 },
    { needle: "Equinox", title: "The gym you meant to cancel", sub: "$188.08 · monthly", hold: 5.1 },
    { needle: "Netflix", title: "And the small ones", sub: "$17.07 · every month since 2024", hold: 5.1 },
  ];

  let y = await frameOn(page, beats[0].needle);
  for (const [i, beat] of beats.entries()) {
    const to = await frameOn(page, beat.needle);
    if (i > 0) {
      await rec.scroll(y, to, 1.4, easeInOut);
    }
    y = to;
    await titleBeat(rec, page, { title: beat.title, sub: beat.sub, inSec: 0.35, holdSec: beat.hold, outSec: 0.35 });
  }

  // ── 0:32–0:38 · THE DIFFERENTIATOR ────────────────────────────────────
  await showSlate(page, {
    kicker: "SHOOT THIS BY HAND",
    title: "Finder — budgetr.db",
    sub: 'The database file on the desktop. "It found all of this by reading transactions that never left your Mac."',
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
