// Capture engine for the video rig.
//
// Records a *frame sequence*, not a screen recording. Every frame is an
// explicit screenshot, so motion is exactly what the shot script asked for —
// no dropped frames, no variable timing, and a re-run six months from now
// produces an identical file. That reproducibility is the whole point of
// filming against the seeded demo persona (see ../../README.md, rule 1).
//
// The trade is speed: a 42-second short is ~1,260 screenshots and takes a few
// minutes to capture. Worth it for footage you don't have to re-shoot.

import { chromium } from "playwright-core";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const FPS = 30;

/**
 * Find the Chromium that Playwright already downloaded, rather than pulling a
 * second copy. CHROME_PATH overrides for anyone whose cache lives elsewhere.
 */
export function resolveChromium() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
  const builds = fs
    .readdirSync(cache)
    .filter((d) => d.startsWith("chromium-") && !d.includes("headless"))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  if (!builds.length) throw new Error(`No chromium build in ${cache} — run: npx playwright install chromium`);
  for (const b of builds) {
    const exe = path.join(cache, b, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (fs.existsSync(exe)) return exe;
    const intel = path.join(cache, b, "chrome-mac/Chromium.app/Contents/MacOS/Chromium");
    if (fs.existsSync(intel)) return intel;
  }
  throw new Error("Found a chromium- directory but no executable inside it.");
}

/**
 * Refuse to film anything but the demo.
 *
 * Two independent checks, because getting this wrong means publishing someone's
 * real account balances:
 *   1. Port 3000 is the launchd service in the main worktree, serving the real
 *      database. It is never a valid capture target.
 *   2. The page must carry the web-demo CTA, which only renders when DEMO_DB is
 *      set — and DEMO_DB means the database is :memory:, so there is no file on
 *      disk it could have read.
 */
export async function assertDemoTarget(page, url) {
  if (new URL(url).port === "3000") {
    throw new Error("Refusing to capture port 3000 — that's the live service on the real database.");
  }
  const proof = await page.locator("text=Download budgetr").count();
  if (proof === 0) {
    throw new Error(
      "Target doesn't look like the web demo (no 'Download budgetr' CTA). " +
        "Start it with DEMO_DB=1 so the database is in-memory.",
    );
  }
}

/** Cubic ease-in-out — the default for camera moves; nothing starts or stops abruptly. */
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);
export const linear = (t) => t;

export class Recorder {
  constructor(page, dir) {
    this.page = page;
    this.dir = dir;
    this.n = 0;
    this.last = null;
  }

  #next() {
    return path.join(this.dir, `f${String(this.n++).padStart(6, "0")}.jpg`);
  }

  /** One screenshot = one frame. */
  async frame() {
    const p = this.#next();
    await this.page.screenshot({ path: p, type: "jpeg", quality: 92 });
    this.last = p;
    return p;
  }

  /**
   * Hold the current image. Copies the last frame rather than re-screenshotting:
   * a static beat is identical by definition, and copying is ~50x faster.
   */
  async hold(seconds) {
    if (!this.last) await this.frame();
    const src = this.last;
    for (let i = 0; i < Math.round(seconds * FPS); i++) {
      await fsp.copyFile(src, this.#next());
    }
  }

  /**
   * Drive `fn(t)` across `seconds`, capturing a frame after each step.
   * `t` runs 0→1 through the supplied easing.
   */
  async animate(seconds, ease, fn) {
    const total = Math.round(seconds * FPS);
    for (let i = 0; i < total; i++) {
      await fn(ease(total === 1 ? 1 : i / (total - 1)));
      await this.frame();
    }
  }

  /** Smooth scroll of the tagged scroll container. */
  async scroll(from, to, seconds, ease = easeInOut) {
    await this.animate(seconds, ease, (t) => scrollSet(this.page, from + (to - from) * t));
  }

  /**
   * Push in on the page. Uses CSS `zoom` rather than a transform: a transform
   * on a scroll container fights the scroll position, whereas zoom reflows and
   * keeps text crisp at any scale.
   *
   * Zoom changes the scroller's slack, so the scroll offset is re-pinned every
   * frame — otherwise the subject drifts up the frame as the page grows under it.
   */
  async pushIn(fromZoom, toZoom, seconds, ease = easeInOut, holdY = null) {
    await this.animate(seconds, ease, async (t) => {
      await this.page.evaluate((z) => {
        document.documentElement.style.zoom = String(z);
      }, fromZoom + (toZoom - fromZoom) * t);
      if (holdY !== null) await scrollSet(this.page, holdY);
    });
  }

  get seconds() {
    return this.n / FPS;
  }
}

