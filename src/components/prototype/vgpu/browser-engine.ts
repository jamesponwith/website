import { createWorkload, type WorkloadKind, type WorkloadMetrics } from "./workloads";

export const BROWSER_LIMITS = { hosts: 3, sessions: 7 } as const;
const forms = ["torus", "wave", "sphere", "galaxy", "helix", "lattice"];
const colors = ["amber", "cyan", "violet", "rose", "ice"];
type Action = "pulse" | "pause" | "resume";
type Values = Record<string, unknown>;
export type EngineReply = { status: number; body?: unknown; scene?: SharedScene };
export type SharedScene = { shape: string; color: string; speed: number; amplitude: number; paused: boolean; burst: number; startedAt: number; sceneTime: number; phaseAt: number };
type Host = { id: string; name: string; parentHostId: string | null; engine: "browser"; local: false; logical: true; status: "active"; startedAt: number };
type Session = { id: string; hostId: string; parentSessionId: string | null; name: string; kind: WorkloadKind; engine: "browser"; workerId: string; ticks: number; paused: boolean; metrics: WorkloadMetrics; lastCommand: string; commandRevision: number; connected: boolean; recentlines: string[]; startedAt: number; updatedAt: number };
type Task = { session: Session; step: ReturnType<typeof createWorkload>; pulse: number };
type Event = { id: string; sequence: number; messageId: string; at: number; from: string; to: string; type: string; status: string; payload: unknown };
class RequestError extends Error { constructor(message: string, public status = 400) { super(message); } }
const isKind = (value: unknown): value is WorkloadKind => ["render", "compute", "signals"].includes(String(value));
const isAction = (value: unknown): value is Action => ["pulse", "pause", "resume"].includes(String(value));
const number = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const id = () => crypto.randomUUID();

