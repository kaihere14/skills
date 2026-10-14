// Usage: node frame.mjs <video-url-or-file> <outDir> [count=4]
// Pulls full-resolution stills from a hero video so it can be used as card art.
// Downloads the video with browser headers (HLS .m3u8 streams are read directly by ffmpeg),
// saves frame-1.png ... frame-N.png spread across the video, and sheet.png to compare them.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { extname } from "node:path";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const [source, outDir = "video", countArg = "4"] = process.argv.slice(2);
const count = Math.max(1, Number(countArg));
if (!source) {
  console.error("usage: node frame.mjs <video-url-or-file> <outDir> [count=4]");
  process.exit(1);
}
if (source.startsWith("blob:")) {
  console.error(
    "blob: URLs cannot be downloaded. Find the real .mp4/.webm/.m3u8 URL in the page's network requests, or use the poster image.",
  );
  process.exit(1);
}
try {
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
} catch {
  console.error("ffmpeg not found. Install it (macOS: brew install ffmpeg) and run again.");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const remote = /^https?:\/\//.test(source);
const stream = remote && /\.m3u8(\?|$)/.test(source);
let input = source;
const httpArgs = [];

if (remote && !stream) {
  const res = await fetch(source, {
    headers: {
      "User-Agent": USER_AGENT,
      Referer: new URL(source).origin + "/",
      Accept: "video/webm,video/mp4,video/*;q=0.9,*/*;q=0.8",
    },
  });
  if (!res.ok) {
    console.error(`download failed: ${res.status} ${res.statusText} for ${source}`);
    process.exit(1);
  }
  input = `${outDir}/video${extname(new URL(source).pathname) || ".mp4"}`;
  writeFileSync(input, Buffer.from(await res.arrayBuffer()));
} else if (stream) {
  httpArgs.push("-user_agent", USER_AGENT, "-headers", `Referer: ${new URL(source).origin}/\r\n`);
} else if (!existsSync(source)) {
  console.error(`file not found: ${source}`);
  process.exit(1);
}

const probe = JSON.parse(
  execFileSync("ffprobe", [
    ...httpArgs,
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height:format=duration",
    "-of", "json",
    input,
  ]),
);
const { width, height } = probe.streams[0];
const duration = Number(probe.format.duration) || 1;

// Skip the very start and end, where hero videos often fade in or loop.
for (let i = 0; i < count; i++) {
  const t = (duration * (i + 0.5)) / count;
  execFileSync("ffmpeg", [
    ...httpArgs,
    "-v", "error", "-y",
    "-ss", t.toFixed(2),
    "-i", input,
    "-frames:v", "1",
    `${outDir}/frame-${i + 1}.png`,
  ]);
}

const cols = count === 1 ? 1 : 2;
execFileSync("ffmpeg", [
  "-v", "error", "-y",
  "-start_number", "1",
  "-i", `${outDir}/frame-%d.png`,
  "-vf", `scale=640:-2,tile=${cols}x${Math.ceil(count / cols)}`,
  "-frames:v", "1",
  `${outDir}/sheet.png`,
]);

console.log(
  `${width}x${height}, ${duration.toFixed(1)}s; saved frame-1..${count}.png and sheet.png to ${outDir}/`,
);
