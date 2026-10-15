// A real, bounded workload inside a native PHUX PTY. No shell evaluation.
import { createInterface } from "node:readline";

import { createWorkload, type WorkloadKind, type WorkloadMetrics } from "../src/components/prototype/vgpu/workloads";
export { createWorkload } from "../src/components/prototype/vgpu/workloads";
export type { WorkloadKind, WorkloadMetrics } from "../src/components/prototype/vgpu/workloads";

async function main() {
  const [sessionId, kind] = process.argv.slice(2) as [string, WorkloadKind];
  if (!["render", "compute", "signals"].includes(kind)) throw new Error("Unsupported fabric workload.");
  const endpoint = process.env.PHUX_FABRIC_ENDPOINT!;
  const token = process.env.PHUX_FABRIC_TOKEN!;
  const step = createWorkload(kind);
  const startedAt = Date.now();
  const state = { sessionId, kind, pid: process.pid, ticks: 0, paused: false, metrics: {} as WorkloadMetrics, lastCommand: "start", commandRevision: 0, startedAt, recentlines: [] as string[] };
  let pulse = 0;
  let publishing = false;
  let publishRequested = false;
  let lastPublished = 0;
  let linesRevision = 0;
  let publishedLinesRevision = -1;
  const line = (message: string) => {
    const text = `${new Date().toISOString().slice(11, 19)}  ${message}`;
    state.recentlines.push(text);
    state.recentlines = state.recentlines.slice(-12);
    linesRevision++;
    console.log(text);
  };
  const publish = async (force = false): Promise<void> => {
    if (publishing) { publishRequested ||= force; return; }
    const now = performance.now();
    if (!force && now - lastPublished < 500) return;
    publishing = true;
    const version = linesRevision;
    const { recentlines, ...values } = state;
    const body = version === publishedLinesRevision ? values : { ...values, recentlines };
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "x-fabric-token": token }, body: JSON.stringify(body), signal: AbortSignal.timeout(2000) });
      if (response.ok) { lastPublished = now; publishedLinesRevision = version; }
    }
    catch { /* Owner may be shutting down; native computation remains independent. */ }
    finally {
      publishing = false;
      if (publishRequested) { publishRequested = false; void publish(true); }
    }
  };
  const actions: Record<string, () => void> = {
    pulse: () => { pulse = 1; }, pause: () => { state.paused = true; }, resume: () => { state.paused = false; },
  };
  const input = createInterface({ input: process.stdin, terminal: false });
  input.on("line", text => {
    const command = text.trim();
    if (!Object.hasOwn(actions, command)) { line("Supported commands: pulse · pause · resume"); return; }
    actions[command]();
    state.lastCommand = command;
    state.commandRevision++;
    line(`${command} applied · revision ${state.commandRevision}`);
    void publish(true);
  });
  line(`PHUX ${kind} workload · pid ${process.pid}`);
  line(({ render: "Integrating 768 particle trajectories", compute: "Computing a 40 × 24 escape-time field", signals: "Analyzing 512-sample oscillator windows" })[kind]);
  line("This process keeps running when its view closes.");
  const tick = () => {
    state.ticks++;
    if (!state.paused) {
      state.metrics = step(pulse);
      pulse *= .88;
      if (state.ticks % 4 === 0) line(`working · tick ${state.ticks} · ${Object.entries(state.metrics).slice(0, 4).map(([key, value]) => `${key}=${value}`).join(" · ")}`);
    }
    void publish();
    setTimeout(tick, state.paused ? 1000 : 250);
  };
  setTimeout(tick, 250);
  void publish(true);
}
if (import.meta.main) await main();
