import type { Gpu } from "vgpu";

type Entry = { id: number; users: number; promise: Promise<Gpu> };
export type GpuLease = { gpu: Gpu; id: number; release: () => void };

/** One device and pipeline cache per page, with independently owned surfaces. */
export function createGpuPool(start: () => Promise<Gpu>) {
  let current: Entry | undefined, serial = 0;
  const live = new Set<Entry>();
  const create = () => {
    const entry: Entry = { id: ++serial, users: 0, promise: undefined! };
    entry.promise = Promise.resolve().then(start).then(gpu => {
      live.add(entry);
      void gpu.lost.then(() => {
        live.delete(entry);
        if (current === entry) current = undefined;
      });
      return gpu;
    }, error => {
      if (current === entry) current = undefined;
      throw error;
    });
    current = entry;
    return entry;
  };
  return {
    async acquire(): Promise<GpuLease> {
      const entry = current ?? create();
      entry.users++;
      let gpu: Gpu;
      try { gpu = await entry.promise; }
      catch (error) { entry.users--; throw error; }
      let released = false;
      return { gpu, id: entry.id, release: () => {
        if (released) return;
        released = true;
        if (--entry.users > 0) return;
        if (current === entry) current = undefined;
        live.delete(entry);
        gpu.dispose();
      } };
    },
    contextCount: () => live.size,
    viewCount: () => [...live].reduce((count, entry) => count + entry.users, 0),
  };
}

/** CSS geometry is unchanged; only backing resolution is bounded for ambient overscan. */
export function opticalBackingSize(width: number, height: number, dpr: number, ambient = false, miniature = false): [number, number] {
  const safeWidth = Math.max(1,width), safeHeight = Math.max(1,height);
  const budget = miniature ? 300_000 : ambient ? 1_200_000 : 3_000_000;
  const preferred = Math.min(dpr,ambient || miniature ? 1 : 1.25);
  const scale = Math.min(preferred,Math.sqrt(budget/(safeWidth*safeHeight)));
  return [Math.max(1,Math.floor(safeWidth*scale)),Math.max(1,Math.floor(safeHeight*scale))];
}

/** Preserve frame phase through display jitter; missed periods never cause a submission burst. */
export function opticalFrameDeadline(now: number, deadline: number, interval: number): number | undefined {
  if (now+0.75 < deadline) return undefined;
  return deadline+Math.max(1,Math.floor((now-deadline+0.75)/interval)+1)*interval;
}

/** A slow preview is temporary: its timer never cancels or races GPU initialization. */
export function startOpticalWarmup(showPreview: () => void, delay = 1500) {
  const timeout = setTimeout(showPreview,delay);
  const cancel = () => clearTimeout(timeout);
  return {
    cancel,
    async during<T>(work: Promise<T>): Promise<T> {
      try { return await work; }
      finally { cancel(); }
    },
  };
}

export const gpuPool = createGpuPool(async () => {
  const { init } = await import("vgpu");
  // Timing is optional. Ordinary rendering still works on adapters without it.
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "low-power" });
  const requiredFeatures: GPUFeatureName[] = adapter?.features.has("timestamp-query") ? ["timestamp-query"] : [];
  return init({ powerPreference: "low-power", requiredFeatures });
});