/**
 * Overlay text, drawn *into* the page before the screenshot rather than
 * composited afterwards. It costs nothing extra and inherits the app's own
 * typography — `font-display` here is the same Fraunces the product ships, so
 * the titles can't drift from the brand.
 */
export async function setOverlay(page, { title = "", sub = "", align = "center" } = {}) {
  await page.evaluate(
    ({ title, sub, align }) => {
      let el = document.getElementById("__rig_overlay");
      if (!el) {
        el = document.createElement("div");
        el.id = "__rig_overlay";
        document.body.appendChild(el);
      }
      // A gradient scrim, not just a text-shadow. Titles land over live app
      // chrome whose brightness we don't control shot to shot; a shadow is a
      // gamble, a scrim is a guarantee. It occupies the bottom third, which is
      // also why shots place their subject in the upper half.
      el.style.cssText = `
        position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;
        display: flex; flex-direction: column; gap: 14px;
        align-items: ${align === "center" ? "center" : "flex-start"};
        justify-content: flex-end; padding: 0 72px 88px;
        opacity: 0; transition: none;
        background: linear-gradient(to top,
          rgba(8,11,10,.97) 0%, rgba(8,11,10,.93) 26%,
          rgba(8,11,10,.72) 42%, rgba(8,11,10,0) 62%);
      `;
      el.innerHTML = `
        ${title ? `<div class="font-display" style="font-size:76px;line-height:1.03;letter-spacing:-.025em;color:#ece7da">${title}</div>` : ""}
        ${sub ? `<div style="font-size:30px;line-height:1.3;color:#cbb07c;font-weight:600">${sub}</div>` : ""}
      `;
    },
    { title, sub, align },
  );
}

export async function overlayOpacity(page, o) {
  await page.evaluate((v) => {
    const el = document.getElementById("__rig_overlay");
    if (el) el.style.opacity = String(v);
  }, o);
}

/** Fade the overlay in, hold it, fade it out — the standard title beat. */
export async function titleBeat(rec, page, { title, sub, inSec = 0.4, holdSec = 2, outSec = 0.4 }) {
  await setOverlay(page, { title, sub });
  await rec.animate(inSec, easeOut, (t) => overlayOpacity(page, t));
  await rec.hold(holdSec);
  await rec.animate(outSec, easeOut, (t) => overlayOpacity(page, 1 - t));
}

/**
 * A full-bleed slate, for a beat the rig can't shoot itself. Better than
 * silently omitting the shot: the rough cut stays the right length and the
 * editor is told exactly what to drop in.
 */
export async function showSlate(page, { kicker = "MISSING SHOT", title = "", sub = "" }) {
  await page.evaluate(
    ({ kicker, title, sub }) => {
      let el = document.getElementById("__rig_slate");
      if (!el) {
        el = document.createElement("div");
        el.id = "__rig_slate";
        document.body.appendChild(el);
      }
      el.style.cssText = `
        position: fixed; inset: 0; z-index: 2147483646; background: #080b0a;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 22px; padding: 0 140px; text-align: center;
      `;
      el.innerHTML = `
        <div style="font-size:15px;letter-spacing:3.5px;color:#cbb07c;font-weight:700">${kicker}</div>
        <div class="font-display" style="font-size:64px;line-height:1.1;color:#ece7da">${title}</div>
        <div style="font-size:24px;line-height:1.45;color:#8b948c;max-width:900px">${sub}</div>
      `;
    },
    { kicker, title, sub },
  );
}

export async function hideSlate(page) {
  await page.evaluate(() => document.getElementById("__rig_slate")?.remove());
}

