import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/components/prototype/vgpu/live/live.css", import.meta.url), "utf8");
const source = readFileSync(new URL("../src/components/prototype/vgpu/live/LiveWorkspace.tsx", import.meta.url), "utf8");

test("the embedded demo fills its frame, so the page never reflows as the session connects", () => {
  expect(css).toContain(".embedded-home .vibe-stage.live-stage { min-height: 100svh; }");
});

test("the terminal has one fixed height per breakpoint, whatever the session is doing", () => {
  const heights = [...css.matchAll(/\.live-screen \{[^}]*?height: (\d+)px/g)].map(([, value]) => Number(value));
  expect(heights).toEqual([408, 296]);
  expect(css).not.toMatch(/\.live-status \{[^}]*height:/);
});

test("the terminal is used where it sits: no dialog, no previews, no copies of the canvas", () => {
  expect(source).not.toMatch(/<dialog|showModal|drawImage/);
  expect(css).not.toMatch(/dialog/);
});
