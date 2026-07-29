// Short #1 — "Netflix went up 35% and told nobody"
// Shoots the five beats in ../../../scripts/02-short-price-creep.md, in order,
// as one continuous frame sequence. Beat boundaries and durations below are the
// script's, not invented here — if the script changes, change them here.
//
//   0:00–0:03  HOOK             price-creep card, pushed in
//   0:03–0:12  THE PAIN         a wall of near-identical charges
//   0:12–0:32  THE SCREEN       the three detectors, one beat each
//   0:32–0:38  DIFFERENTIATOR   Finder + budgetr.db  ← slate; see below
//   0:38–0:42  CTA              Overview, clean
//
// The differentiator beat is a slate rather than footage: it calls for a Finder
// window showing the database file, which is not something the web app can be
// driven into showing. It's held at the right length so the cut still times out
// to 42 seconds with the real shot dropped in.

import {
  easeInOut,
  easeOut,
  frameOn,
  hideSlate,
  overlayOpacity,
  quiet,
  scrollMax,
  scrollSet,
  setOverlay,
  showSlate,
  titleBeat,
} from "../lib/capture.mjs";

export const START = "/insights";

async function setZoom(page, z) {
  await page.evaluate((v) => {
    document.documentElement.style.zoom = String(v);
  }, z);
}

export async function shoot({ page, rec, base }) {
  // ── 0:00–0:03 · HOOK ──────────────────────────────────────────────────
  // "The first frame is already the app." No logo, no intro — open on the
  // card itself, pushed in, and let the number do the work. The overlay is
  // the before/after pair the production notes call the most important frame.
  // Zoom first, then frame: `zoom` reflows, so a position chosen at 1.0 is
  // wrong by the time it's applied at 1.45.
  await setZoom(page, 1.45);
  const hookY = await frameOn(page, "Netflix went up 35%", 0.3);
  await setOverlay(page, { title: "$17.07 → $22.99", sub: "Netflix went up 35%" });
  await overlayOpacity(page, 0);
  await rec.animate(0.9, easeOut, (t) => overlayOpacity(page, t));
  await rec.pushIn(1.45, 1.56, 2.1, easeInOut, hookY);

  // ── 0:03–0:12 · THE PAIN ──────────────────────────────────────────────
  // "Four hundred lines." The transaction ledger, scrolled slowly enough to
  // read but fast enough to feel endless.
  await page.goto(`${base}/transactions`, { waitUntil: "networkidle" });
  await quiet(page);
  await setOverlay(page, { title: "", sub: "" });
  const depth = await scrollMax(page);
  await rec.hold(0.6);
  await rec.scroll(0, Math.min(depth, 2600), 7.8, easeInOut);
  await rec.hold(0.6);

  // ── 0:12–0:32 · THE SCREEN ────────────────────────────────────────────
  // Back to Insights for the longest beat: the detector that found it, then
  // the other two, one beat each. Zoomed enough that the numbers are legible
  // on a phone screen held at arm's length.
  await page.goto(`${base}/insights`, { waitUntil: "networkidle" });
  await quiet(page);

  // Holds are long because the narration over this section is long — three
  // sentences across 20 seconds. Total here must come to 20s: two glides at
  // 1.5s, six fades at 0.35s, and the holds below.
  const beats = [
    { needle: "Netflix went up 35%", title: "Price creep", sub: "Flagged the day it happened", hold: 5.3 },
    { needle: "6.8× your usual at Amazon", title: "Spending spikes", sub: "Against your own baseline", hold: 4.8 },
    { needle: "Two $42.60 charges", title: "Duplicate charges", sub: "Two days apart, same pharmacy", hold: 4.8 },
  ];

  await setZoom(page, 1.25);
  let y = 0;
  for (const [i, beat] of beats.entries()) {
    // Measure by moving there and reading back, then return so the glide has a
    // real start and end in the same coordinate space.
    const to = await frameOn(page, beat.needle);
    // First beat cuts straight in; the rest glide, so the section reads as one
    // continuous pass down the page rather than three separate shots.
    if (i > 0) {
      await scrollSet(page, y);
      await rec.scroll(y, to, 1.5, easeInOut);
    }
    y = to;

    await titleBeat(rec, page, { title: beat.title, sub: beat.sub, inSec: 0.35, holdSec: beat.hold, outSec: 0.35 });
  }

  // ── 0:32–0:38 · THE DIFFERENTIATOR ────────────────────────────────────
  await showSlate(page, {
    kicker: "SHOOT THIS BY HAND",
    title: "Finder — budgetr.db",
    sub: "A Finder window on the database file, then drag it to the Trash. \"No account, no cloud, nothing uploaded — the whole app is a file you own.\"",
  });
  await rec.hold(6);
  await hideSlate(page);

  // ── 0:38–0:42 · CTA ───────────────────────────────────────────────────
  // Land on a clean Overview. No price on camera, ever (README rule 4).
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
