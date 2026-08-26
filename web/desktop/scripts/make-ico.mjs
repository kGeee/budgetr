#!/usr/bin/env node
/**
 * Generate desktop/build/icon.ico from the existing 512px PWA icon.
 * Cross-platform (Windows CI + local) — pure Node, no ImageMagick/sips.
 *
 * Packs PNGs into a Vista+ ICO (PNG-compressed images). Uses the 192 and 512
 * assets we already ship so we don't need a resizer at build time.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");

const sources = [
  path.join(root, "public", "icons", "icon-192.png"),
  path.join(root, "public", "icons", "icon-512.png"),
];
const outDir = path.join(root, "desktop", "build");
const outFile = path.join(outDir, "icon.ico");

function readPngSize(buf) {
  // IHDR follows the 8-byte PNG signature; width/height are big-endian u32.
  if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50) {
    throw new Error("not a PNG");
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function buildIco(pngBuffers) {
  const count = pngBuffers.length;
  const headerSize = 6 + count * 16;
  let offset = headerSize;
  const entries = [];

  for (const png of pngBuffers) {
    const { width, height } = readPngSize(png);
    entries.push({
      width: width >= 256 ? 0 : width,
      height: height >= 256 ? 0 : height,
      size: png.length,
      offset,
      png,
    });
    offset += png.length;
  }

  const out = Buffer.alloc(offset);
  out.writeUInt16LE(0, 0); // reserved
  out.writeUInt16LE(1, 2); // type: icon
  out.writeUInt16LE(count, 4);

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const o = 6 + i * 16;
    out.writeUInt8(e.width, o);
    out.writeUInt8(e.height, o + 1);
    out.writeUInt8(0, o + 2); // color count
    out.writeUInt8(0, o + 3); // reserved
    out.writeUInt16LE(1, o + 4); // planes
    out.writeUInt16LE(32, o + 6); // bit count
    out.writeUInt32LE(e.size, o + 8);
    out.writeUInt32LE(e.offset, o + 12);
  }

  for (const e of entries) {
    e.png.copy(out, e.offset);
  }
  return out;
}

for (const src of sources) {
  if (!fs.existsSync(src)) {
    console.error(`make-ico: source icon not found at ${src}`);
    process.exit(1);
  }
}

fs.mkdirSync(outDir, { recursive: true });
const pngs = sources.map((s) => fs.readFileSync(s));
fs.writeFileSync(outFile, buildIco(pngs));
console.log(`make-ico: wrote ${outFile}`);
