import type { Timer, TimerSpan } from "vgpu";
import { gpuPool } from "./gpu-runtime";

let nextSurface = 0;

/** Low-rate DOM diagnostics; GPU milliseconds only come from native timestamp queries. */
export function createRenderMetrics(canvas: HTMLCanvasElement, deviceId: number, timing?: Timer) {
  let started = performance.now(), frames = 0, cpu = 0, gpuSamples = 0, active = false;
  let gpuMean = 0, sampleAt = -Infinity;
  const spanName = `optical-field-${deviceId}-${++nextSurface}`;
  const span: TimerSpan | undefined = timing?.span(spanName);
  const unsubscribe = timing?.onResults(results => {
    const duration = results[spanName];
    if (duration === undefined || !Number.isFinite(duration)) return;
    gpuSamples++; gpuMean += (duration - gpuMean) / Math.min(gpuSamples, 12);
    canvas.dataset.gpuMs = gpuMean.toFixed(3);
    canvas.dataset.gpuSamples = String(gpuSamples);
  });
  canvas.dataset.gpuSpan = spanName;
  canvas.dataset.gpuDevice = String(deviceId);
  canvas.dataset.gpuTiming = timing ? "timestamp-query" : "unavailable";
  return {
    sample(now: number) {
      if (!span || now - sampleAt < 500) return undefined;
      sampleAt = now;
      return span;
    },
    submitted(now: number, cpuMs: number) {
      frames++; cpu += cpuMs;
      if (!active) { active = true; canvas.dataset.active = "true"; }
      if (now - started < 1000) return;
      canvas.dataset.renderFps = (frames * 1000 / (now - started)).toFixed(2);
      canvas.dataset.cpuMs = (cpu / frames).toFixed(3);
      canvas.dataset.renderPixels = String(canvas.width * canvas.height);
      canvas.dataset.gpuContexts = String(gpuPool.contextCount());
      canvas.dataset.gpuViews = String(gpuPool.viewCount());
      started = now; frames = 0; cpu = 0;
    },
    idle() {
      if (!active) return;
      active = false;
      canvas.dataset.active = "false";
      canvas.dataset.renderFps = "0";
      started = performance.now(); frames = 0; cpu = 0;
    },
    dispose() {
      unsubscribe?.(); timing?.dispose();
      canvas.dataset.active = "false"; canvas.dataset.renderFps = "0";
    },
  };
}
