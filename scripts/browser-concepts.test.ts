import { describe, expect, test } from "bun:test";
import { BrowserEngine, BROWSER_LIMITS, type EngineReply } from "../src/components/prototype/vgpu/browser-engine";
import { createWorkload } from "../src/components/prototype/vgpu/workloads";
import { isBrowserConceptPath } from "../src/components/prototype/vgpu/transport";

const data = (reply: EngineReply) => reply.body as any;
describe("standalone browser concepts", () => {
  test("all three shared workloads produce real numerical bins and advancing work", () => {
    for (const kind of ["render", "compute", "signals"] as const) {
      const workload = createWorkload(kind);
      const first = workload(0), second = workload(1);
      expect(first.bins).toBeArrayOfSize(8);
      expect((second.bins as number[]).every(Number.isFinite)).toBe(true);
      expect(second).not.toEqual(first);
    }
  });
  test("closed scene commands preserve phase and reject execution or invalid ranges", () => {
    const engine = new BrowserEngine(1000);
    expect(engine.request("/command", "POST", { command: "shape wave" }, 1000).status).toBe(200);
    expect(engine.request("/command", "POST", { command: "speed .3" }, 1000).status).toBe(200);
    engine.tick(2000);
    const state = data(engine.request("/state", "GET", {}, 2000));
    expect(state.shape).toBe("wave");
    expect(state.sceneTime).toBeCloseTo(.3);
    expect(state.engine).toBe("browser");
    expect(state).not.toHaveProperty("pid");
    for (const command of ["shape wave; pwd", "pause now", "speed -1", "speed 3.1", "amplitude Infinity", "$(whoami)"]) expect(engine.request("/command", "POST", { command }, 2000).status).toBe(400);
  });
  test("natural language never pretends to call Jev", () => {
    const engine = new BrowserEngine(1000);
    const response = engine.request("/intent", "POST", { text: "a liquid glass world", source: "browser" }, 1000);
    expect(response.status).toBe(503);
    expect(data(response).error).toContain("Jev requires the local native preview");
    const state = data(engine.request("/state", "GET", {}, 1000));
    expect(state.jevAvailable).toBe(false);
    expect(state.lastIntent).toBeNull();
  });
  test("creation bounds include primary scene and failed group creation rolls back", () => {
    const engine = new BrowserEngine(1000);
    for (let i = 1; i < BROWSER_LIMITS.sessions; i++) expect(engine.request("/fabric/session", "POST", { kind: "compute" }, 1000).status).toBe(200);
    expect(engine.request("/fabric/session", "POST", {}, 1000).status).toBe(409);
    expect(engine.request("/fabric/host", "POST", {}, 1000).status).toBe(409);
    const fabric = data(engine.request("/fabric", "GET", {}, 1000));
    expect(fabric.sessions).toHaveLength(7);
    expect(fabric.hosts).toHaveLength(1);
  });
  test("logical groups are bounded and accurately identified", () => {
    const engine = new BrowserEngine(1000);
    const first = data(engine.request("/fabric/host", "POST", {}, 1000));
    const second = data(engine.request("/fabric/host", "POST", { parentHostId: first.host.id }, 1000));
    expect(second.host.parentHostId).toBe(first.host.id);
    expect(first.host.logical).toBe(true);
    expect(first.host.local).toBe(false);
    expect(first.host).not.toHaveProperty("pid");
    expect(engine.request("/fabric/host", "POST", {}, 1000).status).toBe(409);
    expect(engine.request("/fabric/host", "DELETE", { hostId: "studio" }, 1000).status).toBe(403);
    expect(engine.request("/fabric/session", "DELETE", { sessionId: "scene" }, 1000).status).toBe(403);
  });
  test("group teardown cascades across group boundaries and invalidates removed tasks", () => {
    const engine = new BrowserEngine(1000);
    const a = data(engine.request("/fabric/host", "POST", {}, 1000));
    const b = data(engine.request("/fabric/host", "POST", { parentHostId: a.host.id }, 1000));
    const external = data(engine.request("/fabric/session", "POST", { hostId: "studio", kind: "signals", parentSessionId: b.session.id }, 1000));
    const removed = data(engine.request("/fabric/host", "DELETE", { hostId: a.host.id }, 1000));
    expect(new Set(removed.removedSessionIds)).toEqual(new Set([a.session.id, b.session.id, external.session.id]));
    expect(data(engine.request("/fabric", "GET", {}, 1000)).sessions).toHaveLength(1);
    expect(engine.request("/fabric/command", "POST", { sessionId: external.session.id, action: "resume" }, 1000).status).toBe(400);
    expect(engine.request("/fabric/session?sessionId=" + external.session.id, "GET", {}, 1000).status).toBe(400);
  });
  test("pause and hidden state suspend computation while ordered commands retain revisions", () => {
    const engine = new BrowserEngine(1000);
    const session = data(engine.request("/fabric/session", "POST", { kind: "compute" }, 1000)).session;
    engine.request("/fabric/command", "POST", { sessionId: session.id, action: "pause" }, 1000);
    const iterations = session.metrics.totalIterations;
    engine.tick(1500);
    expect(session.metrics.totalIterations).toBe(iterations);
    engine.request("/fabric/command", "POST", { sessionId: session.id, action: "resume" }, 1500);
    engine.request("/fabric/command", "POST", { sessionId: session.id, action: "pulse" }, 1500);
    expect(session.commandRevision).toBe(3);
    engine.setVisible(false, 1500);
    engine.tick(2500);
    expect(session.metrics.totalIterations).toBe(iterations);
    engine.setVisible(true, 2500);
    engine.tick(3000);
    expect(session.metrics.totalIterations).toBeGreaterThan(iterations);
  });
  test("compact revisions skip unchanged rows; closing invalidates the runtime", () => {
    for (const path of ["/concepts/vgpu", "/concepts/vgpu/", "/concepts/vgpu.html", "/concepts/vgpu/index.html"]) expect(isBrowserConceptPath(path)).toBe(true);
    expect(isBrowserConceptPath("/prototype/vgpu")).toBe(false);
    const engine = new BrowserEngine(1000);
    engine.request("/fabric/session", "POST", {}, 1000);
    const initial = data(engine.request("/fabric?compact=1", "GET", {}, 1000));
    const query = new URLSearchParams({ compact: "1", revision: initial.revision, after: String(initial.eventCursor) });
    expect(engine.request("/fabric?" + query, "GET", {}, 1000).status).toBe(204);
    expect(initial.sessions.every((session: any) => !Object.hasOwn(session, "recentlines"))).toBe(true);
    engine.tick(1500);
    expect(engine.request("/fabric?" + query, "GET", {}, 1500).status).toBe(200);
    engine.close();
    expect(engine.request("/state").status).toBe(410);
  });
  test("shared scene settings are validated and keep a common phase between tabs", () => {
    const first = new BrowserEngine(1000), second = new BrowserEngine(2000);
    first.request("/command", "POST", { command: "color cyan" }, 1000);
    first.tick(1500);
    expect(second.restoreScene(first.sharedScene(), 2000)).toBe(true);
    expect(second.sharedScene().color).toBe("cyan");
    expect(second.sharedScene().sceneTime).toBeCloseTo(1);
    expect(data(second.request("/state", "GET", {}, 2000)).startedAt).toBe(2000);
    expect(data(second.request("/state", "GET", {}, 2000)).compositionStartedAt).toBe(1000);
    expect(second.restoreScene({ ...first.sharedScene(), speed: 500 }, 2000)).toBe(false);
  });
  test("the actual dedicated Worker computes and stops ticking while hidden", async () => {
    const worker = new Worker(new URL("../src/components/prototype/vgpu/browser-worker.ts", import.meta.url).href);
    let counter = 0;
    const request = (path: string, method = "GET", body = {}) => new Promise<EngineReply>((resolve, reject) => {
      const id = String(++counter);
      const timeout = setTimeout(() => reject(new Error("Worker timeout")), 3000);
      const receive = (event: MessageEvent) => {
        if (event.data.id !== id) return;
        clearTimeout(timeout); worker.removeEventListener("message", receive); resolve(event.data);
      };
      worker.addEventListener("message", receive);
      worker.postMessage({ type: "request", id, path, method, body });
    });
    try {
      const created = data(await request("/fabric/session", "POST", { kind: "signals" })).session;
      await Bun.sleep(600);
      const before = data(await request("/fabric/session?sessionId=" + created.id)).session;
      expect(before.metrics.samplesProcessed).toBeGreaterThan(512);
      worker.postMessage({ type: "visibility", visible: false });
      await Bun.sleep(600);
      const hidden = data(await request("/fabric/session?sessionId=" + created.id)).session;
      expect(hidden.ticks).toBe(before.ticks);
      expect(hidden.metrics.samplesProcessed).toBe(before.metrics.samplesProcessed);
    } finally { worker.terminate(); }
  }, 5000);
});
