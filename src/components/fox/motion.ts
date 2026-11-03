import { RIG, parts, rest, transform, type Pose } from "./rig";

/** Ground line (paw soles) in the svg's user space. */
export const GROUND = 468;

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const out = (t: number) => 1 - (1 - t) ** 3;
const inOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const bump = (t: number) => Math.sin(Math.PI * clamp(t));

// Entrance beats, in seconds from the start.
const HOP = [0.3, 0.95] as const;
const WALK = [1.0, 2.75] as const;
const STRIDE = 0.56;

export interface Stage { approach: string; opacity: number; body: string; shadowScale: number; shadowOpacity: number }

/** Pose every bone and the stage for time t. Pure, so it can be tested and scrubbed. */
export function poseAt(t: number) {
  const pose: Record<string, Pose> = Object.fromEntries(Object.keys(parts()).map(name => [name, rest()]));
  const p = (name: string) => pose[name]!;

  // Hop: crouch, take off nose-up with front paws reaching, land nose-down.
  const h = (t - HOP[0]) / (HOP[1] - HOP[0]);
  const crouch = bump(h / 0.25), air = clamp((h - 0.25) / 0.5), land = bump((h - 0.75) / 0.25);
  const lift = bump(air);
  let bodyY = 18 * crouch - 140 * lift + 12 * land;
  let bodyRot = -9 * Math.sin(2 * Math.PI * air) * (air > 0 && air < 1 ? 1 : 0);
  p("front").rot += -6 * crouch - 30 * lift;
  p("front_far").rot += -6 * crouch - 26 * lift;
  p("front_shin").rot += 42 * lift;
  p("front_far_shin").rot += 38 * lift;
  p("hind").rot += 10 * crouch + 26 * lift;
  p("hind_far").rot += 10 * crouch + 22 * lift;
  p("hind_shin").rot += -12 * lift;
  p("hind_far_shin").rot += -12 * lift;
  p("tail").rot += 14 * lift - 6 * land;

  // Walk: a trot in diagonal pairs that fades out as the fox arrives.
  const w = clamp((t - WALK[0]) / (WALK[1] - WALK[0]));
  const walking = t > WALK[0] && t < WALK[1];
  const amp = walking ? clamp(w / 0.08) * (1 - inOut(clamp((w - 0.62) / 0.38))) : 0;
  const phi = (2 * Math.PI * (t - WALK[0])) / (STRIDE * (1 + 0.5 * w));
  const step = (name: string, phase: number, reach: number, fold: number) => {
    const a = phi + phase;
    p(name).rot += -reach * amp * Math.sin(a);
    p(`${name}_shin`).rot += fold * amp * Math.max(0, Math.cos(a)) ** 1.5;
  };
  step("front", 0, 17, 38);
  step("hind_far", 0, 15, 26);
  step("front_far", Math.PI, 17, 38);
  step("hind", Math.PI, 15, 26);
  bodyY += -6 * amp * (1 - Math.cos(2 * phi)) / 2;
  bodyRot += 1.2 * amp * Math.sin(2 * phi);
  p("tail").rot += 5 * amp * Math.sin(phi - 0.8);
  p("head").dy += 4 * amp * Math.sin(2 * phi + 0.6);

  // Settle and idle: a breath, a slow tail sway, and a curious head tilt on arrival.
  const idle = clamp((t - WALK[1]) / 0.6);
  const s = t - WALK[1];
  p("torso").sy += 0.012 * idle * Math.sin((2 * Math.PI * s) / 3.6);
  p("tail").rot += idle * 3.5 * Math.sin((2 * Math.PI * s) / 4.4);
  p("head").rot += idle * 1.6 * Math.sin((2 * Math.PI * s) / 5.8) - 7 * bump((t - WALK[1] - 0.15) / 1.3);
  p("ruff").sy += 0.01 * idle * Math.sin((2 * Math.PI * s) / 3.6 + 0.4);

  // Stage: start small and far back, then come forward and grow while walking.
  const near = out(w);
  const scale = 0.72 + 0.28 * near;
  const x = -170 * (1 - near), y = -60 * (1 - near);
  const stage: Stage = {
    approach: `translate(${x.toFixed(2)} ${y.toFixed(2)}) translate(0 ${GROUND}) scale(${scale.toFixed(4)}) translate(0 ${-GROUND})`,
    opacity: clamp(t / 0.35),
    body: `translate(0 ${bodyY.toFixed(2)}) rotate(${bodyRot.toFixed(3)} 0 ${GROUND - 150})`,
    shadowScale: 1 - 0.45 * lift,
    shadowOpacity: 1 - 0.55 * lift,
  };
  return { pose, stage };
}

export const ENTRANCE_SECONDS = WALK[1] + 1.5;

/** Run the fox in an svg built from `markup`. Returns a stop function. */
export function animateFox(svg: SVGSVGElement) {
  const bones = new Map<string, SVGGElement>();
  svg.querySelectorAll<SVGGElement>("[data-bone]").forEach(g => bones.set(g.dataset.bone!, g));
  const approach = svg.querySelector<SVGGElement>(".fox-approach")!;
  const body = svg.querySelector<SVGGElement>(".fox-body")!;
  const shadow = svg.querySelector<SVGElement>(".fox-shadow")!;
  const all = parts();
  let t = 0, last = 0, frame = 0, visible = false;

  function paint() {
    const { pose, stage } = poseAt(t);
    for (const [name, g] of bones) g.setAttribute("transform", transform(all[name]!, pose[name]));
    approach.setAttribute("transform", stage.approach);
    approach.style.opacity = String(stage.opacity);
    body.setAttribute("transform", stage.body);
    shadow.setAttribute("transform", `translate(0 ${GROUND}) scale(${stage.shadowScale} 1) translate(0 ${-GROUND})`);
    shadow.style.opacity = String(stage.shadowOpacity);
  }

  function tick(now: number) {
    t += Math.min(0.05, (now - last) / 1000);
    last = now;
    paint();
    frame = requestAnimationFrame(tick);
  }

  function run() {
    if (frame || !visible || document.hidden) return;
    last = performance.now();
    frame = requestAnimationFrame(tick);
  }

  function pause() {
    cancelAnimationFrame(frame);
    frame = 0;
  }

  const observer = new IntersectionObserver(([entry]) => {
    visible = entry!.isIntersecting;
    if (visible) run(); else pause();
  });
  const onVisibility = () => (document.hidden ? pause() : run());
  paint();
  svg.dataset.live = "";
  observer.observe(svg);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    pause();
    observer.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    t = ENTRANCE_SECONDS;
    paint();
  };
}

export { RIG };
