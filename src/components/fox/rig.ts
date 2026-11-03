/**
 * The hero fox as a cut-out rig: sixteen parts from the generated rigging
 * kit, each hung from its parent's joint. `at` is the joint in the parent
 * image's pixels, `pivot` the same joint in this image's pixels. Children
 * with `z: -1` draw behind their parent, so each lower segment tucks under
 * the one above it. Far legs are pre-darkened in their files.
 */
export interface Part {
  name: string;
  size: [number, number];
  pivot: [number, number];
  at: [number, number];
  scale?: number | [number, number];
  z?: -1;
  children?: Part[];
}

const leg = (name: string, sizes: [number, number][], pivots: [number, number][], ats: [number, number][], scales: Part["scale"][], z?: -1): Part => {
  const [upper, lower, paw] = sizes;
  return {
    name, size: upper!, pivot: pivots[0]!, at: ats[0]!, z,
    children: [{
      name: `${name}_shin`, size: lower!, pivot: pivots[1]!, at: ats[1]!, scale: scales[0], z: -1,
      children: [{ name: `${name}_paw`, size: paw!, pivot: pivots[2]!, at: ats[2]!, scale: scales[1], z: -1 }],
    }],
  };
};

export const RIG: Part = {
  name: "torso", size: [515, 261], pivot: [260, 150], at: [0, 0],
  children: [
    leg("hind_far", [[225, 285], [90, 208], [113, 64]], [[142, 60], [62, 45], [37, 22]], [[78, 148], [34, 258], [24, 190]], [[0.88, 1], 0.8], -1),
    leg("front_far", [[138, 249], [77, 215], [119, 67]], [[92, 38], [38, 38], [37, 22]], [[440, 168], [34, 223], [37, 199]], [[0.85, 1], 0.8], -1),
    { name: "tail", size: [397, 354], pivot: [372, 32], at: [52, 78], z: -1 },
    { name: "ruff", size: [205, 315], pivot: [102, 26], at: [468, 96] },
    leg("hind", [[238, 284], [116, 204], [116, 64]], [[150, 62], [80, 46], [37, 22]], [[104, 158], [36, 257], [30, 187]], [[0.88, 1], 0.8]),
    leg("front", [[142, 263], [74, 217], [116, 67]], [[95, 40], [36, 37], [37, 22]], [[418, 180], [35, 236], [34, 201]], [[0.85, 1], 0.8]),
    { name: "head", size: [303, 328], pivot: [150, 262], at: [482, 70], scale: 0.86 },
  ],
};

/** Neck joint in torso pixels: the pointer turn pivots here. */
export const NECK: [number, number] = [482, 70];
/** Head centre in the svg's user space at rest, for pointer maths. */
export const GAZE: [number, number] = [222, -160];

/** Image file for each part (the far legs reuse the kit's second set). */
const FILES: Record<string, string> = {
  torso: "torso", tail: "tail", ruff: "ruff", head: "head",
  hind: "hind_upper_a", hind_shin: "hind_lower_a", hind_paw: "paw_a",
  hind_far: "hind_upper_b", hind_far_shin: "hind_lower_b", hind_far_paw: "paw_b",
  front: "front_upper_a", front_shin: "front_lower_a", front_paw: "paw_c",
  front_far: "front_upper_b", front_far_shin: "front_lower_b", front_far_paw: "paw_d",
};

export interface Pose { rot: number; dx: number; dy: number; sx: number; sy: number }
export const rest = (): Pose => ({ rot: 0, dx: 0, dy: 0, sx: 1, sy: 1 });

export function transform(part: Part, pose: Pose = rest()) {
  const [kx, ky] = Array.isArray(part.scale) ? part.scale : [part.scale ?? 1, part.scale ?? 1];
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return `translate(${r(part.at[0] + pose.dx)} ${r(part.at[1] + pose.dy)}) rotate(${r(pose.rot)}) scale(${r(kx * pose.sx)} ${r(ky * pose.sy)}) translate(${-part.pivot[0]} ${-part.pivot[1]})`;
}

/** Static markup of the rest pose, so the fox renders before any script. */
export function markup(part: Part, base: string): string {
  const kids = part.children ?? [];
  const inner = (z: boolean) => kids.filter(k => (k.z === -1) === z).map(k => markup(k, base)).join("");
  const img = `<image href="${base}/${FILES[part.name]}.webp" width="${part.size[0]}" height="${part.size[1]}"/>`;
  const g = `<g data-bone="${part.name}" transform="${transform(part)}">${inner(true)}${img}${inner(false)}</g>`;
  // The head sits inside the pointer groups that tracking.ts owns.
  return part.name === "head" ? `<g data-fox-look transform="translate(0 0)"><g data-fox-turn>${g}</g></g>` : g;
}

/** Every part by name, for posing. */
export function parts(part: Part = RIG, out: Record<string, Part> = {}) {
  out[part.name] = part;
  part.children?.forEach(child => parts(child, out));
  return out;
}
