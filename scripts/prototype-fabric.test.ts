import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NativeFabric, validFabricAction, validKind } from "./prototype-fabric";
import { createWorkload } from "./prototype-fabric-worker";

describe("bounded native workloads", () => {
  test("particle, fractal and signal workloads compute advancing numerical state", () => {
    const render = createWorkload("render");
    const first = render(0), second = render(1);
    expect(first.particles).toBe(768);
    expect(second.positionsIntegrated).toBe(1536);
    expect(second.energy).not.toBe(first.energy);
    const compute = createWorkload("compute");
    const frame = compute(0), next = compute(1);
    expect(frame.cells).toBe(960);
    expect(Number(next.totalIterations)).toBeGreaterThan(Number(frame.totalIterations));
    expect(next.fieldChecksum).not.toBe(frame.fieldChecksum);
    const signals = createWorkload("signals");
    const signal = signals(0), pulsed = signals(1);
    expect(signal.samples).toBe(512);
    expect(Number(pulsed.peak)).toBeGreaterThan(Number(signal.peak));
    expect(pulsed.samplesProcessed).toBe(1024);
    for (const metrics of [second, next, pulsed]) {
      expect(metrics.bins).toBeArrayOfSize(8);
      expect((metrics.bins as number[]).every(Number.isFinite)).toBe(true);
    }
  });
  test("closed command and workload enums reject execution requests", () => {
    for (const value of ["pulse; pwd", "resume\nls", "pause now", "$(whoami)", "reset", "", null]) expect(validFabricAction(value)).toBe(false);
    for (const value of ["render; pwd", "shell", "compute extra", "", null]) expect(validKind(value)).toBe(false);
  });
});

const phux = Bun.which("phux");
async function fixture() {
  const runtime = await mkdtemp(join(tmpdir(), "fabric-test-"));
  const token = crypto.randomUUID();
  let fabric: NativeFabric;
  const bridge = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    try { return Response.json(fabric.acceptTick(await request.json() as Record<string, unknown>, request.headers.get("x-fabric-token"))); }
    catch { return new Response("Refused", { status: 403 }); }
  } });
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PHUX_") && key !== "TYPESAFE_API_KEY"));
  fabric = new NativeFabric({ phux: phux!, root: resolve(import.meta.dir, ".."), runtime, socket: join(runtime, "fixture-root"), rootPid: process.pid,
    token, env: { ...inherited, SHELL: "/bin/sh", TERM: "xterm-256color", PHUX_FABRIC_ENDPOINT: `http://127.0.0.1:${bridge.port}`, PHUX_FABRIC_TOKEN: token },
    rootState: () => ({}), rootCommand: async () => { throw new Error("Fixture root has no native scene."); },
  });
  return { fabric, token, runtime, close: async () => {
    await fabric.close();
    bridge.stop(true);
    await rm(runtime, { recursive: true, force: true });
  } };
}
test.skipIf(!phux)("a real native host owns live child sessions, acknowledges commands, and cleans every process", async () => {
  const { fabric, token, runtime, close } = await fixture();
  const pids: number[] = [];
  let hostDirectory = "";
  try {
    expect(fabric.snapshot().hosts).toHaveLength(1);
    expect(fabric.snapshot().sessions).toHaveLength(1);
    const { host, session } = await fabric.createHost({ parentHostId: "studio" });
    pids.push(host.pid, session.pid);
    hostDirectory = join(runtime, host.id);
    expect(host.local).toBe(true);
    expect(host.pid).not.toBe(process.pid);
    expect(session.connected).toBe(true);
    const child = await fabric.createSession({ hostId: host.id, parentSessionId: session.id, kind: "compute" });
    pids.push(child.session.pid);
    expect(child.session.parentSessionId).toBe(session.id);
    expect(child.session.hostId).toBe(host.id);
    await Bun.sleep(650);
    const active = fabric.snapshot().sessions.find(item => item.id === child.session.id)!;
    expect(active.ticks).toBeGreaterThan(0);
    expect(Number(active.metrics.totalIterations)).toBeGreaterThan(0);
    expect(active.metrics.bins).toBeArrayOfSize(8);
    expect(fabric.detail(active.id).session.recentlines.join(" ")).toContain("Computing a 40 × 24");
    const paused = await fabric.command({ sessionId: active.id, action: "pause" });
    expect(paused.session.paused).toBe(true);
    const work = paused.session.metrics.totalIterations;
    const pausedLines = fabric.detail(active.id).session.recentlines.length;
    await Bun.sleep(1250);
    const still = fabric.snapshot().sessions.find(item => item.id === active.id)!;
    expect(still.ticks).toBeGreaterThan(paused.session.ticks);
    expect(still.metrics.totalIterations).toBe(work);
    expect(fabric.detail(active.id).session.recentlines).toHaveLength(pausedLines);
    const resumed = await fabric.command({ sessionId: active.id, action: "resume" });
    expect(resumed.session.paused).toBe(false);
    expect(resumed.session.commandRevision).toBe(2);
    const pulsed = await fabric.command({ sessionId: session.id, action: "pulse" });
    expect(pulsed.session.lastCommand).toBe("pulse");
    expect(JSON.parse(await fabric.screen(active.id))).toBeObject();
    const trace = fabric.snapshot().events.filter(event => event.messageId === pulsed.messageId);
    expect(trace.map(event => event.status)).toEqual(["sent", "applied"]);
    expect(() => fabric.acceptTick({ sessionId: active.id }, "wrong-token")).toThrow("Refused");
    expect(() => fabric.command({ sessionId: active.id, action: "pulse; pwd" as "pulse" })).toThrow("Choose pulse");
    await expect(fabric.createSession({ hostId: "nonexistent" })).rejects.toThrow("Unknown host");
    // Concurrent activation must not race past the advertised native limits.
    const extraHosts = await Promise.all([fabric.createHost({}), fabric.createHost({})]);
    for (const extra of extraHosts) pids.push(extra.host.pid, extra.session.pid);
    await expect(fabric.createHost({})).rejects.toThrow("limited to 4 hosts");
    const activations = await Promise.allSettled(Array.from({ length: 10 }, () => fabric.createSession({ hostId: host.id, kind: "signals" })));
    const successes = activations.filter(item => item.status === "fulfilled");
    const refused = activations.filter(item => item.status === "rejected");
    for (const item of successes) pids.push(item.value.session.pid);
    expect(successes).toHaveLength(7);
    expect(refused).toHaveLength(3);
    expect(fabric.snapshot().hosts).toHaveLength(4);
    expect(fabric.snapshot().sessions).toHaveLength(12);
    expect(refused.every(item => String(item.reason).includes("limited to 12 sessions"))).toBe(true);
  } finally {
    await close();
  }
  for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
  await expect(access(hostDirectory)).rejects.toThrow();
}, 20_000);

