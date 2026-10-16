import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { gpuPool, opticalBackingSize, opticalFrameDeadline, startOpticalWarmup } from "./gpu-runtime";
import { createRenderMetrics } from "./gpu-metrics";
import atmosphere from "./atmosphere.wgsl";

type Vector = [number, number, number];
export type SceneSettings = {
  speed: number; amplitude: number; shape: number; color: Vector;
  burst: number; paused: boolean; sceneTime?: number;
};
export const initialSettings: SceneSettings = { speed: 1, amplitude: 1, shape: 0, color: [0.96, 0.60, 0.29], burst: 0, paused: false };
export type SceneGlass = { rects: [number,number,number,number][]; pulse?: number };
type Pointer = { x: number; y: number; active: number };
type SceneProps = { variant: number; settings: MutableRefObject<SceneSettings>; detached?: boolean; miniature?: boolean; active?: boolean; ambient?: boolean; input?:MutableRefObject<Pointer>; glass?:MutableRefObject<SceneGlass> };
const ease = (x: number) => x * x * (3 - 2 * x);
const blend = (a: number, b: number, f: number) => a + (b - a) * f;
const shapeIndex = (shape: number) => Math.max(0, Math.min(5, Math.round(shape)));

/** Shared animation state gives both renderers identical transition semantics. */
function createMotion(initial: SceneSettings) {
  let previous = performance.now(), phaseSeenAt = previous;
  let serverPhase = initial.sceneTime;
  let time = serverPhase ?? 0, amplitude = initial.amplitude, speed = initial.speed;
  let from = shapeIndex(initial.shape), to = from, progress = 1, spread = 0;
  const color: Vector = [...initial.color];
  const pointer = { x: 0, y: 0, active: 0 };
  const advancePhase = (state: SceneSettings, now: number, dt: number, reduced: boolean) => {
    speed = blend(speed, state.speed, 1 - Math.exp(-dt * 3));
    if (state.paused || reduced) return;
    time += dt * speed;
    if (state.sceneTime === undefined) return;
    if (state.sceneTime !== serverPhase) { serverPhase = state.sceneTime; phaseSeenAt = now; }
    const target = state.sceneTime + (now - phaseSeenAt) / 1000 * speed;
    time = blend(time, target, 1 - Math.exp(-dt * 2));
  };
  return (state: SceneSettings, detached: boolean, input: Pointer, reduced: boolean, now = performance.now()) => {
    const dt = Math.min(Math.max((now - previous) / 1000, 0), 0.05);
    previous = now;
    advancePhase(state, now, dt, reduced);
    const requested = shapeIndex(state.shape);
    // Finish an in-flight morph before accepting another, preserving continuity.
    if (progress >= 1 && requested !== to) { from = to; to = requested; progress = 0; }
    progress = reduced ? 1 : Math.min(1, progress + dt / 1.45);
    if (progress >= 1) from = to;
    const smoothing = reduced ? 1 : 1 - Math.exp(-dt * 4);
    amplitude = blend(amplitude, state.amplitude, smoothing);
    spread = blend(spread, Number(detached), smoothing);
    for (let i = 0; i < 3; i++) color[i] = blend(color[i], state.color[i], smoothing);
    pointer.x = blend(pointer.x, input.x, smoothing);
    pointer.y = blend(pointer.y, input.y, smoothing);
    pointer.active = blend(pointer.active, input.active, smoothing);
    const burst = Math.max(0, 1 - (Date.now() - state.burst) / 2100);
    return { time, amplitude, color, from, to, progress: ease(progress), spread, pointer, burst };
  };
}
type Motion = ReturnType<ReturnType<typeof createMotion>>;