/**
 * Find whatever actually scrolls and mark it.
 *
 * The app is an app-shell layout: the window barely scrolls at all, and the
 * page content lives in an inner `overflow-y-auto` column. `window.scrollTo`
 * against it is a silent no-op — it moves ~170px and then stops, which reads on
 * camera as "the rig is broken" rather than as an error. So: pick the element
 * with the most scroll slack, tag it, and drive that.
 */
export async function tagScroller(page) {
  return page.evaluate(() => {
    document.querySelectorAll("[data-rig-scroller]").forEach((e) => e.removeAttribute("data-rig-scroller"));
    const main = document.querySelector("main");
    let best = null;
    let bestSlack = 0;
    for (const el of document.querySelectorAll("*")) {
      const s = getComputedStyle(el);
      if (!["auto", "scroll"].includes(s.overflowY)) continue;
      // The sidebar nav scrolls too, and at high zoom it has MORE slack than
      // anything else on the page — "most slack" alone picks the nav and pans
      // the menu while the content sits still. Only a scroller that contains
      // <main> is the shot.
      if (main && !el.contains(main)) continue;
      const slack = el.scrollHeight - el.clientHeight;
      if (slack > bestSlack) {
        best = el;
        bestSlack = slack;
      }
    }
    // This app's content column has no scroller of its own — the shell is
    // min-h-dvh and the document scrolls. That's the common case, not a fallback.
    const docSlack = document.documentElement.scrollHeight - window.innerHeight;
    const target = !best || docSlack > bestSlack ? document.documentElement : best;
    target.setAttribute("data-rig-scroller", "");
    return { tag: target.tagName, cls: String(target.className).slice(0, 40), slack: Math.max(bestSlack, docSlack) };
  });
}

/**
 * Read the current offset, and whether the scroller is the viewport.
 *
 * One round trip rather than three, because this runs on every frame of every
 * scroll and a 40-second shot is 1,200 of them.
 */
async function scrollState(page) {
  return page.evaluate(() => {
    const sc = document.querySelector("[data-rig-scroller]") ?? document.scrollingElement;
    const root = sc === document.documentElement;
    return {
      root,
      top: root ? window.scrollY : sc.scrollTop,
      max: root
        ? document.documentElement.scrollHeight - window.innerHeight
        : sc.scrollHeight - sc.clientHeight,
    };
  });
}

export async function scrollGet(page) {
  return (await scrollState(page)).top;
}

export async function scrollMax(page) {
  return (await scrollState(page)).max;
}

/**
 * Move the viewport to an absolute offset — by wheeling, not by assignment.
 *
 * With CSS `zoom` on the root, Chromium ignores programmatic scrolling
 * entirely: `window.scrollTo`, `documentElement.scrollTop` and
 * `body.scrollTop` all silently leave scrollY at 0, while a real wheel event
 * scrolls exactly as asked. Since every push-in shot zooms, the rig has to
 * scroll the way a person does. (An inner scroll container — the sidebar — is
 * unaffected and still takes a plain assignment.)
 *
 * The pointer must be parked over the content column before any of this: wheel
 * events go to whatever is under the cursor, and over the nav they pan the menu
 * instead of the page.
 */
export async function scrollSet(page, y) {
  const { root, top, max } = await scrollState(page);
  const want = Math.max(0, Math.min(y, max));
  if (!root) {
    await page.evaluate((v) => {
      const sc = document.querySelector("[data-rig-scroller]");
      if (sc) sc.scrollTop = v;
    }, want);
    return;
  }
  const delta = want - top;
  if (Math.abs(delta) < 0.5) return;
  await page.mouse.wheel(0, delta);
  // A wheel event is dispatched, not applied: the scroll lands a beat later, on
  // the compositor. Without this wait, every read comes back pre-scroll and
  // every frame is captured one step behind the motion it's meant to show —
  // which looks exactly like "scrolling is broken" rather than "scrolling is
  // late". Tolerance because zoomed layouts land on fractional offsets.
  await page
    .waitForFunction((t) => Math.abs(window.scrollY - t) <= 2, want, { timeout: 500, polling: "raf" })
    .catch(() => {});
}

