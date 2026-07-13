#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = `file://${path.join(__dirname, "index.html")}`;
const pdf = path.join(__dirname, "paysats-deck.pdf");

const chromeCandidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].filter(Boolean);

const executablePath = chromeCandidates.find(
  (candidate) => candidate && existsSync(candidate),
);

if (!executablePath) {
  console.error(
    "Chrome not found. Install Google Chrome or set CHROME_PATH to your browser binary.",
  );
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

try {
  const page = await browser.newPage();
  await page.goto(html, { waitUntil: "networkidle0", timeout: 60_000 });
  await page.emulateMediaType("print");
  await page.pdf({
    path: pdf,
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  console.log(`Wrote ${pdf}`);
} finally {
  await browser.close();
}