export function Scene({ variant, settings, detached = false, miniature = false, active = true, ambient = false, input, glass }: SceneProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const fallback = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const detachedRef = useRef(detached);
  detachedRef.current = detached;
  const [renderer, setRenderer] = useState("Preparing light field");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let disposed = false, fallbackStarted = false, onScreen = true;
    let cancelWarmup = () => {};
    let releaseGpu = () => {}, disposeSurface = () => {}, disposeField = () => {}, disposeMetrics = () => {};
    let stop = () => {}, fallbackStop = () => {}, removeErrorListener = () => {};
    const cleanupGpu = () => {
      stop(); removeErrorListener(); disposeMetrics(); disposeField(); disposeSurface(); releaseGpu();
      stop = removeErrorListener = disposeMetrics = disposeField = disposeSurface = releaseGpu = () => {};
    };
    const element = canvas.current!;
    const bootStartedAt = performance.now();
    let stageStartedAt = bootStartedAt, stage = "";
    const bootStage = (next: string) => {
      const now = performance.now();
      for (const node of [element,element.parentElement!]) {
        if (stage) node.dataset[`boot${stage[0].toUpperCase()+stage.slice(1)}Ms`] = (now-stageStartedAt).toFixed(1);
        node.dataset.bootStage = next;
        node.dataset.bootStartedAt = bootStartedAt.toFixed(1);
        node.dataset.bootStageStartedAt = now.toFixed(1);
        node.dataset.bootElapsedMs = (now-bootStartedAt).toFixed(1);
      }
      stage = next; stageStartedAt = now;
    };
    const visibility = new IntersectionObserver(entries => { onScreen = entries[0]?.isIntersecting ?? false; }, { rootMargin: "120px" });
    visibility.observe(element);
    let resizeDirty = true;
    const resize = new ResizeObserver(() => { resizeDirty = true; });
    resize.observe(element);
    element.style.opacity = "1";
    setReady(false); setRenderer("Preparing light field");
    const pointer: Pointer = input?.current || { x: 0, y: 0, active: 0 };
    const move = (event: PointerEvent) => {
      const box = element.getBoundingClientRect();
      pointer.x = (event.clientX - box.left) / Math.max(box.width, 1) * 2 - 1;
      pointer.y = 1 - (event.clientY - box.top) / Math.max(box.height, 1) * 2;
      pointer.active = 1;
    };
    const leave = () => { pointer.active = 0; };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerleave", leave);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const showCanvas = (label: string) => {
      if (disposed) return;
      fallbackStop();
      element.style.opacity = "0";
      setRenderer(label);
      fallbackStop = drawFallback(fallback.current!, variant, settings, detachedRef, pointer, reduced, miniature, () => onScreen && activeRef.current, () => { if (!disposed) setReady(true); });
    };
    const useFallback = (error: unknown) => {
      if (disposed || fallbackStarted) return;
      fallbackStarted = true;
      cancelWarmup();
      cleanupGpu(); bootStage("fallback");
      element.parentElement!.dataset.bootPreview = "canvas";
      console.info("PHUX light field: using Canvas renderer", error);
      showCanvas("Canvas · optical field");
    };
    const boot = async () => {
      bootStage("import");
      const { surface, effect, frame, timer } = await import("vgpu");
      if (disposed || fallbackStarted) return;
      bootStage("acquire");
      const lease = await gpuPool.acquire();
      const context = lease.gpu;
      releaseGpu = lease.release;
      if (disposed || fallbackStarted) { releaseGpu(); return; }
      void context.lost.then(info => { if (!disposed && info.reason !== "destroyed") useFallback(info.message); });
      let cssWidth = element.clientWidth, cssHeight = element.clientHeight, lastDpr = devicePixelRatio;
      const desiredSize = () => {
        cssWidth = element.clientWidth; cssHeight = element.clientHeight;
        return opticalBackingSize(cssWidth,cssHeight,devicePixelRatio,ambient,miniature);
      };
      bootStage("surface");
      const target = surface(context, element, { autoResize: false, size: desiredSize() });
      disposeSurface = () => target.dispose();
      const gpuTimer = context.gpu.features.has("timestamp-query") ? timer(context) : undefined;
      const metrics = createRenderMetrics(element, lease.id, gpuTimer);
      disposeMetrics = () => metrics.dispose();
      let motion = createMotion(settings.current);
      const current = motion(settings.current, detachedRef.current, pointer, reduced.matches);
      const rect = element.getBoundingClientRect();
      const data = {
        timing: [current.time, rect.width / Math.max(rect.height, 1), variant, 0],
        scene: [current.amplitude, current.to, current.spread, miniature ? 0.72 : 0.82],
        color: [...current.color, 1], pointer: [0, 0, 0, 0],
        morph: [current.from, current.to, current.progress, 0],
        topology: [Math.max(cssWidth,1), Math.max(cssHeight,1), target.size[0], target.size[1]],
        glass0: [0,0,0,0], glass1: [0,0,0,0], glass2: [0,0,0,0], glass3: [0,0,0,0], glassMeta: [0,0,0,0],
      };
      const updateGlass = () => {
        const rects = (glass?.current.rects ?? []).filter(rect => rect.length === 4 && rect.every(Number.isFinite) && rect[2] > 0 && rect[3] > 0).slice(0,4);
        data.glass0 = rects[0] ?? [0,0,0,0]; data.glass1 = rects[1] ?? [0,0,0,0];
        data.glass2 = rects[2] ?? [0,0,0,0]; data.glass3 = rects[3] ?? [0,0,0,0];
        const pulse = glass?.current.pulse;
        const age = pulse === undefined ? Infinity : performance.now()-pulse;
        const responding = !reduced.matches && Number.isFinite(age) && age >= 0 && age < 1500;
        // A short, eased attack avoids a hard lighting flash. Hidden views do
        // not render or replay the impulse when they return after it settles.
        const energy = responding ? ease(Math.min(age/70,1))*ease(1-age/1500) : 0;
        const pulseAge = responding ? age/1000 : 0;
        data.glassMeta = [rects.length,energy,pulseAge,0];
        element.dataset.glassEnergy = energy.toFixed(3);
        const key = rects.map(rect => rect.map(value => value.toFixed(5)).join(",")).join(";");
        if (element.dataset.glassLayout !== key) {
          element.dataset.glassLayout = key; element.dataset.glassCount = String(rects.length);
        }
        return `${key}/${energy.toFixed(5)}/${pulseAge.toFixed(4)}`;
      };
      updateGlass();
      const field = effect(context, atmosphere, { set: { params: data } });
      disposeField = () => field.dispose();
      bootStage("compile");
      await field.compile(target);
      if (disposed || fallbackStarted) return;
      motion = createMotion(settings.current);
      const first = motion(settings.current,detachedRef.current,pointer,reduced.matches);
      data.timing[0] = first.time; data.scene[0] = first.amplitude;
      data.color = [...first.color,1]; data.morph = [first.from,first.to,first.progress,0];
      updateGlass();
      field.set({params:data});
      const submitted = frame(context, currentFrame => currentFrame.pass(target, field));
      bootStage("settled");
      await submitted.done;
      bootStage("queue");
      await context.gpu.queue.onSubmittedWorkDone();
      if (disposed || fallbackStarted) return;
      cancelWarmup();
      fallbackStop(); fallbackStop = () => {};
      element.style.opacity = "1";
      bootStage("ready");
      element.parentElement!.dataset.bootPreview = "webgpu";
      setReady(true);
      setRenderer("vgpu · WebGPU · optical field");
      removeErrorListener = context.onError(error => useFallback(error));
      let raf = 0, nextFrame = 0, lastStaticKey = "";
      const drawCurrentState = (now: number) => {
        const cpuStart = performance.now();
        const state = settings.current;
        const glassKey = updateGlass();
        const current = motion(state, detachedRef.current, pointer, reduced.matches);
        // A paused/reduced-motion view renders on changes instead of submitting empty frames.
        let staticKey = "";
        if (state.paused || reduced.matches) {
          staticKey = [current.from,current.to,current.progress,current.amplitude,current.spread,...current.color,current.pointer.x,current.pointer.y,current.burst].map(value => value.toFixed(5)).join("/")+"/"+glassKey;
          if (staticKey === lastStaticKey && !resizeDirty) { metrics.idle(); return; }
        }
        lastStaticKey = staticKey;
        if (resizeDirty) target.resize(desiredSize());
        frame(context, currentFrame => {
          const size = target.size;
          data.timing = [current.time, size[0] / Math.max(size[1], 1), variant, 0];
          data.scene = [current.amplitude, current.to, current.spread, miniature ? 0.72 : 0.82];
          data.color = [...current.color, 1];
          data.pointer = [current.pointer.x, current.pointer.y, current.pointer.active, current.burst];
          data.morph = [current.from, current.to, current.progress, 0];
          data.topology = [Math.max(cssWidth,1), Math.max(cssHeight,1), size[0], size[1]];
          field.set({ params: data });
          currentFrame.pass({ target, timer: metrics.sample(now) }, field);
        });
        resizeDirty = false;
        element.dataset.shape = String(current.to);
        element.dataset.morph = current.progress.toFixed(3);
        metrics.submitted(now, performance.now()-cpuStart);
      };
      const render = (now: number) => {
        raf = requestAnimationFrame(render);
        if (lastDpr !== devicePixelRatio) { lastDpr = devicePixelRatio; resizeDirty = true; }
        if (document.hidden || !onScreen || !activeRef.current) { metrics.idle(); return; }
        const interval = reduced.matches ? 1000/12 : miniature ? 1000/24 : 1000/60;
        const deadline = opticalFrameDeadline(now,nextFrame,interval);
        if (deadline === undefined) return;
        nextFrame = deadline;
        try { drawCurrentState(now); }
        catch (error) { useFallback(error); }
      };
      raf = requestAnimationFrame(render);
      stop = () => cancelAnimationFrame(raf);
    };
    const warmup = startOpticalWarmup(() => {
      if (disposed || fallbackStarted) return;
      element.parentElement!.dataset.bootPreview = "canvas-warmup";
      showCanvas("Canvas · warming WebGPU");
    });
    cancelWarmup = warmup.cancel;
    void warmup.during(boot()).catch(useFallback);
    return () => {
      disposed = true; cancelWarmup();
      visibility.disconnect(); resize.disconnect();
      cleanupGpu(); fallbackStop();
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerleave", leave);
    };
  }, [variant, miniature, ambient, settings, input, glass]);
  return <div className="gpu-scene" data-renderer={renderer} data-ready={ready}>
    <canvas ref={fallback} className="scene-fallback" aria-hidden="true" />
    <canvas ref={canvas} aria-label="Live refractive light field; move the pointer to bend its horizon" />
    {!miniature && <span className="render-label">{renderer}</span>}
  </div>;
}