/**
 * Park the smallest element containing `needle` at `place` down the frame
 * (0.5 = centred, 0.34 = above the title scrim) and return the offset used.
 *
 * Smallest, not first: every wrapper up to <main> also "contains" the text, and
 * centring on those centres on the whole page.
 */
export async function frameOn(page, needle, place = 0.34) {
  const want = await page.evaluate(
    ({ t, place }) => {
      const sc = document.querySelector("[data-rig-scroller]") ?? document.scrollingElement;
      const root = sc === document.documentElement;
      const hits = [...document.querySelectorAll("div,li,article")].filter((e) =>
        (e.textContent || "").includes(t),
      );
      if (!hits.length) throw new Error(`No element containing ${JSON.stringify(t)}`);
      const el = hits.reduce((best, e) => {
        const a = e.getBoundingClientRect();
        const b = best.getBoundingClientRect();
        return a.width * a.height < b.width * b.height ? e : best;
      });
      const r = el.getBoundingClientRect();
      const top = root ? window.scrollY : sc.scrollTop;
      const viewH = root ? window.innerHeight : sc.clientHeight;
      const originTop = root ? 0 : sc.getBoundingClientRect().top;
      return top + (r.top - originTop) + r.height / 2 - viewH * place;
    },
    { t: needle, place },
  );
  await scrollSet(page, want);
  return scrollGet(page);
}

/**
 * Everything that has to be re-applied after a navigation: style tags don't
 * survive a page load, so forgetting this is how a scrollbar or a demo banner
 * turns up in one shot and not the next.
 */
export async function quiet(page) {
  await page.addStyleTag({
    content: `
      ::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
      * { caret-color: transparent !important; }
    `,
  });
  await page.evaluate(() => {
    // The demo banner is the proof we're on DEMO_DB (assertDemoTarget reads its
    // CTA), but it's not something a viewer should be reading. It carries no
    // stable hook to select on, so dismiss it the way the app does — the key is
    // components/demo-banner.tsx's DISMISS_KEY — and hide the instance already
    // rendered, since the component only reads that key on mount.
    try {
      sessionStorage.setItem("budgetr:demo-banner-dismissed", "1");
    } catch {}
    const banner = [...document.querySelectorAll("div")]
      .filter((e) => (e.textContent || "").includes("This is a live demo") && e.children.length <= 5)
      .pop();
    if (banner) banner.style.display = "none";

    document.documentElement.style.zoom = "1";
    window.scrollTo(0, 0);
  });
  await tagScroller(page); // a new DOM means a new scroll container
  // Wheel events land on whatever is under the pointer. Park it over the
  // content column — over the nav, every scroll pans the menu instead.
  const vp = page.viewportSize();
  await page.mouse.move(vp.width * 0.62, vp.height * 0.55);
  await scrollSet(page, 0);
  // Let mount-time entrance animations finish before any frame is taken, so two
  // runs of the same shot agree. This is what reducedMotion was meant to buy.
  await page.waitForTimeout(450);
}

/**
 * Open a stage: a browser sized for a 16:9 master, with the app's own chrome
 * quietened down — the demo banner is proof we're on the demo, but it's not
 * something a viewer should be reading, and animations that never settle would
 * make two capture runs differ.
 */
export async function openStage({ url, width = 1920, height = 1080, outDir }) {
  await fsp.mkdir(outDir, { recursive: true });
  for (const f of await fsp.readdir(outDir)) await fsp.rm(path.join(outDir, f), { force: true });

  const browser = await chromium.launch({ executablePath: resolveChromium() });
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    // NOT reducedMotion: "reduce". It looks like the obvious way to keep
    // entrance animations from varying between takes, but in this Chromium it
    // also disables CSS `zoom` outright — the inline style sets, the computed
    // value stays 1, and every push-in silently does nothing. Determinism comes
    // from settling after navigation instead (see quiet()).
  });

  await page.goto(url, { waitUntil: "networkidle" });
  await assertDemoTarget(page, url); // proof first — then hide the banner
  await quiet(page);

  return { browser, page, rec: new Recorder(page, outDir) };
}
