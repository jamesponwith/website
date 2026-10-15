import type { APIRoute } from "astro";
import sharp from "sharp";
import foxMark from "../../public/favicon.svg?raw";
import { SITE } from "../lib/site";

const entities: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};
const xml = (value: string) => value.replace(/[&<>"']/g, (char) => entities[char]);

// Terminal-surface palette plus the mark's lime. Chosen for a 500px-wide X
// timeline crop: thick strokes, one accent, no hairlines.
const C = {
  bg: "#05060a",
  surface: "#101218",
  raised: "#171b24",
  rule: "#2a3140",
  fg: "#f4f5f7",
  muted: "#c5c8d0",
  dim: "#6d7484",
  faint: "#3a4252",
  live: "#bef264",
  ok: "#9ece6a",
  ask: "#e0af68",
  blue: "#7aa2f7",
  cyan: "#7dcfff",
};
const SANS = `'IBM Plex Sans', 'Helvetica Neue', Helvetica, Arial, 'DejaVu Sans', sans-serif`;

// Pane text is token bars, never characters. The crop reads as a live terminal
// and cannot look like a copied session.
type Line = ([width: number, color: string] | ">" | "_")[];

function pane(x: number, y: number, lines: Line[], step = 34): string {
  return lines
    .map((line, row) => {
      const mid = y + row * step;
      let cursor = x;
      return line
        .map((token) => {
          const at = cursor;
          if (token === ">") {
            cursor += 28;
            return `<path d="M${at} ${mid - 9}l12 9-12 9" fill="none" stroke="${C.live}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`;
          }
          if (token === "_") {
            return `<rect x="${at}" y="${mid - 13}" width="14" height="26" rx="2" fill="${C.live}"/>`;
          }
          cursor += token[0] + 12;
          return `<rect x="${at}" y="${mid - 6}" width="${token[0]}" height="12" rx="6" fill="${token[1]}"/>`;
        })
        .join("");
    })
    .join("");
}

const MARK = { x: 76, y: 78, size: 156 };
const markSvg = foxMark
  .replace(/<\?xml[^>]*>/, "")
  .replace(/<title[\s\S]*?<\/title>|<desc[\s\S]*?<\/desc>/g, "")
  .replace(
    /<svg[^>]*>/,
    `<svg x="${MARK.x}" y="${MARK.y}" width="${MARK.size}" height="${MARK.size}" viewBox="0 0 512 512">`,
  );

const words = SITE.tagline.split(" ");
const longerLine = (at: number) =>
  Math.max(words.slice(0, at).join(" ").length, words.slice(at).join(" ").length);
let breakAt = 1;
for (let at = 2; at < words.length; at++) if (longerLine(at) < longerLine(breakAt)) breakAt = at;
const tagline = [words.slice(0, breakAt).join(" "), words.slice(breakAt).join(" ")];

const card = { x: 608, y: 112, w: 512, h: 452 };
const back = { x: 684, y: 46, w: 436, h: 168 };

export const GET: APIRoute = async () => {
  const nameInk = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="140"><text x="0" y="112" font-family="${SANS}" font-size="112" font-weight="700" letter-spacing="-5">${xml(SITE.name)}</text></svg>`,
    ),
  )
    .trim()
    .png()
    .toBuffer({ resolveWithObject: true });
  const cursorX = 76 + nameInk.info.width + 24;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="bloom" cx="18%" cy="42%" r="48%">
      <stop offset="0" stop-color="${C.live}" stop-opacity="0.34"/>
      <stop offset="0.42" stop-color="${C.live}" stop-opacity="0.08"/>
      <stop offset="1" stop-color="${C.live}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="card" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#161b26"/>
      <stop offset="1" stop-color="#0c0f15"/>
    </linearGradient>
    <pattern id="cells" width="28" height="28" patternUnits="userSpaceOnUse">
      <circle cx="1.5" cy="1.5" r="1.15" fill="${C.faint}"/>
    </pattern>
    <clipPath id="mark-clip"><rect x="${MARK.x}" y="${MARK.y}" width="${MARK.size}" height="${MARK.size}" rx="32"/></clipPath>
    <clipPath id="card-clip"><rect x="${card.x}" y="${card.y}" width="${card.w}" height="${card.h}" rx="24"/></clipPath>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="42"/>
    </filter>
    <filter id="shadow" x="-18%" y="-12%" width="146%" height="142%">
      <feDropShadow dx="0" dy="22" stdDeviation="24" flood-color="#000" flood-opacity="0.62"/>
    </filter>
  </defs>

  <rect width="1200" height="630" fill="${C.bg}"/>
  <rect width="1200" height="630" fill="url(#cells)" opacity="0.45"/>
  <rect width="1200" height="630" fill="url(#bloom)"/>
  <ellipse cx="${MARK.x + MARK.size / 2}" cy="${MARK.y + MARK.size / 2}" rx="150" ry="130" fill="${C.live}" opacity="0.16" filter="url(#glow)"/>

  <g clip-path="url(#mark-clip)">${markSvg}</g>
  <rect x="${MARK.x - 7}" y="${MARK.y - 7}" width="${MARK.size + 14}" height="${MARK.size + 14}" rx="38" fill="none" stroke="${C.live}" stroke-opacity="0.72" stroke-width="2.5"/>

  <text x="76" y="318" fill="${C.fg}" font-family="${SANS}" font-size="112" font-weight="700" letter-spacing="-5">${xml(SITE.name)}</text>
  <rect x="${cursorX}" y="236" width="16" height="82" rx="3" fill="${C.live}"/>
  <g font-family="${SANS}" font-size="40" font-weight="500" fill="${C.muted}" letter-spacing="-0.8">
    <text x="76" y="402">${xml(tagline[0])}</text>
    <text x="76" y="452">${xml(tagline[1])}</text>
  </g>
  <circle cx="86" cy="534" r="8" fill="${C.live}"/>
  <text x="108" y="544" fill="${C.fg}" font-family="${SANS}" font-size="30" font-weight="600">${xml(SITE.domain)}</text>
  <rect x="292" y="516" width="168" height="36" rx="18" fill="${C.raised}" stroke="${C.rule}"/>
  <text x="376" y="540" text-anchor="middle" fill="${C.live}" font-family="${SANS}" font-size="18" font-weight="700" letter-spacing="1.6">RUNTIME</text>

  <g>
    <rect x="${back.x}" y="${back.y}" width="${back.w}" height="${back.h}" rx="20" fill="${C.surface}" stroke="${C.rule}" stroke-width="1.5"/>
    <circle cx="${back.x + 26}" cy="${back.y + 28}" r="6" fill="${C.faint}"/>
    <circle cx="${back.x + 46}" cy="${back.y + 28}" r="6" fill="${C.faint}"/>
    <circle cx="${back.x + 66}" cy="${back.y + 28}" r="6" fill="${C.faint}"/>
    ${pane(back.x + 28, back.y + 78, [[">", [64, C.fg], [92, C.blue]], [[140, C.dim]]], 32)}
  </g>
  <rect x="${card.x}" y="${card.y}" width="${card.w}" height="${card.h}" rx="24" fill="url(#card)" filter="url(#shadow)"/>
  <g clip-path="url(#card-clip)">
    <rect x="${card.x}" y="${card.y}" width="${card.w}" height="64" fill="${C.surface}"/>
    <g fill="${C.faint}">
      <circle cx="${card.x + 30}" cy="${card.y + 32}" r="7"/>
      <circle cx="${card.x + 54}" cy="${card.y + 32}" r="7"/>
      <circle cx="${card.x + 78}" cy="${card.y + 32}" r="7"/>
    </g>
    <circle cx="${card.x + card.w - 118}" cy="${card.y + 32}" r="6" fill="${C.live}"/>
    <rect x="${card.x + card.w - 102}" y="${card.y + 26}" width="70" height="12" rx="6" fill="${C.live}" opacity="0.85"/>
    <path d="M${card.x} ${card.y + 64.5}H${card.x + card.w}" stroke="${C.rule}"/>
    ${pane(card.x + 36, card.y + 104, [
      [">", [72, C.fg], [108, C.blue]],
      [[168, C.dim], [54, C.cyan]],
      [[132, C.dim]],
      [[96, C.ok], [48, C.dim]],
      [">", [58, C.fg], [84, C.cyan]],
      [[186, C.dim]],
      [[74, C.ask], [62, C.dim]],
      [">", "_"],
    ], 36)}
    <rect x="${card.x}" y="${card.y + card.h - 58}" width="${card.w}" height="58" fill="${C.surface}"/>
    <path d="M${card.x} ${card.y + card.h - 58.5}H${card.x + card.w}" stroke="${C.rule}"/>
    <circle cx="${card.x + 36}" cy="${card.y + card.h - 29}" r="7" fill="${C.live}"/>
    <rect x="${card.x + 54}" y="${card.y + card.h - 35}" width="54" height="12" rx="6" fill="${C.muted}"/>
    <circle cx="${card.x + 168}" cy="${card.y + card.h - 29}" r="7" fill="${C.ask}"/>
    <rect x="${card.x + 186}" y="${card.y + card.h - 35}" width="46" height="12" rx="6" fill="${C.faint}"/>
    <circle cx="${card.x + 292}" cy="${card.y + card.h - 29}" r="7" fill="${C.cyan}"/>
    <rect x="${card.x + 310}" y="${card.y + card.h - 35}" width="62" height="12" rx="6" fill="${C.faint}"/>
  </g>
  <rect x="${card.x + 1.5}" y="${card.y + 1.5}" width="${card.w - 3}" height="${card.h - 3}" rx="22.5" fill="none" stroke="${C.live}" stroke-opacity="0.8" stroke-width="2.5"/>
</svg>`;
  const image = await sharp(Buffer.from(svg)).png().toBuffer();
  return new Response(image, {
    headers: { "content-type": "image/png" },
  });
};