/** Pure state machine; its production owner is the real dedicated Web Worker. */
export class BrowserEngine {
  readonly streamId = id();
  private scene: SharedScene;
  private sceneTicks = 0;
  private sceneRevision = 0;
  private lastCommand = "scene start";
  private revision = 0;
  private events: Event[] = [];
  private cursor = 0;
  private visible = true;
  private closed = false;
  private hosts = new Map<string, Host>();
  private tasks = new Map<string, Task>();
  private ordinal = 0;
  private startedAt: number;
  constructor(now = Date.now()) {
    this.startedAt = now;
    this.scene = { shape: "torus", color: "amber", speed: 1, amplitude: 1, paused: false, burst: 0, startedAt: now, sceneTime: 0, phaseAt: now };
    this.hosts.set("studio", this.newHost("studio", "Browser studio", null, now));
  }
  private newHost(id: string, name: string, parentHostId: string | null, now: number): Host {
    return { id, name, parentHostId, engine: "browser", local: false, logical: true, status: "active", startedAt: now };
  }
  private log(from: string, to: string, type: string, status: string, payload: unknown, now: number, messageId = id()) {
    this.events.push({ id: id(), sequence: ++this.cursor, messageId, at: now, from, to, type, status, payload });
    this.events = this.events.slice(-96);
    this.revision++;
  }
  private advance(now: number) {
    if (this.visible && !this.scene.paused) this.scene.sceneTime += Math.max(0, now - this.scene.phaseAt) / 1000 * this.scene.speed;
    this.scene.phaseAt = now;
  }
  setVisible(visible: boolean, now = Date.now()) { this.advance(now); this.visible = visible; }
  tick(now = Date.now()) {
    if (!this.visible || this.closed) return;
    this.advance(now);
    this.sceneTicks++;
    for (const task of this.tasks.values()) this.stepTask(task, now);
    this.revision++;
  }
  private stepTask(task: Task, now: number) {
    const session = task.session;
    session.ticks++;
    session.updatedAt = now;
    if (session.paused) return;
    session.metrics = task.step(task.pulse);
    task.pulse *= .8;
    if (session.ticks % 4 === 0) this.line(session, `computed tick ${session.ticks} · ${Object.entries(session.metrics).slice(0, 3).map(([key, value]) => `${key}=${value}`).join(" · ")}`);
  }
  private line(session: Session, text: string) { session.recentlines = [...session.recentlines, text].slice(-12); }
  private state(now: number, query: URLSearchParams) {
    this.advance(now);
    const after = query.get("stream") === this.streamId ? Number(query.get("after")) || 0 : 0;
    const events = query.get("compact") === "1" ? this.events.filter(event => event.sequence > after) : this.events;
    return { ...this.scene, startedAt: this.startedAt, compositionStartedAt: this.scene.startedAt, engine: "browser", workerId: "scene", connected: true, ticks: this.sceneTicks, commandRevision: this.sceneRevision, lastCommand: this.lastCommand, jevAvailable: false, lastIntent: null, runtime: "browser Web Worker · page lifetime", events, eventCursor: this.cursor, streamId: this.streamId, serverTime: now };
  }
  private primary(now: number): Session {
    return { id: "scene", hostId: "studio", parentSessionId: null, name: "Optical world", kind: "render", engine: "browser", workerId: "scene", ticks: this.sceneTicks, paused: this.scene.paused, metrics: { sceneTime: this.scene.sceneTime, speed: this.scene.speed, amplitude: this.scene.amplitude, world: this.scene.shape }, lastCommand: this.lastCommand, commandRevision: this.sceneRevision, connected: true, recentlines: ["Browser Web Worker · scene state", `Applied: ${this.lastCommand}`, `Scene phase: ${this.scene.sceneTime.toFixed(2)} seconds`], startedAt: this.startedAt, updatedAt: now };
  }
  private session(sessionId: string, now: number): Session {
    if (sessionId === "scene") return this.primary(now);
    const task = this.tasks.get(sessionId);
    if (!task) throw new RequestError("That browser workload no longer exists.");
    return task.session;
  }
  private host(hostId: string) {
    const host = this.hosts.get(hostId);
    if (!host) throw new RequestError("That logical group no longer exists.");
    return host;
  }
  private fabric(now: number, query: URLSearchParams): EngineReply {
    const revision = `${this.streamId}:${this.revision}:${this.sceneRevision}`;
    const known = query.get("revision") || "";
    const after = known.startsWith(`${this.streamId}:`) ? Number(query.get("after")) || 0 : 0;
    const compact = query.get("compact") === "1";
    if (compact && known === revision && after >= this.cursor) return { status: 204 };
    const rows = [this.primary(now), ...[...this.tasks.values()].map(task => task.session)];
    const sessions = compact ? rows.map(({ recentlines: _lines, ...session }) => session) : rows;
    return { status: 200, body: { hosts: [...this.hosts.values()], sessions, events: compact ? this.events.filter(event => event.sequence > after) : this.events, revision, eventCursor: this.cursor, streamId: this.streamId, serverTime: now, limits: BROWSER_LIMITS, engine: "browser", local: false } };
  }
  private createSession(body: Values, now: number) {
    if (this.tasks.size + 1 >= BROWSER_LIMITS.sessions) throw new RequestError("This browser concept supports seven workloads, including the scene.", 409);
    const parentId = typeof body.parentSessionId === "string" ? body.parentSessionId : null;
    const parent = parentId ? this.session(parentId, now) : null;
    const hostId = String(body.hostId || parent?.hostId || "studio");
    this.host(hostId);
    const kind = body.kind ?? "render";
    if (!isKind(kind)) throw new RequestError("Choose render, compute or signals.");
    const sessionId = `task-${id().slice(0, 8)}`;
    const ordinal = ++this.ordinal;
    const session: Session = { id: sessionId, hostId, parentSessionId: parentId, name: `${kind} ${ordinal}`, kind, engine: "browser", workerId: `task ${ordinal}`, ticks: 0, paused: false, metrics: {}, lastCommand: "start", commandRevision: 0, connected: true, recentlines: [`Browser worker task · ${kind}`, "Runs while this page is open; pauses when the page is hidden."], startedAt: now, updatedAt: now };
    const task = { session, step: createWorkload(kind), pulse: 0 };
    this.tasks.set(sessionId, task);
    this.stepTask(task, now);
    this.log("browser", sessionId, "fabric.session", "active", { kind, hostId, parentSessionId: parentId, engine: "browser" }, now);
    return { session };
  }
  private createHost(body: Values, now: number) {
    if (this.hosts.size >= BROWSER_LIMITS.hosts) throw new RequestError("This browser concept supports three logical groups.", 409);
    const parent = String(body.parentHostId || "studio");
    this.host(parent);
    const hostId = `group-${id().slice(0, 8)}`;
    const host = this.newHost(hostId, `Logical group ${++this.ordinal}`, parent, now);
    this.hosts.set(hostId, host);
    try {
      const { session } = this.createSession({ hostId, kind: "render" }, now);
      this.log(parent, hostId, "fabric.group", "active", { logical: true }, now);
      return { host, session };
    } catch (error) { this.hosts.delete(hostId); throw error; }
  }
  private sceneCommand(text: unknown, now: number) {
    if (typeof text !== "string" || text.length > 64) throw new RequestError("Use a scene control or a supported command.");
    const command = text.trim().replace(/^scene\s+/, "");
    const [key, value, extra] = command.split(/\s+/);
    if (extra) throw new RequestError("Send one bounded scene command.");
    this.advance(now);
    const operations: Record<string, () => void> = {
      shape: () => { if (!forms.includes(value)) throw new RequestError("Unknown optical world."); this.scene.shape = value; },
      color: () => { if (!colors.includes(value)) throw new RequestError("Unknown palette."); this.scene.color = value; },
      speed: () => { this.scene.speed = this.commandNumber(value, .1, 3); },
      amplitude: () => { this.scene.amplitude = this.commandNumber(value, .2, 2); },
      pause: () => { this.scene.paused = true; }, resume: () => { this.scene.paused = false; },
      burst: () => { this.scene.burst = now; },
      reset: () => { this.scene = { ...this.scene, shape: "torus", color: "amber", speed: 1, amplitude: 1, paused: false }; },
    };
    if (!Object.hasOwn(operations, key)) throw new RequestError("Natural-language control is unavailable here. Use the scene controls.");
    if (["pause", "resume", "burst", "reset"].includes(key) && value) throw new RequestError("This command takes no arguments.");
    operations[key]();
    this.lastCommand = command;
    this.sceneRevision++;
    this.log("browser", "scene", "scene.command", "applied", { command, engine: "browser" }, now);
    return { ok: true, id: id() };
  }
  private commandNumber(value: string, min: number, max: number) {
    if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) || !number(Number(value), min, max)) throw new RequestError("Value is outside this scene control's range.");
    return Number(value);
  }
  private fabricCommand(body: Values, now: number) {
    const sessionId = String(body.sessionId);
    const action = body.action;
    if (!isAction(action)) throw new RequestError("Choose pulse, pause or resume.");
    if (sessionId === "scene") {
      this.sceneCommand(action === "pulse" ? "burst" : action, now);
      return { ok: true, session: this.primary(now), messageId: id() };
    }
    const session = this.session(sessionId, now);
    const task = this.tasks.get(sessionId)!;
    if (action === "pulse") task.pulse = 1;
    else session.paused = action === "pause";
    session.lastCommand = action;
    session.commandRevision++;
    this.line(session, `${action} applied · revision ${session.commandRevision}`);
    this.log("browser", sessionId, "fabric.command", "applied", { action, revision: session.commandRevision }, now);
    return { ok: true, session, messageId: id() };
  }
  private descendants(initial: string[], relations: Array<{ id: string; parent: string | null }>) {
    const ids = new Set(initial);
    for (let i = 0; i < relations.length; i++) for (const row of relations) if (row.parent && ids.has(row.parent)) ids.add(row.id);
    return [...ids];
  }
  private teardown(body: Values, host: boolean, now: number) {
    const selected = String(host ? body.hostId : body.sessionId);
    if (["studio", "scene"].includes(selected)) throw new RequestError("The primary browser studio and scene are protected.", 403);
    const hosts = host ? this.descendants([this.host(selected).id], [...this.hosts.values()].map(row => ({ id: row.id, parent: row.parentHostId }))) : [];
    const initial = host ? [...this.tasks.values()].filter(task => hosts.includes(task.session.hostId)).map(task => task.session.id) : [this.session(selected, now).id];
    const sessions = this.descendants(initial, [...this.tasks.values()].map(task => ({ id: task.session.id, parent: task.session.parentSessionId })));
    for (const sessionId of sessions) this.tasks.delete(sessionId);
    for (const hostId of hosts) this.hosts.delete(hostId);
    const messageId = id();
    this.log("browser", "views", "fabric.teardown", "removed", { sessionIds: sessions, hostIds: hosts }, now, messageId);
    return { ok: true, removedSessionIds: sessions, removedHostIds: hosts, messageId };
  }
  sharedScene(): SharedScene { return { ...this.scene }; }
  restoreScene(value: unknown, now = Date.now()) {
    if (!value || typeof value !== "object") return false;
    const saved = value as SharedScene;
    if (!forms.includes(saved.shape) || !colors.includes(saved.color)) return false;
    if (!number(saved.speed, .1, 3) || !number(saved.amplitude, .2, 2) || typeof saved.paused !== "boolean") return false;
    if (![saved.burst, saved.startedAt, saved.sceneTime, saved.phaseAt].every(n => number(n, 0, Number.MAX_SAFE_INTEGER))) return false;
    this.scene = { shape: saved.shape, color: saved.color, speed: saved.speed, amplitude: saved.amplitude, paused: saved.paused, burst: saved.burst, startedAt: saved.startedAt, sceneTime: saved.sceneTime, phaseAt: saved.phaseAt };
    this.advance(now);
    this.sceneRevision++;
    return true;
  }
  close() { this.closed = true; this.tasks.clear(); }
  request(path: string, method = "GET", body: Values = {}, now = Date.now()): EngineReply {
    if (this.closed) return { status: 410, body: { error: "This browser runtime has closed." } };
    const url = new URL(path, "https://browser.invalid");
    const route = `${method} ${url.pathname.replace(/^\/__scene/, "")}`;
    const getId = () => url.searchParams.get("sessionId") || "scene";
    const routes: Record<string, () => EngineReply> = {
      "GET /state": () => ({ status: 200, body: this.state(now, url.searchParams) }),
      "GET /fabric": () => this.fabric(now, url.searchParams),
      "GET /fabric/session": () => ({ status: 200, body: { session: this.session(getId(), now) } }),
      "GET /fabric/screen": () => ({ status: 200, body: { lines: this.session(getId(), now).recentlines } }),
      "GET /screen": () => ({ status: 200, body: { lines: this.primary(now).recentlines } }),
      "POST /intent": () => ({ status: 503, body: { error: "Jev requires the local native preview. This public concept supports the scene controls.", status: "unavailable" } }),
      "POST /command": () => ({ status: 200, body: this.sceneCommand(body.command, now), scene: this.sharedScene() }),
      "POST /fabric/session": () => ({ status: 200, body: this.createSession(body, now) }),
      "POST /fabric/host": () => ({ status: 200, body: this.createHost(body, now) }),
      "POST /fabric/command": () => ({ status: 200, body: this.fabricCommand(body, now), ...(body.sessionId === "scene" ? { scene: this.sharedScene() } : {}) }),
      "DELETE /fabric/session": () => ({ status: 200, body: this.teardown(body, false, now) }),
      "DELETE /fabric/host": () => ({ status: 200, body: this.teardown(body, true, now) }),
    };
    try { return routes[route]?.() ?? { status: 404, body: { error: "Unknown browser concept operation." } }; }
    catch (error) { return { status: error instanceof RequestError ? error.status : 500, body: { error: error instanceof Error ? error.message : "Browser workload failed." } }; }
  }
}
