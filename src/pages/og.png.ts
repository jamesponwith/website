import type { APIRoute } from "astro";
import sharp from "sharp";
import { resolve } from "node:path";
import { HOME } from "../lib/site";

const xml = (value: string) => value.replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
}[char]!));

// Keep the share preview on the same real product captures as the homepage.
export const GET: APIRoute = async () => {
  const header = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <rect width="1200" height="630" fill="#0c0f11"/>
    <g font-family="Helvetica Neue, Helvetica, Arial, sans-serif">
      <text x="36" y="126" fill="#e7e2da" font-size="40" font-weight="600" letter-spacing="-1">${xml(HOME.headline)}</text>
      <text x="36" y="155" fill="#adb8b0" font-size="18">This one gives a phux. Open source, on your machines, no account.</text>
    </g>
  </svg>`);
  const desktop = resolve("public/product/desktop-workspace.webp");
  const tui = resolve("public/product/tui-workspace.webp");
  const [desktopImage, tuiImage, wordmark] = await Promise.all([
    sharp(desktop).resize(552, 352, { fit: "contain", background: "#080d10" }).png().toBuffer(),
    sharp(tui).resize(552, 352, { fit: "contain", background: "#080d10" }).png().toBuffer(),
    sharp(resolve("public/brand/images/wordmark.svg")).resize({ width: 166 }).png().toBuffer(),
  ]);
  const image = await sharp(header).composite([
    { input: wordmark, left: 36, top: 20 },
    { input: desktopImage, left: 36, top: 170 },
    { input: tuiImage, left: 612, top: 170 },
  ]).png().toBuffer();
  return new Response(image, { headers: { "content-type": "image/png" } });
};
