// Brand probe. Evaluate in the page (Chrome javascript_tool, or page.evaluate in capture.mjs).
// Returns the product name, fonts, brand colours, logo candidates and hero media (videos,
// large images, CSS background images), ordered top to bottom.
(() => {
  const abs = (u) => {
    try {
      return u ? new URL(u, location.href).href : null;
    } catch {
      return null;
    }
  };
  const top = (el) => Math.round(el.getBoundingClientRect().top + scrollY);
  const size = (el) => {
    const r = el.getBoundingClientRect();
    return `${Math.round(r.width)}x${Math.round(r.height)}`;
  };
  const clear = (c) => !c || c === "rgba(0, 0, 0, 0)" || c === "transparent";

  // Video files the page has requested. Covers lazy players whose src is set late or by script.
  const videoRequests = [
    ...new Set(
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((n) => /\.(mp4|webm|mov|m3u8)(\?|$)/i.test(n)),
    ),
  ];

  const media = [];
  for (const v of document.querySelectorAll("video")) {
    const source = v.querySelector("source");
    media.push({
      type: "video",
      src: abs(
        v.currentSrc ||
          v.getAttribute("src") ||
          v.dataset.src ||
          source?.getAttribute("src") ||
          source?.dataset.src,
      ) || videoRequests[0] || null,
      poster: abs(v.poster),
      shown: size(v),
      top: top(v),
    });
  }
  const seen = new Set();
  for (const i of document.querySelectorAll("img")) {
    const src = abs(i.currentSrc || i.src);
    const shownWidth = i.getBoundingClientRect().width;
    if ((i.naturalWidth >= 600 || i.naturalHeight >= 600) && shownWidth >= 300 && !seen.has(src)) {
      seen.add(src);
      media.push({
        type: "img",
        src,
        natural: `${i.naturalWidth}x${i.naturalHeight}`,
        shown: size(i),
        top: top(i),
      });
    }
  }
  for (const el of document.querySelectorAll("body *")) {
    const bg = getComputedStyle(el).backgroundImage;
    const r = el.getBoundingClientRect();
    if (bg.includes("url(") && r.width >= 600 && r.height >= 300) {
      media.push({
        type: "bg",
        src: abs(bg.match(/url\(["']?(.*?)["']?\)/)?.[1]),
        shown: size(el),
        top: top(el),
      });
    }
  }
  media.sort((a, b) => a.top - b.top);

  // Hero background: first painted background behind the h1.
  const h1 = document.querySelector("h1");
  let heroBg = null;
  for (let el = h1; el && !heroBg; el = el.parentElement) {
    const cs = getComputedStyle(el);
    if (!clear(cs.backgroundColor) || cs.backgroundImage !== "none") {
      heroBg = { color: cs.backgroundColor, image: cs.backgroundImage.slice(0, 200) };
    }
  }

  const buttons = [
    ...new Set(
      [...document.querySelectorAll("a, button")]
        .map((e) => getComputedStyle(e).backgroundColor)
        .filter((c) => !clear(c)),
    ),
  ].slice(0, 6);

  const header = document.querySelector("header, nav") || document.body;
  const logoImg = header.querySelector("a[href='/'] img, img[alt*='logo' i], img");
  const logoSvg = header.querySelector("a[href='/'] svg, svg");

  return {
    url: location.href,
    title: document.title,
    h1: h1?.innerText.trim().slice(0, 160),
    fonts: {
      heading: h1 && getComputedStyle(h1).fontFamily,
      body: getComputedStyle(document.body).fontFamily,
    },
    colors: {
      body: getComputedStyle(document.body).backgroundColor,
      text: h1 && getComputedStyle(h1).color,
      heroBg,
      buttons,
    },
    logo: {
      img: abs(logoImg?.currentSrc || logoImg?.src),
      inlineSvgChars: logoSvg ? logoSvg.outerHTML.length : 0,
      appleTouchIcon: abs(document.querySelector("link[rel='apple-touch-icon']")?.href),
      ogImage: abs(document.querySelector("meta[property='og:image']")?.content),
    },
    media: media.slice(0, 15),
    videoRequests: videoRequests.slice(0, 5),
  };
})();
