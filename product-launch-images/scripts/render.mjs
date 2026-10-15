// Usage: node render.mjs <cardsDir>
// Renders every c*.html in cardsDir to cardsDir/out/<name>.png at 2x.
// Size comes from <body data-size="WxH">, default 1600x900.
// Cards with a .split layout are also rendered once per alignment to
// cardsDir/out/layouts/<name>-top|center|bottom.png so the user can pick one.
// Prints BROKEN IMAGE and exits non-zero when an <img> or CSS background fails to load.
import { chromium } from "playwright";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve(process.argv[2] || ".");
mkdirSync(`${dir}/out`, { recursive: true });
const cards = readdirSync(dir)
  .filter((f) => /^c.*\.html$/.test(f))
  .sort();

const browser = await chromium.launch();
for (const file of cards) {
  const html = readFileSync(`${dir}/${file}`, "utf8").replace(
    /<!--[\s\S]*?-->/g,
    "",
  );
  const bodyTag = html.match(/<body[^>]*>/)?.[0] ?? "";
  const size = bodyTag.match(/data-size="(\d+)x(\d+)"/);
  const [width, height] = size
    ? [Number(size[1]), Number(size[2])]
    : [1600, 900];
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 2,
  });
  await page.goto(`file://${dir}/${file}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const broken = await page.evaluate(async () => {
    const bad = [...document.images]
      .filter((img) => !img.complete || img.naturalWidth === 0)
      .map((img) => img.getAttribute("src"));
    const urls = [...document.querySelectorAll("*")]
      .map((el) => getComputedStyle(el).backgroundImage.match(/url\("?(.*?)"?\)/)?.[1])
      .filter(Boolean);
    for (const url of new Set(urls)) {
      const ok = await new Promise((done) => {
        const img = new Image();
        img.onload = () => done(true);
        img.onerror = () => done(false);
        img.src = url;
      });
      if (!ok) bad.push(url);
    }
    return bad;
  });
  for (const src of broken) {
    console.error(`BROKEN IMAGE in ${file}: ${src}`);
    process.exitCode = 1;
  }
  const name = file.replace(/\.html$/, ".png");
  await page.screenshot({ path: `${dir}/out/${name}` });
  console.log(`rendered out/${name} (${width}x${height} @2x)`);
  if (await page.$(".split")) {
    mkdirSync(`${dir}/out/layouts`, { recursive: true });
    for (const align of ["top", "center", "bottom"]) {
      await page.evaluate((a) => (document.body.dataset.align = a), align);
      const alt = name.replace(/\.png$/, `-${align}.png`);
      await page.screenshot({ path: `${dir}/out/layouts/${alt}` });
      console.log(`rendered out/layouts/${alt}`);
    }
  }
  await page.close();
}
await browser.close();
