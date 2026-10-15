import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { WorkloadKind, WorkloadMetrics } from "./prototype-fabric-worker";

export const FABRIC_LIMITS = { hosts: 4, sessions: 12 } as const;
export class FabricError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export interface FabricHost { id: string; name: string; pid: number; parentHostId: string | null; local: true; status: "active" | "stopped"; startedAt: number }
export interface FabricSession {
  id: string; hostId: string; parentSessionId: string | null; name: string; kind: WorkloadKind;
  pid: number; ticks: number; paused: boolean; metrics: WorkloadMetrics; lastCommand: string;
  commandRevision: number; connected: boolean; recentlines: string[]; startedAt: number; updatedAt: number;
}
interface FabricEvent { id: string; sequence: number; messageId: string; at: number; from: string; to: string; type: string; status: string; payload: Record<string, unknown> }
interface HostRuntime { host: FabricHost; socket: string; directory: string; env: Record<string, string | undefined>; process?: ReturnType<typeof Bun.spawn> }
interface SessionRuntime { session: FabricSession; nativeName: string }
interface Options {
  phux: string; root: string; runtime: string; socket: string; rootPid: number;
  env: Record<string, string | undefined>; token: string;
  rootState: () => Record<string, unknown>;
  rootCommand: (action: "pulse" | "pause" | "resume", messageId: string) => Promise<void>;
}
type Action = "pulse" | "pause" | "resume";
export function validKind(value: unknown): value is WorkloadKind { return ["render", "compute", "signals"].includes(String(value)); }
export function validFabricAction(value: unknown): value is Action { return ["pulse", "pause", "resume"].includes(String(value)); }
function numberField(state: Record<string, unknown>, key: string, fallback = 0) {
  const value = state[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function textField(state: Record<string, unknown>, key: string, fallback: string) {
  return typeof state[key] === "string" ? state[key] as string : fallback;
}
function processAlive(pid: number) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export class NativeFabric {
  readonly streamId = crypto.randomUUID();
  private hosts = new Map<string, HostRuntime>();
  private sessions = new Map<string, SessionRuntime>();
  private events: FabricEvent[] = [];
  private creationQueue: Promise<unknown> = Promise.resolve();
  private commandQueues = new Map<string, Promise<unknown>>();
  private stopping = false;
  private revision = 0;
  private eventCursor = 0;
  private deletingSessions = new Set<string>();
  private nextHostOrdinal = 2;
  private nextSessionOrdinal = 1;
  private createdAt = Date.now();
  constructor(private options: Options) {
    this.hosts.set("studio", { host: { id: "studio", name: "Studio", pid: options.rootPid, parentHostId: null, local: true, status: "active", startedAt: this.createdAt }, socket: options.socket, directory: options.runtime, env: options.env });
  }
  private event(messageId: string, from: string, to: string, type: string, status: string, payload: Record<string, unknown>) {
    this.events.push({ id: crypto.randomUUID(), sequence: ++this.eventCursor, messageId, at: Date.now(), from, to, type, status, payload });
    this.events = this.events.slice(-96);
    this.revision++;
  }
  private rootSession(): FabricSession {
    const state = this.options.rootState();
    return {
      id: "scene", hostId: "studio", parentSessionId: null, name: "Optical world", kind: "render", pid: numberField(state, "pid"), ticks: numberField(state, "ticks"),
      paused: Boolean(state.paused), metrics: { sceneTime: numberField(state, "sceneTime"), speed: numberField(state, "speed", 1), amplitude: numberField(state, "amplitude", 1), world: textField(state, "shape", "torus") },
      lastCommand: textField(state, "lastCommand", "scene start"), commandRevision: numberField(state, "commandRevision"), connected: Boolean(state.connected), recentlines: [],
      startedAt: numberField(state, "startedAt", this.createdAt), updatedAt: numberField(state, "phaseAt", this.createdAt),
    };
  }
  snapshot(options: { compact?: boolean; after?: number } = {}) {
    const now = Date.now();
    const sessions = [...this.sessions.values()].map(({ session }) => ({ ...session, connected: now - session.updatedAt < 2000 }));
    const hosts = [...this.hosts.values()].map(({ host, process }) => ({ ...host, status: process?.exitCode != null ? "stopped" as const : host.status }));
    const root = this.rootSession();
    const rows = [root, ...sessions];
    const values = options.compact ? rows.map(({ recentlines: _lines, ...session }) => session) : rows;
    const events = options.compact ? this.events.filter(event => event.sequence > (options.after ?? 0)) : this.events;
    const revision = `${this.streamId}:${this.revision}:${root.commandRevision}:${Number(root.connected)}:${sessions.filter(session => session.connected).length}:${hosts.filter(host => host.status === "active").length}`;
    return { hosts, sessions: values, events, revision, streamId: this.streamId, eventCursor: this.eventCursor, limits: FABRIC_LIMITS, local: true as const, serverTime: now };
  }
  detail(sessionId: string) {
    if (sessionId === "scene") return { session: this.rootSession() };
    const session = this.session(sessionId).session;
    return { session: { ...session, connected: Date.now() - session.updatedAt < 2000 } };
  }
  private serialize<T>(task: () => Promise<T>) {
    const next = this.creationQueue.then(() => {
      if (this.stopping) throw new FabricError("Preview is shutting down.", 503);
      return task();
    });
    this.creationQueue = next.catch(() => {});
    return next;
  }
  private host(id: string) {
    const host = this.hosts.get(id);
    if (!host) throw new FabricError("Unknown host.");
    return host;
  }
  private session(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw new FabricError("Unknown session.");
    return session;
  }
  private ensureSessionCapacity() {
    if (this.sessions.size + 1 >= FABRIC_LIMITS.sessions) throw new FabricError("This local preview is limited to 12 sessions.", 409);
  }
  private async run(host: HostRuntime, args: string[]) {
    const child = Bun.spawn([this.options.phux, "--socket", host.socket, ...args], { env: host.env, cwd: this.options.root, stdout: "pipe", stderr: "pipe" });
    const [out, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code) throw new FabricError(error || out || "Native PHUX command failed.", 503);
    return out;
  }
  private async waitFor(check: () => boolean, message: string, timeout = 5000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (check()) return;
      await Bun.sleep(40);
    }
    throw new FabricError(message, 503);
  }
  private async ready(host: HostRuntime) {
    for (let i = 0; i < 50; i++) {
      try { await this.run(host, ["status", "--json"]); return; }
      catch { await Bun.sleep(80); }
    }
    throw new FabricError("Native host did not start.", 503);
  }
  createSession(body: { hostId?: string; kind?: WorkloadKind; parentSessionId?: string }) {
    return this.serialize(async () => {
      const parent = body.parentSessionId;
      const parentRuntime = this.parentSession(parent);
      const hostId = body.hostId ?? parentRuntime?.session.hostId ?? "studio";
      const host = this.host(hostId);
      const kind = body.kind ?? "render";
      if (!validKind(kind)) throw new FabricError("Choose render, compute or signals.");
      return { session: await this.spawnSession(host, kind, parent || null) };
    });
  }
  private parentSession(id: string | undefined) {
    if (!id || id === "scene") return null;
    return this.session(id);
  }
  private async spawnSession(host: HostRuntime, kind: WorkloadKind, parentSessionId: string | null) {
    this.ensureSessionCapacity();
    const id = `session-${crypto.randomUUID().slice(0, 8)}`;
    const nativeName = `fabric-${id.slice(8)}`;
    const startedAt = Date.now();
    const session: FabricSession = { id, hostId: host.host.id, parentSessionId, name: `${kind} ${this.nextSessionOrdinal++}`, kind, pid: 0, ticks: 0, paused: false, metrics: {}, lastCommand: "start", commandRevision: 0, connected: false, recentlines: [], startedAt, updatedAt: 0 };
    this.sessions.set(id, { session, nativeName });
    this.revision++;
    const messageId = crypto.randomUUID();
    this.event(messageId, "browser", host.host.id, "fabric.session", "requested", { sessionId: id, kind, parentSessionId });
    try {
      await this.run(host, ["new", "--json", "-s", nativeName, "--", process.execPath, join(this.options.root, "scripts/prototype-fabric-worker.ts"), id, kind]);
      await this.waitFor(() => session.pid > 0, "Native worker did not publish its initial state.");
      this.event(messageId, host.host.id, id, "fabric.session", "active", { sessionId: id, kind, pid: session.pid });
      return { ...session, connected: true };
    } catch (error) {
      await this.run(host, ["kill", nativeName, "--yes"]).catch(() => {});
      this.sessions.delete(id);
      this.event(messageId, host.host.id, "browser", "fabric.session", "error", { error: String(error) });
      throw error;
    }
  }
  createHost(body: { parentHostId?: string }) {
    return this.serialize(async () => {
      const parentHostId = body.parentHostId || "studio";
      this.host(parentHostId);
      if (this.hosts.size >= FABRIC_LIMITS.hosts) throw new FabricError("This local preview is limited to 4 hosts.", 409);
      this.ensureSessionCapacity();
      const id = `host-${crypto.randomUUID().slice(0, 8)}`;
      const host = await this.startHost(id, parentHostId);
      try {
        const session = await this.spawnSession(host, "render", null);
        await this.run(host, ["kill", "fabric-bootstrap", "--yes"]);
        return { host: host.host, session };
      } catch (error) { await this.stopHost(host); this.hosts.delete(id); throw error; }
    });
  }
  private async startHost(id: string, parentHostId: string) {
    const directory = join(this.options.runtime, id);
    await mkdir(join(directory, "config"), { recursive: true });
    // macOS Unix socket paths must fit sockaddr_un's short path buffer.
    const socket = join(directory, "s");
    const env = { ...this.options.env, PHUX_SOCKET: socket, XDG_RUNTIME_DIR: directory, XDG_CONFIG_HOME: join(directory, "config"), XDG_STATE_HOME: join(directory, "state"), XDG_DATA_HOME: join(directory, "data") };
    const process = Bun.spawn([this.options.phux, "--socket", socket, "server", "--session", "fabric-bootstrap", "--listen", "127.0.0.1:0", "--quic", "127.0.0.1:0"], { env, cwd: this.options.root, stdout: "ignore", stderr: "ignore" });
    const host: HostRuntime = { host: { id, name: `Local host ${this.nextHostOrdinal++}`, pid: process.pid, parentHostId, local: true, status: "active", startedAt: Date.now() }, socket, directory, env, process };
    this.hosts.set(id, host);
    try { await this.ready(host); }
    catch (error) { await this.stopHost(host); this.hosts.delete(id); throw error; }
    this.event(crypto.randomUUID(), parentHostId, id, "fabric.host", "active", { pid: process.pid, local: true });
    return host;
  }
  acceptTick(body: Record<string, unknown>, token: string | null) {
    if (token !== this.options.token) throw new FabricError("Refused.", 403);
    const runtime = this.session(String(body.sessionId));
    const session = runtime.session;
    if (body.kind !== session.kind || !Number.isInteger(body.pid) || Number(body.pid) <= 0) throw new FabricError("Invalid worker identity.");
    session.pid = Number(body.pid);
    session.ticks = Number(body.ticks || 0);
    session.paused = Boolean(body.paused);
    session.metrics = body.metrics as WorkloadMetrics;
    session.lastCommand = String(body.lastCommand || "start");
    session.commandRevision = Number(body.commandRevision || 0);
    session.updatedAt = Date.now();
    if (Array.isArray(body.recentlines)) session.recentlines = body.recentlines.filter(value => typeof value === "string").slice(-12);
    this.revision++;
    return { ok: true };
  }
  command(body: { sessionId: string; action: Action }) {
    if (!validFabricAction(body.action)) throw new FabricError("Choose pulse, pause or resume.");
    if (this.stopping) throw new FabricError("Preview is shutting down.", 503);
    if (body.sessionId !== "scene") this.session(body.sessionId);
    if (this.deletingSessions.has(body.sessionId)) throw new FabricError("Session is being terminated.", 409);
    const prior = this.commandQueues.get(body.sessionId) ?? Promise.resolve();
    const next = prior.then(() => this.applyCommand(body.sessionId, body.action));
    this.commandQueues.set(body.sessionId, next.catch(() => {}));
    return next;
  }
  private async applyCommand(sessionId: string, action: Action) {
    const messageId = crypto.randomUUID();
    this.event(messageId, "browser", sessionId, "fabric.command", "sent", { action });
    try {
      if (sessionId === "scene") await this.options.rootCommand(action, messageId);
      else await this.deliverCommand(this.session(sessionId), action);
      const session = sessionId === "scene" ? this.rootSession() : { ...this.session(sessionId).session, connected: true };
      this.event(messageId, sessionId, "views", "fabric.command", "applied", { action, revision: session.commandRevision });
      return { ok: true, session, messageId };
    } catch (error) { this.event(messageId, sessionId, "views", "fabric.command", "error", { action, error: String(error) }); throw error; }
  }
  private async deliverCommand(runtime: SessionRuntime, action: Action) {
    const session = runtime.session;
    const host = this.host(session.hostId);
    const revision = session.commandRevision;
    await this.run(host, ["paste", runtime.nativeName, action]);
    await this.run(host, ["send-keys", runtime.nativeName, "Enter"]);
    await this.waitFor(() => session.commandRevision > revision && session.lastCommand === action, "Native workload did not acknowledge the command. Inspect before retrying.", 3000);
  }
  async screen(sessionId: string) {
    if (sessionId === "scene") return this.run(this.host("studio"), ["snapshot", "vgpu", "--json"]);
    const runtime = this.session(sessionId);
    return this.run(this.host(runtime.session.hostId), ["snapshot", runtime.nativeName, "--json"]);
  }
  private sessionDescendants(initial: Iterable<string>) {
    const ids = new Set(initial);
    let changed = true;
    while (changed) {
      changed = false;
      for (const { session } of this.sessions.values()) {
        if (session.parentSessionId && ids.has(session.parentSessionId) && !ids.has(session.id)) {
          ids.add(session.id);
          changed = true;
        }
      }
    }
    return [...ids];
  }
  private hostDescendants(hostId: string) {
    const ids = new Set([hostId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const { host } of this.hosts.values()) {
        if (host.parentHostId && ids.has(host.parentHostId) && !ids.has(host.id)) {
          ids.add(host.id);
          changed = true;
        }
      }
    }
    return [...ids];
  }
  deleteSession(body: { sessionId: string }) {
    return this.serialize(async () => {
      if (body.sessionId === "scene") throw new FabricError("The primary optical world is protected.", 403);
      this.session(body.sessionId);
      return this.teardown(this.sessionDescendants([body.sessionId]), []);
    });
  }
  deleteHost(body: { hostId: string }) {
    return this.serialize(async () => {
      if (body.hostId === "studio") throw new FabricError("The primary studio host is protected.", 403);
      this.host(body.hostId);
      const hosts = this.hostDescendants(body.hostId);
      const sessions = [...this.sessions.values()].filter(({ session }) => hosts.includes(session.hostId)).map(({ session }) => session.id);
      return this.teardown(this.sessionDescendants(sessions), hosts);
    });
  }
  private async teardown(sessionIds: string[], hostIds: string[]) {
    const messageId = crypto.randomUUID();
    for (const id of sessionIds) this.deletingSessions.add(id);
    this.event(messageId, "browser", "fabric", "fabric.teardown", "requested", { sessionIds, hostIds });
    try {
      // Commands accepted before termination finish first; later ones are refused.
      await Promise.allSettled(sessionIds.map(id => this.commandQueues.get(id)));
      for (const id of [...sessionIds].reverse()) await this.destroySession(id);
      for (const id of [...hostIds].reverse()) {
        await this.stopHost(this.host(id));
        this.hosts.delete(id);
      }
      this.event(messageId, "fabric", "views", "fabric.teardown", "removed", { sessionIds, hostIds });
      return { ok: true, removedSessionIds: sessionIds, removedHostIds: hostIds, messageId };
    } catch (error) {
      this.event(messageId, "fabric", "views", "fabric.teardown", "error", { error: String(error) });
      throw error;
    } finally { for (const id of sessionIds) this.deletingSessions.delete(id); }
  }
  private async destroySession(id: string) {
    const runtime = this.session(id);
    try { await this.run(this.host(runtime.session.hostId), ["kill", runtime.nativeName, "--yes"]); }
    catch (error) { if (processAlive(runtime.session.pid)) throw error; }
    await this.waitFor(() => !processAlive(runtime.session.pid), "Native worker has not exited yet.", 3000);
    this.sessions.delete(id);
    this.commandQueues.delete(id);
    this.revision++;
  }
  private async stopHost(host: HostRuntime) {
    if (host.process?.exitCode == null) host.process?.kill("SIGTERM");
    await host.process?.exited;
    await rm(host.directory, { recursive: true, force: true });
  }
  async close() {
    this.stopping = true;
    await this.creationQueue;
    await Promise.allSettled(this.commandQueues.values());
    const extras = [...this.hosts.values()].filter(host => host.host.id !== "studio");
    await Promise.allSettled(extras.map(host => this.stopHost(host)));
    const studio = this.host("studio");
    const local = [...this.sessions.values()].filter(runtime => runtime.session.hostId === "studio");
    await Promise.allSettled(local.map(runtime => this.run(studio, ["kill", runtime.nativeName, "--yes"])));
    this.sessions.clear();
  }
}
