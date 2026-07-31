// Short #4 — "Where does Apple's money actually go?"
// Implements ../../../scripts/03-short-fundamentals-sankey.md beat for beat.
//
//   0:00–0:04  HOOK       empty ticker box → type AAPL → the Sankey builds
//   0:04–0:20  THE FLOW   let the diagram breathe; this is a *watch it* video
//   0:20–0:30  THE PAYOFF the three margin tiles, then flip to Annual
//   0:30–0:34  WIDER      it's a screen inside a personal finance app
//   0:34–0:38  CTA        the live demo, not the price
//
// TWO SCRIPT CORRECTIONS, both forced by what the page actually does:
//
// 1. The script's hook says "ninety-four billion dollars last quarter" and its
//    payoff says "flip to annual". Neither survives contact: the period toggle
//    doesn't exist until a company is loaded, so the shot cannot open on
//    Quarterly, and the default view is annual — FY2025, revenue $416.2B, not
//    $94B. So this flips to QUARTERLY at the toggle beat, and the shoot prints
//    the figures the take actually shows so the voiceover can quote the take
//    rather than the other way round. The VO needs the number and the direction
//    changed before anyone records it.
//
// 2. The ticker is TYPED, not navigated to. "No keys, no account, no setup" is
//    the whole pitch of this one, and watching someone type four letters and get
//    a diagram is the proof. A pre-loaded URL proves nothing.

import { easeInOut, easeOut, frameOn, overlayOpacity, quiet, setOverlay, titleBeat } from "../lib/capture.mjs";

export const START = "/fundamentals";

const TICKER = "AAPL";

export async function shoot({ page, rec, base, fmt }) {
  // ── 0:00–0:04 · HOOK ──────────────────────────────────────────────────
  const box = page.locator('input[placeholder*="Ticker"]').first();
  await box.click();
  await rec.hold(0.5);

  // Type it on camera, a frame per keystroke — four letters, then the wait.
  for (const ch of TICKER) {
    await box.press(ch);
    await rec.hold(0.18);
  }
  await box.press("Enter");

  // The filing is fetched live from SEC. Hold on the wait rather than skipping
  // it: the build IS the hook, and a cut that hides the load is a cut that
  // hides how fast it is.
  await page.waitForTimeout(2200);
  await rec.hold(1.2);

  // Report what the take actually says, so the voiceover can quote the take.
  const headline = await page.evaluate(() => {
    const t = document.querySelector("main")?.innerText ?? "";
    return {
      revenue: /Revenue\s+\$?([\d.]+[BMT])/i.exec(t)?.[1] ?? "?",
      net: /Net income\s+\$?([\d.]+[BMT])/i.exec(t)?.[1] ?? "?",
      period: /(FY\d{4}|Q\d\s*\d{4})/i.exec(t)?.[1] ?? "?",
      margins: [...t.matchAll(/(\d+\.\d)%/g)].map((m) => m[1] + "%").slice(0, 3),
    };
  });
  console.log(`    ${TICKER} ${headline.period}: revenue $${headline.revenue}, net $${headline.net}, margins ${headline.margins.join(" / ")}`);

  // ── 0:04–0:20 · THE FLOW ──────────────────────────────────────────────
  // "Resist cutting away from it." One continuous 16s on the diagram, with a
  // slow push-in so it isn't a still, and three titles naming the branches in
  // the order the voiceover walks them.
  await frameOn(page, "Revenue", 0.42);
  await rec.pushIn(fmt.zoom.beat, fmt.zoom.beat * 1.06, 3.2, easeInOut);
  // Titles ride at the TOP through this section. The diagram is the star and it
  // fills the lower frame — a bottom band would bury the tail ribbons, which is
  // the exact thing the voiceover is pointing at.
  for (const [title, sub, hold] of [
    ["Revenue in", "Cost of revenue out the bottom", 3.4],
    ["R&D. Sales and admin.", "What survives is operating income", 3.4],
    ["Then tax", "The thin ribbon at the end is what they keep", 3.4],
  ]) {
    await titleBeat(rec, page, { title, sub, anchor: "top", inSec: 0.35, holdSec: hold, outSec: 0.35 });
  }

  // ── 0:20–0:30 · THE PAYOFF ────────────────────────────────────────────
  await frameOn(page, "GROSS MARGIN", 0.4);
  await titleBeat(rec, page, {
    title: headline.margins.join("  ·  "),
    sub: "Computed from the filing, not from anyone's summary",
    inSec: 0.4,
    holdSec: 4.2,
    outSec: 0.4,
  });

  // Flip the period and let the diagram re-flow on camera. The toggle only
  // exists once a company is loaded, which is why it can't open here.
  const quarterly = page.getByText("Quarterly", { exact: true }).first();
  if (await quarterly.count()) {
    await quarterly.click();
    await page.waitForTimeout(1400);
  }
  await frameOn(page, "Revenue", 0.42);
  await titleBeat(rec, page, {
    title: "Any US-listed ticker",
    sub: "Annual or quarterly — it redraws",
    inSec: 0.35,
    holdSec: 2.7,
    outSec: 0.35,
  });

  // ── 0:30–0:34 · THE HOOK BEHIND THE HOOK ──────────────────────────────
  // "Cut wide to the full app." On the phone layout there's no sidebar to
  // reveal, so the reveal is the Overview screen itself.
  await page.goto(`${base}/overview`, { waitUntil: "networkidle" });
  await quiet(page);
  await rec.hold(1.1);
  await titleBeat(rec, page, {
    title: "It's one screen in a finance app",
    sub: "Spending · net worth · portfolio",
    inSec: 0.4,
    holdSec: 2.1,
    outSec: 0.4,
  });

  // ── 0:34–0:38 · CTA ───────────────────────────────────────────────────
  // The live demo, not pricing — cold audience, cheap next step. And never a
  // price on camera (../../README.md rule 4).
  await setOverlay(page, { title: "try it — no signup", sub: "Runs on your Mac · nothing uploaded" });
  await overlayOpacity(page, 0);
  await rec.animate(0.5, easeOut, (t) => overlayOpacity(page, t));
  await rec.hold(3.1);
  await rec.animate(0.4, easeOut, (t) => overlayOpacity(page, 1 - t));
}
