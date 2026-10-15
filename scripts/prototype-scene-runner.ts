// Local preview instrument. This process lives in an isolated, real PHUX PTY.
import { createInterface } from "node:readline";
import { parseSceneCommand } from "./prototype-intent";
const endpoint = process.env.PHUX_SCENE_ENDPOINT!;
const token = process.env.PHUX_SCENE_TOKEN!;
const startedAt = Date.now();
let scene = { speed: 1, amplitude: 1, shape: "torus", color: "amber", paused: false, burst: 0, ticks: 0, startedAt, lastCommand: "scene start", commandRevision: 0, sceneTime: 0, phaseAt: startedAt, pid: process.pid };
let phaseAt = performance.now();
const advanceClock = () => {
  const now = performance.now();
  if (!scene.paused) scene.sceneTime += (now - phaseAt) / 1000 * scene.speed;
  phaseAt = now;
  scene.phaseAt = Date.now();
};
const publish = async () => {
  try { await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "x-scene-token": token }, body: JSON.stringify(scene) }); } catch { /* The owner may be shutting down. */ }
};
const show = () => process.stdout.write("\x1b[38;5;141m❯\x1b[0m ");
console.log("\x1b[1;38;5;141mphux / light instrument\x1b[0m\r\n");
console.log("A real process. A shared scene. Any attached view.\r\n");
console.log("liquid glass · gravitational horizon · deep lens");
console.log("radiance · folded light · glass architecture\r\n");
console.log("color violet|cyan|amber|rose|ice");
console.log("speed 0.1–3   amplitude 0.2–2   burst   pause   resume   reset\r\n");
console.log('Ask Jev: "Liquid glass, icy and slow."\r\n');
show();
const input = createInterface({ input: process.stdin, terminal: false });
// The command runner's original 13-branch dispatcher is a table of small,
// bounded operations. Each operation has one validation responsibility.
const commands: Record<string,(value:string)=>boolean> = {
  color: value => { scene.color=value;return true; },
  shape: value => { scene.shape=value;return true; },
  speed: value => { const number=Number(value);if(number<.1||number>3||!Number.isFinite(number))return false;scene.speed=number;return true; },
  amplitude: value => { const number=Number(value);if(number<.2||number>2||!Number.isFinite(number))return false;scene.amplitude=number;return true; },
  pause: () => { scene.paused=true;return true; },
  resume: () => { scene.paused=false;return true; },
  burst: () => { scene.burst=Date.now();return true; },
  reset: () => { scene={...scene,speed:1,amplitude:1,color:"amber",shape:"torus",paused:false};return true; },
};
input.on("line", line => {
  const command = line.trim().replace(/^scene\s+/, "");
  if (!command) { show(); return; }
  const parsed = parseSceneCommand(command);
  if (!parsed) {
    // Natural language takes the same server-side Jev → PHUX route as a view.
    console.log("Jev is interpreting the scene request…");
    void fetch(new URL("/intent", endpoint), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: command.slice(0, 600), source: "terminal" }) })
      .then(async response => {
        const result = await response.json() as { error?: string; commands?: string[]; model?: string };
        console.log(response.ok ? `${result.model}: ${result.commands?.join(" · ") || "No matching scene operation."}` : result.error || "Jev unavailable.");
        show();
      }).catch(() => { console.log("Scene bridge unavailable."); show(); });
    return;
  }
  advanceClock();
  const { key, value } = parsed;
  if (!commands[key]?.(value)) { console.log("Invalid scene command."); show(); return; }
  scene.lastCommand = command;
  scene.commandRevision += 1;
  console.log(`\x1b[38;5;120m✓\x1b[0m ${command}  ·  tick ${scene.ticks}  ·  pid ${process.pid}`);
  show();
  void publish();
});
setInterval(() => { advanceClock(); scene.ticks += 1; void publish(); }, 100);
void publish();
