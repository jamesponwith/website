// One command starts Astro and a disposable PHUX server, never the user's server.
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { interpretIntent, loadTypeSafeKey, parseSceneCommand, type IntentDecision, type IntentSource, type SceneValues } from "./prototype-intent";
import { FabricError, NativeFabric } from "./prototype-fabric";
const root = resolve(import.meta.dir, "..");
const phux = Bun.which("phux");
if (!phux) throw new Error("Install phux first; this preview uses a real isolated PHUX session.");
const runtime = await mkdtemp(join(tmpdir(), "phux-vgpu-preview-"));
await mkdir(join(runtime, "config"));
const socket = join(runtime, "phux.sock");
const token = crypto.randomUUID();
const bridgePort = Number(process.env.PHUX_PREVIEW_BRIDGE_PORT || 4399);
const sitePort = Number(process.env.PHUX_PREVIEW_SITE_PORT || 4321);
const nativePort = Number(process.env.PHUX_PREVIEW_NATIVE_PORT || 8087);
const apiKey = await loadTypeSafeKey();
let jevAvailable = Boolean(apiKey);
// Only the bridge receives the API key, never the scene PTY or browser.
const inherited = Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith("PHUX_") && key !== "TYPESAFE_API_KEY"));
const env = { ...inherited, PHUX_SOCKET: socket, XDG_RUNTIME_DIR: runtime, XDG_CONFIG_HOME: join(runtime, "config"), XDG_STATE_HOME: join(runtime, "state"), XDG_DATA_HOME: join(runtime, "data"), PHUX_SCENE_ENDPOINT: `http://127.0.0.1:${bridgePort}/tick`, PHUX_SCENE_TOKEN: token, PHUX_FABRIC_ENDPOINT: `http://127.0.0.1:${bridgePort}/fabric/tick`, PHUX_FABRIC_TOKEN: token, SHELL: "/bin/sh", TERM: "xterm-256color" };
let fabric: NativeFabric;
let state: Record<string, unknown> = { connected: false };
let updatedAt = 0;
let commandQueue = Promise.resolve();
let lastIntent: IntentDecision | null = null;
type SceneEvent = { id: string; sequence: number; messageId: string; at: number; from: string; to: string; type: string; status: string; payload: Record<string, unknown> };
const events: SceneEvent[] = [];
let sceneEventCursor = 0;
const sceneStreamId = crypto.randomUUID();
const event = (messageId: string, from: string, to: string, type: string, status: string, payload: Record<string, unknown>) => {
  events.push({ id: crypto.randomUUID(), sequence: ++sceneEventCursor, messageId, at: Date.now(), from, to, type, status, payload });
  if (events.length > 96) events.splice(0, events.length - 96);
};
let appliedMessage: { id: string; payload: Record<string, unknown> } | null = null;
let publishedMessage = "";
let pending: { id: string; command: string; revision: number; resolve: () => void } | null = null;
const run = async (args: string[]) => {
  const child = Bun.spawn([phux, "--socket", socket, ...args], { env, cwd: root, stdout: "pipe", stderr: "pipe" });
  const [out, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code) throw new Error(error || out || `phux exited ${code}`);
  return out;
};
const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
  const action = commandQueue.then(task);
  commandQueue = action.then(() => {}, () => {});
  return action;
};
const dispatch = async (commands: string[], messageId: string) => {
  for (const command of commands) {
    if (!parseSceneCommand(command)) throw new Error("Invalid scene operation.");
    const revision = Number(state.commandRevision || 0);
    let acknowledge!: () => void;
    const acknowledged = new Promise<void>(resolve => { acknowledge = resolve; });
    pending = { id: messageId, command, revision, resolve: acknowledge };
    event(messageId, "phux", "scene", "scene.command", "sent", { command });
    try {
      await run(["paste", "vgpu", command]);
      await run(["send-keys", "vgpu", "Enter"]);
      const applied = await Promise.race([acknowledged.then(() => true), Bun.sleep(3000).then(() => false)]);
      if (!applied) throw new Error("Native scene did not acknowledge the command. Inspect the session before retrying.");
    } finally { pending = null; }
  }
};
const currentScene = (): SceneValues => ({ shape: String(state.shape || "torus"), color: String(state.color || "amber"), speed: Number(state.speed || 1), amplitude: Number(state.amplitude || 1), paused: Boolean(state.paused) });
const readBody = async (request: Request): Promise<Record<string, unknown> | null> => {
  if (Number(request.headers.get("content-length") || 0) > 4096) return null;
  const text = await request.text();
  if (text.length > 4096) return null;
  try { return JSON.parse(text); } catch { return null; }
};
function acknowledgeSceneCommand() {
  if (!pending) return;
  if (Number(state.commandRevision) <= pending.revision || state.lastCommand !== pending.command) return;
  event(pending.id, "scene", "phux", "scene.applied", "applied", { command: pending.command, revision: state.commandRevision, sceneTime: state.sceneTime });
  appliedMessage = { id: pending.id, payload: { shape: state.shape, color: state.color, speed: state.speed, sceneTime: state.sceneTime, revision: state.commandRevision } };
  pending.resolve();
  pending = null;
}
async function tickResponse(request: Request) {
  if (request.headers.get("x-scene-token") !== token) return new Response("Refused", { status: 403 });
  state = await request.json() as Record<string, unknown>;
  updatedAt = Date.now();
  acknowledgeSceneCommand();
  return new Response("ok");
}
function publishViewDelivery() {
  if (!appliedMessage) return;
  const revision = `${appliedMessage.id}:${appliedMessage.payload.revision}`;
  if (publishedMessage === revision) return;
  event(appliedMessage.id, "scene", "views", "scene.state", "delivered", appliedMessage.payload);
  publishedMessage = revision;
}
function stateResponse(request: Request) {
  // This edge is observed only when a view actually requests the new state.
  publishViewDelivery();
  const query = new URL(request.url).searchParams;
  const compact = query.get("compact") === "1";
  const after = query.has("stream") && query.get("stream") !== sceneStreamId ? 0 : Number(query.get("after")) || 0;
  const receipt = compact && query.get("intent") === lastIntent?.id ? {} : { lastIntent };
  return Response.json({ ...state, connected: Date.now()-updatedAt < 2000, runtime: "native phux · isolated PTY", ...receipt, jevAvailable, events: compact ? events.filter(event => event.sequence > after) : events, eventCursor: sceneEventCursor, streamId: sceneStreamId, serverTime: Date.now() }, { headers: { "cache-control": "no-store" } });
}
async function screenResponse() {
  try { return new Response(await run(["snapshot", "vgpu", "--json"]), { headers: { "content-type": "application/json", "cache-control": "no-store" } }); }
  catch { return Response.json({ error: "Native screen unavailable" }, { status: 503 }); }
}
async function commandResponse(request: Request) {
  const body = await readBody(request);
  const command = typeof body?.command === "string" ? body.command.trim().replace(/^scene\s+/, "") : "";
  if (!command || command.length > 64 || !parseSceneCommand(command)) return Response.json({ error: "Use a scene command shown in the console." }, { status: 400 });
  const id = crypto.randomUUID();
  event(id, "terminal", "phux", "scene.command", "received", { command });
  try { await enqueue(() => dispatch([command], id)); return Response.json({ ok: true, id }); }
  catch (error) { event(id, "phux", "terminal", "scene.error", "error", { error: String(error) }); return Response.json({ error: String(error) }, { status: 503 }); }
}
async function resolveIntent(text: string, source: IntentSource, id: string) {
  const decision = await interpretIntent(text, currentScene(), source, apiKey, id);
  jevAvailable = true;
  event(id, "jev", "phux", "intent.decision", decision.commands.length ? "resolved" : "no_match", { ...decision });
  await dispatch(decision.commands, id);
  // A receipt represents observed native delivery, never just interpretation.
  // If dispatch fails, preserve the last successfully applied receipt.
  lastIntent = decision;
  return decision;
}
function intentErrorResponse(error: unknown, id: string, source: IntentSource) {
  if (!apiKey || String(error).includes("HTTP 401")) jevAvailable = false;
  const message = error instanceof Error ? error.message : "Jev request failed.";
  event(id, "jev", source, "intent.error", "error", { error: message });
  return Response.json({ error: message, id, source, status: "error" }, { status: 503 });
}
async function intentResponse(request: Request) {
  const body = await readBody(request);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const source = body?.source as IntentSource;
  if (!text || text.length > 600 || !["browser", "phone", "terminal"].includes(source)) return Response.json({ error: "Send 1–600 characters and a browser, phone or terminal source." }, { status: 400 });
  const id = crypto.randomUUID();
  event(id, source, "jev", "intent.request", "received", { text });
  try {
    const decision = await enqueue(() => resolveIntent(text, source, id));
    return Response.json(decision, { headers: { "cache-control": "no-store" } });
  } catch (error) { return intentErrorResponse(error, id, source); }
}
function fabricRoute(action: (request: Request) => unknown | Promise<unknown>) {
  return async (request: Request) => {
    try { return Response.json(await action(request), { headers: { "cache-control": "no-store" } }); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Native fabric unavailable." }, { status: error instanceof FabricError ? error.status : 503 }); }
  };
}
async function fabricBody(request: Request) {
  const body = await readBody(request);
  if (!body || Array.isArray(body) || typeof body !== "object") throw new FabricError("Send a JSON object.");
  return body;
}
async function fabricScreenResponse(request: Request) {
  try {
    const sessionId = new URL(request.url).searchParams.get("sessionId") || "scene";
    return new Response(await fabric.screen(sessionId), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Native screen unavailable." }, { status: error instanceof FabricError ? error.status : 503 }); }
}
function fabricStateResponse(request: Request) {
  const query = new URL(request.url).searchParams;
  const compact = query.get("compact") === "1";
  const knownRevision = query.get("revision");
  const after = knownRevision && !knownRevision.startsWith(`${fabric.streamId}:`) ? 0 : Math.max(0, Number(query.get("after")) || 0);
  const snapshot = fabric.snapshot({ compact, after });
  const headers = { "cache-control": "no-store", "x-fabric-revision": snapshot.revision };
  if (compact && after >= snapshot.eventCursor && query.get("revision") === snapshot.revision) return new Response(null, { status: 204, headers });
  return Response.json(snapshot, { headers });
}
const routes: Record<string, (request: Request) => Response | Promise<Response>> = {
  "POST /tick": tickResponse,
  "GET /state": stateResponse,
  "GET /screen": screenResponse,
  "POST /command": commandResponse,
  "POST /intent": intentResponse,
  "GET /fabric": fabricStateResponse,
  "GET /fabric/session": fabricRoute(request => fabric.detail(new URL(request.url).searchParams.get("sessionId") || "scene")),
  "POST /fabric/session": fabricRoute(async request => fabric.createSession(await fabricBody(request))),
  "POST /fabric/host": fabricRoute(async request => fabric.createHost(await fabricBody(request))),
  "DELETE /fabric/session": fabricRoute(async request => fabric.deleteSession(await fabricBody(request) as { sessionId: string })),
  "DELETE /fabric/host": fabricRoute(async request => fabric.deleteHost(await fabricBody(request) as { hostId: string })),
  "POST /fabric/command": fabricRoute(async request => {
    const body = await fabricBody(request);
    return fabric.command(body as { sessionId: string; action: "pulse" | "pause" | "resume" });
  }),
  "POST /fabric/tick": fabricRoute(async request => fabric.acceptTick(await fabricBody(request), request.headers.get("x-fabric-token"))),
  "GET /fabric/screen": fabricScreenResponse,
};
const bridge = Bun.serve({
  hostname: "127.0.0.1", port: bridgePort, idleTimeout: 60,
  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    if (origin && ![`http://localhost:${sitePort}`, `http://127.0.0.1:${sitePort}`].includes(origin)) return new Response("Origin refused", { status: 403 });
    const handler = routes[`${request.method} ${url.pathname}`];
    return handler ? handler(request) : new Response("Not found", { status: 404 });
  },
});
const native = Bun.spawn([phux, "--socket", socket, "server", "--session", "preview", "--listen", `127.0.0.1:${nativePort}`, "--quic", "127.0.0.1:0"], { env, cwd: root, stdout: "ignore", stderr: "inherit" });
fabric = new NativeFabric({
  phux, root, runtime, socket, rootPid: native.pid, env, token,
  rootState: () => ({ ...state, connected: Date.now() - updatedAt < 2000 }),
  rootCommand: (action, id) => enqueue(() => dispatch([action === "pulse" ? "burst" : action], id)),
});
let astro: ReturnType<typeof Bun.spawn> | undefined;
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  astro?.kill("SIGTERM");
  await fabric.close();
  native.kill("SIGTERM");
  bridge.stop(true);
  await native.exited;
  await rm(runtime, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
try {
  for (let i=0; i<50; i++) {
    try { await run(["status", "--json"]); break; } catch { if (i===49) throw new Error("Isolated PHUX server did not start."); await Bun.sleep(100); }
  }
  await run(["new", "--json", "-s", "vgpu", "--", process.execPath, join(root,"scripts/prototype-scene-runner.ts")]);
  await run(["kill", "preview", "--yes"]);
  console.log(`\nPHUX light lab → http://localhost:${sitePort}/prototype/vgpu\nReal scene process → isolated native PHUX session\nJev credentials → ${apiKey ? "available" : "missing"}\n`);
  if (process.env.PHUX_PREVIEW_NO_ASTRO === "1") await new Promise(() => {});
  else {
    astro = Bun.spawn([process.execPath, join(root,"node_modules/astro/bin/astro.mjs"), "dev", "--ignore-lock", "--host", "127.0.0.1", "--port", String(sitePort)], { cwd: root, env: process.env, stdout: "inherit", stderr: "inherit" });
    await astro.exited;
  }
} catch (error) { console.error(error); }
await close();
