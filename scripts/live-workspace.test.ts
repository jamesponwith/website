import { expect, test } from "bun:test";
import { LiveSession, canAct, initialSession, isBusy, readGrid, step, type SessionEvent, type SessionState } from "../src/components/prototype/vgpu/live/session";
import type { MountOptions, PhuxController } from "../src/components/terminal/core";

const grid = (count: number) => ({ cols: 120, rows: 24, panes: Array.from({ length: count }, (_, i) => ({ id: `@${i + 1}`, x: i * 30, y: 0, cols: 29, rows: 24 })) });
const run = (state: SessionState, ...events: SessionEvent[]) => events.reduce(step, state);
const live = run(initialSession, { type: "live" }, { type: "announce", focused: "@1", pending: false, error: "" }, { type: "paint", grid: grid(1) });

test("published geometry is taken as given; anything malformed is dropped", () => {
  expect(readGrid({ ...grid(2), pixelWidth: 10 })).toEqual(grid(2));
  const one = grid(1).panes[0];
  const invalid = [null, {}, { ...grid(1), cols: NaN }, { ...grid(1), rows: 0 }, { ...grid(1), panes: [{ ...one, x: -1 }] }, { ...grid(1), panes: [{ ...one, cols: 121 }] }, { ...grid(1), panes: [one, one] }, { ...grid(1), panes: Array(5).fill(one) }];
  for (const value of invalid) expect(readGrid(value)).toBeNull();
});

test("a split is one operation until its first frame after the server settles", () => {
  const asked = step(live, { type: "request" });
  expect(canAct(asked)).toBe(false);
  expect(step(asked, { type: "request" })).toBe(asked);
  const working = run(asked, { type: "announce", focused: "@1", pending: true, error: "" }, { type: "paint", grid: grid(2) });
  expect(isBusy(working)).toBe(true);
  const done = run(working, { type: "announce", focused: "@2", pending: false, error: "" }, { type: "paint", grid: grid(2) });
  expect(canAct(done)).toBe(true);
  expect(done.focused).toBe("@2");
  expect(done.panes.length).toBe(2);
});

test("a refused split releases the workspace and reports why", () => {
  const refused = run(live, { type: "request" }, { type: "announce", focused: "@1", pending: false, error: "pane limit" });
  expect(canAct(refused)).toBe(true);
  expect(refused.error).toBe("pane limit");
  expect(refused.focused).toBe("@1");
});

test("an identical frame changes nothing, so the view does not re-render per paint", () => {
  expect(step(live, { type: "paint", grid: grid(1) })).toBe(live);
});

test("a lost connection ends the session and nothing acts on it afterwards", () => {
  const closed = run(live, { type: "request" }, { type: "fail", error: "gone" });
  expect(closed.phase).toBe("closed");
  expect(isBusy(closed)).toBe(false);
  expect(canAct(closed)).toBe(false);
  expect(step(closed, { type: "live" }).phase).toBe("closed");
});

// The controller, driven through the events the real client dispatches.
class TestCanvas extends EventTarget {
  dataset: Record<string, string> = {}; id = ""; className = ""; tabIndex = 0;
  setAttribute() {} focus() {} remove() {}
}
async function harness(test: (h: { session: LiveSession; emit: (name: string, detail: unknown) => void; calls: { splits: number; closes: number; sizes: string[]; text: string[] } }) => void | Promise<void>) {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => { saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { value, writable: true, configurable: true }); };
  install("document", { createElement: () => new TestCanvas() });
  install("window", new EventTarget());
  install("MutationObserver", class { observe() {} disconnect() {} });
  const calls = { splits: 0, closes: 0, sizes: [] as string[], text: [] as string[] };
  const controller = { close() { calls.closes++; }, resize(cols: number, rows: number) { calls.sizes.push(`${cols}x${rows}`); }, splitPane() { calls.splits++; }, sendText(text: string) { calls.text.push(text); }, focusPane() {}, closePane() {} } as unknown as PhuxController;
  const session = new LiveSession(async (options: MountOptions) => {
    (session.canvas as unknown as TestCanvas).dataset = { phuxCellWidth: "9", phuxCellHeight: "16" };
    options.onEvent?.({ type: "phux.session.v1", backend: "edge" } as never);
    return controller;
  });
  const emit = (name: string, detail: unknown) => { const event = new Event(name); Object.defineProperty(event, "detail", { value: detail }); session.canvas.dispatchEvent(event); };
  try {
    await session.connect("ws://test.invalid/session", { width: 900, height: 384 });
    emit("phux-panes", { focused: "@1", pending: false });
    emit("phux-render", grid(1));
    await test({ session, emit, calls });
  } finally {
    session.dispose();
    saved.forEach((descriptor, name) => descriptor ? Object.defineProperty(globalThis, name, descriptor) : Reflect.deleteProperty(globalThis, name));
  }
}

test("rapid splits reach the server once, and input waits for the new pane", () => harness(({ session, emit, calls }) => {
  session.split("vertical"); session.split("vertical"); session.run("echo must-wait");
  expect(calls.splits).toBe(1);
  expect(calls.text).toEqual([]);
  emit("phux-panes", { focused: "@1", pending: true });
  emit("phux-panes", { focused: "@2", pending: false });
  emit("phux-render", grid(2));
  session.run("echo now");
  expect(calls.text).toEqual(["echo now\n"]);
  expect(session.getSnapshot().backend).toBe("edge");
}));

test("the grid is fitted in whole cells of the measured font and only when it changes", () => harness(({ session, calls }) => {
  session.fit(900, 384); session.fit(904, 390);
  expect(calls.sizes).toEqual(["100x24"]);
  session.fit(450, 384);
  expect(calls.sizes).toEqual(["100x24", "50x24"]);
}));

test("disposing twice releases the client exactly once", () => harness(({ session, calls }) => {
  session.dispose(); session.dispose();
  expect(calls.closes).toBe(1);
}));
