// Compose: node compose.mjs [shot-name]
//
// Encodes whichever formats were shot:
//
//   master.mp4    1920×1080  from out/<shot>/wide   — long-form / X / YouTube
//   vertical.mp4  1080×1920  from out/<shot>/tall   — TikTok / Reels / Shorts
//
// No cropping. Each is shot at its own aspect against the layout the app
// actually serves at that width (see FORMATS in lib/capture.mjs).
//
// Silent by design. Voice, music and burned-in captions are an editing-suite
// job — and the scripts want voice cold on the first line with music in at
// 0:03, which is not a decision a rig should be making.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { FPS } from "./lib/capture.mjs";

const name = process.argv[2] ?? "01-price-creep";
const dir = path.join(import.meta.dirname, "out", name);

const OUTPUTS = [
  { format: "wide", file: "master.mp4" },
  { format: "tall", file: "vertical.mp4" },
];

const ff = (args) =>
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });

let made = 0;
for (const { format, file } of OUTPUTS) {
  const frames = path.join(dir, format, "frames");
  if (!fs.existsSync(frames)) continue;
  const count = fs.readdirSync(frames).filter((f) => f.endsWith(".jpg")).length;
  if (!count) continue;

  const out = path.join(dir, file);
  // yuv420p + even dimensions: without both, the file plays everywhere except
  // the places that matter (QuickTime, Safari, most upload pipelines).
  ff([
    "-framerate", String(FPS),
    "-i", path.join(frames, "f%06d.jpg"),
    "-c:v", "libx264",
    "-preset", "slow",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    out,
  ]);
  const mb = (fs.statSync(out).size / 1e6).toFixed(1);
  console.log(`  ${out}  ${mb} MB  ${(count / FPS).toFixed(1)}s`);
  made++;
}

if (!made) throw new Error(`Nothing to compose in ${dir} — run: node shoot.mjs ${name}`);
