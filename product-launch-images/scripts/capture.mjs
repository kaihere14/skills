// Usage: node capture.mjs <url> <outDir>
// Headless fallback for when Claude in Chrome is not connected.
// Saves hero.png (first viewport), full.png (whole page, sticky nav hidden), text.txt, links.txt,
// assets.json (fonts, colours, logo and hero media from probe.js) and logo.svg if the logo is inline.
// Exits with code 2 if the site blocks headless browsers.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const [url, outDir = "shots"] = process.argv.slice(2);
if (!url) {
  console.error("usage: node capture.mjs <url> <outDir>");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

// Look like a normal desktop Chrome: real user agent and headers, no automation flag.
const browser = await chromium.launch({
  args: ["--disable-blink-features=AutomationControlled"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  userAgent: USER_AGENT,
  locale: "en-US",
  extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
});
await context.addInitScript(() =>
  Object.defineProperty(navigator, "webdriver", { get: () => undefined }),
);
const page = await context.newPage();

// Wait for "load", not "networkidle": analytics, chat widgets and websockets keep the
// network busy forever on many sites.
const response = await page.goto(url, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForLoadState("load", { timeout: 20000 }).catch(() => {});
await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(2500);

const title = await page.title();
const status = response?.status() ?? 0;
if (
  status >= 400 ||
  /just a moment|attention required|access denied|verify you are human|captcha/i.test(title)
) {
  console.error(
    `blocked: ${url} returned ${status} "${title}". The site rejects headless browsers; ` +
      "capture it with Claude in Chrome instead.",
  );
  await browser.close();
  process.exit(2);
}

// Cookie banners: pick the most private option if offered, then hide what is left.
for (const name of [/^reject all$/i, /^reject$/i, /^decline( all)?$/i, /necessary only|only necessary/i]) {
  const button = page.getByRole("button", { name }).first();
  if (await button.isVisible().catch(() => false)) {
    await button.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(800);
    break;
  }
}
await page.evaluate(() => {
  for (const el of document.querySelectorAll("[id*='cookie' i], [class*='cookie' i], [id*='consent' i], [class*='consent' i], #onetrust-consent-sdk")) {
    if (["fixed", "sticky"].includes(getComputedStyle(el).position)) el.style.display = "none";
  }
});

await page.screenshot({ path: `${outDir}/hero.png` });

// Scroll slowly so scroll-triggered animations and lazy images load.
const height = await page.evaluate(() => document.body.scrollHeight);
for (let y = 0; y < height; y += 300) {
  await page.evaluate((v) => window.scrollTo(0, v), y);
  await page.waitForTimeout(300);
}
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(1500);

const probe = readFileSync(new URL("./probe.js", import.meta.url), "utf8");
const assets = await page.evaluate(probe);
writeFileSync(`${outDir}/assets.json`, JSON.stringify(assets, null, 2));

const logoSvg = await page.evaluate(() => {
  const header = document.querySelector("header, nav") || document.body;
  return header.querySelector("a[href='/'] svg, svg")?.outerHTML ?? null;
});
if (logoSvg) writeFileSync(`${outDir}/logo.svg`, logoSvg);

// Hide fixed/sticky headers so they don't repeat across the full-page capture.
await page.evaluate(() => {
  for (const el of document.querySelectorAll("*")) {
    const pos = getComputedStyle(el).position;
    if (pos === "fixed" || pos === "sticky") el.style.visibility = "hidden";
  }
});
await page.screenshot({ path: `${outDir}/full.png`, fullPage: true });

writeFileSync(
  `${outDir}/text.txt`,
  await page.evaluate(() => document.body.innerText),
);
writeFileSync(
  `${outDir}/links.txt`,
  (
    await page.evaluate(() => [
      ...new Set([...document.querySelectorAll("a")].map((a) => a.href)),
    ])
  ).join("\n"),
);

const videos = assets.media.filter((m) => m.type === "video").length;
console.log(
  `page height ${height}px; ${assets.media.length} hero media (${videos} video); saved to ${outDir}/`,
);
await browser.close();