test.skipIf(!phux)("native teardown preserves accepted command order and removes actual descendants across hosts", async () => {
  const { fabric, token, close } = await fixture();
  const pids: number[] = [];
  try {
    const a = await fabric.createHost({});
    const b = await fabric.createHost({ parentHostId: a.host.id });
    pids.push(a.host.pid, a.session.pid, b.host.pid, b.session.pid);
    const cross = await fabric.createSession({ hostId: b.host.id, kind: "compute", parentSessionId: a.session.id });
    const leaf = await fabric.createSession({ hostId: a.host.id, kind: "signals", parentSessionId: cross.session.id });
    pids.push(cross.session.pid, leaf.session.pid);
    const accepted = ["pause", "resume", "pulse"].map(action => fabric.command({ sessionId: cross.session.id, action: action as "pulse" }));
    const removing = fabric.deleteSession({ sessionId: a.session.id });
    const receipts = await Promise.all(accepted);
    expect(receipts.map(result => result.session.lastCommand)).toEqual(["pause", "resume", "pulse"]);
    expect(receipts.map(result => result.session.commandRevision)).toEqual([1, 2, 3]);
    const removed = await removing;
    expect(new Set(removed.removedSessionIds)).toEqual(new Set([a.session.id, cross.session.id, leaf.session.id]));
    expect(removed.removedHostIds).toEqual([]);
    const remaining = fabric.snapshot();
    expect(remaining.sessions.map(session => session.id)).toEqual(["scene", b.session.id]);
    for (const pid of [a.session.pid, cross.session.pid, leaf.session.pid]) expect(() => process.kill(pid, 0)).toThrow();
    expect(() => fabric.command({ sessionId: cross.session.id, action: "pulse" })).toThrow("Unknown session");
    expect(() => fabric.acceptTick({ sessionId: cross.session.id }, token)).toThrow("Unknown session");
    const independent = await fabric.createHost({});
    const child = await fabric.createSession({ hostId: b.host.id, kind: "compute", parentSessionId: b.session.id });
    const external = await fabric.createSession({ hostId: independent.host.id, kind: "signals", parentSessionId: child.session.id });
    pids.push(independent.host.pid, independent.session.pid, child.session.pid, external.session.pid);
    const topology = await fabric.deleteHost({ hostId: a.host.id });
    expect(new Set(topology.removedHostIds)).toEqual(new Set([a.host.id, b.host.id]));
    expect(new Set(topology.removedSessionIds)).toEqual(new Set([b.session.id, child.session.id, external.session.id]));
    expect(fabric.snapshot().hosts.map(host => host.id)).toEqual(["studio", independent.host.id]);
    expect(fabric.snapshot().sessions.map(session => session.id)).toEqual(["scene", independent.session.id]);
    for (const pid of [a.host.pid, b.host.pid, b.session.pid, child.session.pid, external.session.pid]) expect(() => process.kill(pid, 0)).toThrow();
    await expect(fabric.deleteHost({ hostId: "studio" })).rejects.toThrow("protected");
    await expect(fabric.deleteSession({ sessionId: "scene" })).rejects.toThrow("protected");
    const compact = fabric.snapshot({ compact: true });
    expect(compact.sessions.every(session => !("recentlines" in session))).toBe(true);
    expect(fabric.snapshot({ compact: true, after: compact.eventCursor }).events).toEqual([]);
    expect(fabric.snapshot({ compact: true, after: compact.eventCursor }).revision).toBe(compact.revision);
    expect(fabric.detail(independent.session.id).session.recentlines.length).toBeGreaterThan(0);
    expect(JSON.stringify(fabric.snapshot())).not.toContain(token);
  } finally { await close(); }
  for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
}, 20_000);
