#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconSvg = path.join(__dirname, "..", "app", "icon.svg");

// Logo as-is (rounded square, for docs/app store style uses)
for (const size of [400, 1024]) {
  const out = path.join(__dirname, `paysats-logo-${size}.png`);
  await sharp(iconSvg, { density: (72 * size) / 100 })
    .resize(size, size)
    .png()
    .toFile(out);
  console.log(`Wrote ${out}`);
}

// X avatar: X circle-crops the upload, so use a full-bleed gradient and
// scale the glyph down for breathing room inside the circle.
const glyphScale = 0.72;
const offset = (100 * (1 - glyphScale)) / 2;
const avatarSvg = `<svg width="100" height="100" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#be6640"/>
      <stop offset="55%" stop-color="#d08850"/>
      <stop offset="100%" stop-color="#dca060"/>
    </linearGradient>
  </defs>
  <rect width="100" height="100" fill="url(#g)"/>
  <g transform="translate(${offset} ${offset}) scale(${glyphScale})">
    <rect x="15" y="18" width="17" height="64" rx="8.5" fill="#ffffff"/>
    <rect x="68" y="18" width="17" height="64" rx="8.5" fill="#ffffff"/>
    <circle cx="50" cy="50" r="9" fill="#ffffff"/>
  </g>
</svg>`;
for (const size of [400, 1024]) {
  const out = path.join(__dirname, `paysats-avatar-${size}.png`);
  await sharp(Buffer.from(avatarSvg), { density: (72 * size) / 100 })
    .resize(size, size)
    .png()
    .toFile(out);
  console.log(`Wrote ${out}`);
}

// X banner: 1500x500, rendered at 2x
const chromeCandidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].filter(Boolean);

const executablePath = chromeCandidates.find((c) => c && existsSync(c));
if (!executablePath) {
  console.error("Chrome not found. Set CHROME_PATH to your browser binary.");
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 500, deviceScaleFactor: 2 });
  await page.goto(`file://${path.join(__dirname, "banner.html")}`, {
    waitUntil: "networkidle0",
    timeout: 60_000,
  });
  await page.evaluateHandle("document.fonts.ready");
  const out = path.join(__dirname, "paysats-banner.png");
  await page.screenshot({ path: out });
  console.log(`Wrote ${out}`);
} finally {
  await browser.close();
}
