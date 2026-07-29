// Compose: node compose.mjs [shot-name]
//
// Frames → two deliverables, per the repurposing rule in ../../README.md:
// shoot 16:9 once, crop to 9:16 rather than re-recording.
//
//   master.mp4    1920×1080, the long-form / X / YouTube cut
//   vertical.mp4  1080×1920, centre-cropped for TikTok / Reels / Shorts
//
// Silent by design. Voice, music and burned-in captions are an editing-suite
// job — and the script wants voice cold on the first line with music in at
// 0:03, which is a decision no rig should be making.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { FPS } from "./lib/capture.mjs";

const name = process.argv[2] ?? "01-price-creep";
const dir = path.join(import.meta.dirname, "out", name);
const frames = path.join(dir, "frames");

if (!fs.existsSync(frames)) throw new Error(`No frames at ${frames} — run: node shoot.mjs ${name}`);
const count = fs.readdirSync(frames).filter((f) => f.endsWith(".jpg")).length;
if (!count) throw new Error(`${frames} is empty.`);

const ff = (args) => execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });

const master = path.join(dir, "master.mp4");
const vertical = path.join(dir, "vertical.mp4");

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
  master,
]);

// Centre-crop to 9:16 out of the 16:9 master. The shot scripts frame their
// action centrally for exactly this reason.
ff([
  "-i", master,
  "-vf", "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920:flags=lanczos",
  "-c:v", "libx264",
  "-preset", "slow",
  "-crf", "18",
  "-pix_fmt", "yuv420p",
  "-movflags", "+faststart",
  vertical,
]);

const mb = (p) => (fs.statSync(p).size / 1e6).toFixed(1);
console.log(`✓ ${count} frames → ${(count / FPS).toFixed(1)}s`);
console.log(`  ${master}    ${mb(master)} MB  1920×1080`);
console.log(`  ${vertical}  ${mb(vertical)} MB  1080×1920`);
