import { describe, expect, test } from "bun:test";
import type { Gpu } from "vgpu";
import { createGpuPool, opticalBackingSize, opticalFrameDeadline, startOpticalWarmup } from "./gpu-runtime";

function fakeGpu() {
  let lose!: () => void;
  const state = { disposals: 0 };
  const gpu = { lost: new Promise<void>(resolve => { lose = resolve; }), dispose: () => { state.disposals++; lose(); } } as unknown as Gpu;
  return { gpu, state, lose };
}
describe("shared optical GPU lifetime", () => {
  test("concurrent views acquire one device; removing one leaves the other running", async () => {
    const device = fakeGpu(); let starts = 0;
    const pool = createGpuPool(async () => { starts++; return device.gpu; });
    const [background, foreground] = await Promise.all([pool.acquire(),pool.acquire()]);
    expect(starts).toBe(1); expect(background.id).toBe(foreground.id); expect(pool.contextCount()).toBe(1);
    background.release(); background.release();
    expect(device.state.disposals).toBe(0); expect(pool.viewCount()).toBe(1);
    foreground.release(); expect(device.state.disposals).toBe(1); expect(pool.contextCount()).toBe(0);
  });
  test("failed initialization does not poison a later acquisition", async () => {
    const device = fakeGpu(); let starts = 0;
    const pool = createGpuPool(async () => { if (++starts === 1) throw new Error("adapter unavailable"); return device.gpu; });
    const failed = await Promise.allSettled([pool.acquire(),pool.acquire()]);
    expect(failed.every(result => result.status === "rejected")).toBe(true);
    const next = await pool.acquire(); expect(starts).toBe(2); next.release(); expect(device.state.disposals).toBe(1);
  });
  test("a lost device is replaced without an old view disposing the replacement", async () => {
    const first = fakeGpu(), second = fakeGpu(); let starts = 0;
    const pool = createGpuPool(async () => ++starts === 1 ? first.gpu : second.gpu);
    const original = await pool.acquire(); first.lose(); await Promise.resolve();
    const replacement = await pool.acquire(); expect(replacement.id).not.toBe(original.id);
    original.release(); expect(second.state.disposals).toBe(0); expect(pool.contextCount()).toBe(1);
    replacement.release(); expect(second.state.disposals).toBe(1);
  });
});

test("overscanned ambient backing stays bounded while foreground stays crisp", () => {
  const [aw,ah] = opticalBackingSize(1600,1200,2,true);
  expect(aw*ah).toBeLessThanOrEqual(1_200_000); expect(Math.abs(aw/ah-1600/1200)).toBeLessThan(.003);
  expect(opticalBackingSize(600,400,2)).toEqual([750,500]);
  const [fw,fh] = opticalBackingSize(4000,3000,2);
  expect(fw*fh).toBeLessThanOrEqual(3_000_000);
});

test("120 Hz jitter does not accumulate optical frame drift or hidden-frame catchup", () => {
  let deadline = 0, submitted = 0;
  for (let tick=0;tick<600;tick++) {
    const now = tick*1000/120 + Math.sin(tick*1.73)*1.2;
    const next = opticalFrameDeadline(now,deadline,1000/60);
    if (next !== undefined) { submitted++; deadline=next; }
  }
  expect(submitted).toBeGreaterThanOrEqual(299); expect(submitted).toBeLessThanOrEqual(301);
  const resumed = opticalFrameDeadline(60_000,deadline,1000/60)!;
  expect(resumed).toBeGreaterThan(60_000); expect(resumed).toBeLessThan(60_018);
});

test("slow GPU acquisition survives warmup preview and promotes without destroying the device", async () => {
  const device = fakeGpu(); let ready!: (gpu: Gpu) => void;
  const pending = new Promise<Gpu>(resolve => { ready=resolve; });
  const pool = createGpuPool(() => pending), renders: string[] = [];
  const warmup = startOpticalWarmup(() => renders.push("canvas-warmup"),5);
  const acquisition = warmup.during(pool.acquire());
  await Bun.sleep(15);
  expect(renders).toEqual(["canvas-warmup"]); expect(device.state.disposals).toBe(0);
  ready(device.gpu);
  const lease = await acquisition; renders.push("webgpu");
  expect(renders).toEqual(["canvas-warmup","webgpu"]); expect(pool.contextCount()).toBe(1);
  expect(device.state.disposals).toBe(0); lease.release(); expect(device.state.disposals).toBe(1);
});
test("cancelling the warmup view suppresses its preview without rejecting GPU work", async () => {
  let previews = 0;
  const warmup = startOpticalWarmup(() => { previews++; },5);
  warmup.cancel();
  expect(await warmup.during(Promise.resolve("gpu-ready"))).toBe("gpu-ready");
  await Bun.sleep(10); expect(previews).toBe(0);
});