function paintGlass(ctx: CanvasRenderingContext2D, width: number, height: number, m: Motion, variant: number) {
  const scale = height * .5, centerX = width * .66 + m.pointer.x * 12, centerY = height * .5 - m.pointer.y * 9;
  const rgb = m.color.map(c => Math.round(c * 255)).join(",");
  ctx.fillStyle = "#020305"; ctx.fillRect(0,0,width,height);
  ctx.save(); ctx.translate(centerX,centerY); ctx.rotate(-.13);
  const radius = scale * .48 * (.9 + m.amplitude * .1) * (1 - m.spread * .05), mode = variant === 0 ? 0 : m.to;
  const halo = ctx.createRadialGradient(0,0,radius*.7,0,0,radius*1.8);
  halo.addColorStop(0,`rgba(${rgb},0)`); halo.addColorStop(.34,`rgba(${rgb},.18)`); halo.addColorStop(1,`rgba(${rgb},0)`);
  ctx.fillStyle = halo; ctx.fillRect(-scale*2,-scale*2,scale*4,scale*4);
  if (mode === 0) {
    ctx.shadowColor = `rgba(${rgb},.7)`; ctx.shadowBlur = 22;
    ctx.strokeStyle = `rgba(${rgb},.8)`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0,0,radius,radius,0,0,Math.PI*2); ctx.stroke();
    const beam = ctx.createLinearGradient(0,-scale*.16,0,scale*.16);
    beam.addColorStop(0,`rgba(${rgb},0)`); beam.addColorStop(.46,`rgba(${rgb},.12)`); beam.addColorStop(.50,"rgba(255,232,200,.9)"); beam.addColorStop(.54,`rgba(${rgb},.12)`); beam.addColorStop(1,`rgba(${rgb},0)`);
    ctx.fillStyle=beam;ctx.fillRect(-scale*2,-scale*.16,scale*4,scale*.32);
    ctx.shadowBlur=0;ctx.fillStyle="#020305";ctx.beginPath();ctx.arc(0,0,radius*.98,0,Math.PI*2);ctx.fill();
  } else {
    ctx.rotate(-.3 + (mode-1)*.21 + Math.sin(m.time*.04)*.1);
    const layers = mode===3 ? 5 : 3;
    for (let layer=0;layer<layers;layer++) {
      ctx.beginPath();
      for (let step=0;step<=90;step++) {
        const x=(step/90-.5)*width*1.5, y=Math.sin(x/scale*1.3+m.time*.12+layer*.2)*scale*.2+(layer-1)*scale*.16;
        if(step===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
      }
      ctx.lineWidth=3+layer;ctx.shadowBlur=24;ctx.shadowColor=`rgba(${rgb},.7)`;ctx.strokeStyle=`rgba(${rgb},${.35+layer*.15})`;ctx.stroke();
      ctx.lineWidth=.7;ctx.shadowBlur=0;ctx.strokeStyle="rgba(238,245,255,.6)";ctx.stroke();
    }
  }
  ctx.restore();
}
function drawFallback(canvas: HTMLCanvasElement, variant: number, settings: MutableRefObject<SceneSettings>, detached: MutableRefObject<boolean>, pointer: Pointer, reduced: MediaQueryList, miniature: boolean, isVisible: () => boolean, onReady: () => void) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  let raf = 0, firstFrame = true, lastPaint = 0;
  const motion = createMotion(settings.current);
  const drawFrame = (now: number) => {
    raf=requestAnimationFrame(drawFrame);
    if(!firstFrame && (document.hidden || !isVisible() || now-lastPaint < (reduced.matches ? 80 : 40))) return;
    lastPaint=now;
    const box = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio,miniature?1:1.25);
    const width = Math.max(1,Math.round(box.width*dpr)), height = Math.max(1,Math.round(box.height*dpr));
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    const current=motion(settings.current,detached.current,pointer,reduced.matches,now);
    canvas.dataset.shape=String(current.to);canvas.dataset.morph=current.progress.toFixed(3);
    ctx.setTransform(dpr,0,0,dpr,0,0);paintGlass(ctx,box.width,box.height,current,variant);
    if(firstFrame){firstFrame=false;onReady();}
  };
  raf=requestAnimationFrame(drawFrame);
  return ()=>cancelAnimationFrame(raf);
}
