import type { APIRoute } from "astro";
import sharp from "sharp";
import { SITE } from "../lib/site";

const entities: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};
const xml = (value: string) => value.replace(/[&<>"']/g, (char) => entities[char]);

// Volume 03 glass, with the product terminal underneath. Strokes stay thick
// because X and iMessage recompress this to about 500px.
const C = {
  bg: "#08090c",
  glow: "#c5d0dc",
  window: "#0e1218",
  head: "#12171e",
  side: "#0b0f14",
  pane: "#0b0b0d",
  quiet: "#0c1016",
  rule: "#313a48",
  border: "#8aa0b6",
  fg: "#ededee",
  muted: "#9aa3ae",
  dim: "#5e6874",
  faint: "#3a4350",
  live: "#d7e0ea",
  warm: "#cbb8a4",
  selected: "#1c2633",
};
const SANS = `'IBM Plex Sans', 'Helvetica Neue', Helvetica, Arial, 'DejaVu Sans', sans-serif`;

const frame = { x: 36, y: 32, w: 1128, h: 566 };
const head = 64;
const foot = 48;
const side = 196;
const bodyY = frame.y + head;
const bodyH = frame.h - head - foot;
const splitX = frame.x + side;
const mainW = frame.w - side;
const leftW = 568;
const rightX = splitX + leftW;
const rightW = mainW - leftW;

type Token = [width: number, color: string] | ">" | "_";
type Line = Token[];

function bars(x: number, y: number, lines: Line[], step: number): string {
  return lines
    .map((line, row) => {
      const mid = y + row * step;
      let cursor = x;
      return line
        .map((token) => {
          const at = cursor;
          if (token === ">") {
            cursor += 36;
            return `<path d="M${at} ${mid - 11}l16 11-16 11" fill="none" stroke="${C.live}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
          }
          if (token === "_") {
            return `<rect x="${at}" y="${mid - 14}" width="16" height="28" rx="2" fill="${C.live}"/>`;
          }
          cursor += token[0] + 14;
          return `<rect x="${at}" y="${mid - 7}" width="${token[0]}" height="14" rx="7" fill="${token[1]}"/>`;
        })
        .join("");
    })
    .join("");
}

function row(y: number, width: number, selected = false, live = false): string {
  const x = frame.x;
  const mark = selected ? C.live : C.faint;
  return `
    ${selected ? `<rect x="${x}" y="${y - 22}" width="${side}" height="48" fill="${C.selected}"/>` : ""}
    ${selected ? `<rect x="${x}" y="${y - 22}" width="4" height="48" fill="${C.live}"/>` : ""}
    <rect x="${x + 28}" y="${y - 9}" width="18" height="18" rx="4" fill="${mark}"/>
    <rect x="${x + 60}" y="${y - 6}" width="${width}" height="12" rx="6" fill="${selected ? C.fg : C.dim}"/>
    ${live ? `<circle cx="${x + side - 28}" cy="${y}" r="5" fill="${C.live}"/>` : ""}
  `;
}

export const GET: APIRoute = async () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <clipPath id="quiet"><rect x="${rightX}" y="${bodyY}" width="${rightW}" height="${bodyH}"/></clipPath>
  </defs>
  <rect width="1200" height="630" fill="${C.bg}"/>
  <ellipse cx="1040" cy="48" rx="460" ry="240" fill="${C.glow}" opacity="0.16"/>
  <ellipse cx="180" cy="600" rx="320" ry="160" fill="${C.glow}" opacity="0.06"/>

  <rect x="${frame.x}" y="${frame.y}" width="${frame.w}" height="${frame.h}" rx="10" fill="${C.window}" stroke="${C.border}" stroke-width="2.5"/>
  <rect x="${frame.x + 1}" y="${frame.y + 1}" width="${frame.w - 2}" height="2" fill="${C.live}" opacity="0.28"/>

  <rect x="${frame.x}" y="${frame.y}" width="${frame.w}" height="${head}" fill="${C.head}"/>
  <text x="${frame.x + 28}" y="${frame.y + 41}" fill="${C.fg}" font-family="${SANS}" font-size="30" font-weight="650">${xml(SITE.name)}</text>
  <text x="${frame.x + 118}" y="${frame.y + 41}" fill="${C.muted}" font-family="${SANS}" font-size="20" font-weight="500">/ studio</text>
  <rect x="742" y="${frame.y + 16}" width="148" height="32" rx="6" fill="${C.selected}"/>
  <rect x="766" y="${frame.y + 27}" width="72" height="10" rx="5" fill="${C.fg}"/>
  <rect x="902" y="${frame.y + 16}" width="112" height="32" rx="6" fill="none" stroke="${C.rule}" stroke-width="2"/>
  <rect x="924" y="${frame.y + 27}" width="52" height="10" rx="5" fill="${C.dim}"/>
  <circle cx="1088" cy="${frame.y + 32}" r="8" fill="${C.live}"/>
  <rect x="1108" y="${frame.y + 26}" width="36" height="12" rx="6" fill="${C.muted}"/>

  <rect x="${frame.x}" y="${bodyY}" width="${side}" height="${bodyH}" fill="${C.side}"/>
  ${row(148, 92, true, true)}
  ${row(212, 74)}
  ${row(276, 108)}
  ${row(340, 64, false, true)}
  ${row(404, 86)}
  <path d="M${splitX} ${bodyY}V${bodyY + bodyH}" stroke="${C.rule}" stroke-width="2"/>

  <rect x="${splitX}" y="${bodyY}" width="${leftW}" height="${bodyH}" fill="${C.pane}"/>
  ${bars(splitX + 32, bodyY + 58, [
    [">", [88, C.fg], [124, C.muted]],
    [[150, C.dim], [64, C.live]],
    [[196, C.dim]],
    [">", [72, C.fg], [96, C.muted]],
    [[168, C.dim], [48, C.faint]],
    [">", "_"],
  ], 58)}

  <g clip-path="url(#quiet)">
    <rect x="${rightX}" y="${bodyY}" width="${rightW}" height="${bodyH}" fill="${C.quiet}"/>
    <ellipse cx="${rightX + 180}" cy="${bodyY + bodyH - 8}" rx="210" ry="78" fill="none" stroke="${C.glow}" stroke-width="14" opacity="0.55"/>
    <ellipse cx="${rightX + 180}" cy="${bodyY + bodyH + 18}" rx="150" ry="46" fill="${C.warm}" opacity="0.16"/>
    <circle cx="${rightX + 36}" cy="${bodyY + 42}" r="8" fill="${C.warm}"/>
    <rect x="${rightX + 56}" y="${bodyY + 35}" width="92" height="14" rx="7" fill="${C.muted}"/>
    ${bars(rightX + 36, bodyY + 112, [
      [[120, C.dim], [48, C.faint]],
      [[84, C.dim]],
      [[146, C.faint]],
    ], 52)}
  </g>
  <path d="M${rightX} ${bodyY}V${bodyY + bodyH}" stroke="${C.rule}" stroke-width="2"/>

  <path d="M${frame.x} ${frame.y + frame.h - foot}H${frame.x + frame.w}" stroke="${C.rule}" stroke-width="2"/>
  <circle cx="${frame.x + 32}" cy="${frame.y + frame.h - 24}" r="6" fill="${C.live}"/>
  <rect x="${frame.x + 50}" y="${frame.y + frame.h - 30}" width="72" height="12" rx="6" fill="${C.muted}"/>
  <circle cx="${frame.x + 156}" cy="${frame.y + frame.h - 24}" r="6" fill="${C.warm}"/>
  <rect x="${frame.x + 174}" y="${frame.y + frame.h - 30}" width="48" height="12" rx="6" fill="${C.dim}"/>
  <circle cx="${frame.x + 256}" cy="${frame.y + frame.h - 24}" r="6" fill="${C.faint}"/>
  <rect x="${frame.x + frame.w - 92}" y="${frame.y + frame.h - 32}" width="22" height="16" rx="3" fill="${C.faint}"/>
  <rect x="${frame.x + frame.w - 62}" y="${frame.y + frame.h - 32}" width="22" height="16" rx="3" fill="${C.selected}" stroke="${C.live}" stroke-width="2"/>
</svg>`;

  const image = await sharp(Buffer.from(svg)).png().toBuffer();
  return new Response(image, { headers: { "content-type": "image/png" } });
};
