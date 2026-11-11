import { mountPhuxTerminal, terminalCellMetrics, terminalGeometry, type HostedEvent, type PhuxController, type SessionBackend } from "../../../terminal/core";

export type Pane = { id: string; x: number; y: number; cols: number; rows: number };
export type Grid = { cols: number; rows: number; panes: Pane[] };
export type Phase = "connecting" | "live" | "closed";
export type SessionState = Grid & {
  phase: Phase;
  backend?: SessionBackend;
  focused: string;
  /** The server is rearranging panes. */
  wire: boolean;
  /** A split or close was asked for and its first frame has not painted yet. */
  awaiting: boolean;
  error: string;
};
export type SessionEvent =
  | { type: "live" }
  | { type: "backend"; backend: SessionBackend }
  | { type: "announce"; focused: string; pending: boolean; error: string }
  | { type: "paint"; grid: Grid }
  | { type: "request" }
  | { type: "abandon" }
  | { type: "fail"; error: string };

export const MAX_PANES = 4;
export const initialSession: SessionState = { phase: "connecting", cols: 0, rows: 0, panes: [], focused: "", wire: false, awaiting: false, error: "" };
export const isBusy = (state: SessionState) => state.wire || state.awaiting;
export const canAct = (state: SessionState) => state.phase === "live" && !isBusy(state);

const whole = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

/** Geometry comes from the phux client. Anything malformed is dropped, never guessed. */
export function readGrid(value: unknown): Grid | null {
  if (!value || typeof value !== "object") return null;
  const { cols, rows, panes } = value as Grid;
  if (!whole(cols, 1, 1000) || !whole(rows, 1, 1000) || !Array.isArray(panes) || panes.length > MAX_PANES) return null;
  const valid = panes.every(pane => pane && typeof pane.id === "string" && pane.id.length > 0 && pane.id.length <= 128
    && whole(pane.x, 0, cols - 1) && whole(pane.y, 0, rows - 1) && whole(pane.cols, 1, cols - pane.x) && whole(pane.rows, 1, rows - pane.y));
  if (!valid || new Set(panes.map(pane => pane.id)).size !== panes.length) return null;
  return { cols, rows, panes: panes.map(({ id, x, y, cols, rows }) => ({ id, x, y, cols, rows })) };
}

function readAnnouncement(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  return { focused: typeof data.focused === "string" ? data.focused : "", pending: data.pending === true, error: typeof data.error === "string" ? data.error : "" };
}

const sameGrid = (a: Grid, b: Grid) => a.cols === b.cols && a.rows === b.rows && a.panes.length === b.panes.length
  && a.panes.every((pane, i) => { const other = b.panes[i]; return pane.id === other.id && pane.x === other.x && pane.y === other.y && pane.cols === other.cols && pane.rows === other.rows; });

/** Every change to the workspace goes through here. */
export function step(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case "live": return state.phase === "connecting" ? { ...state, phase: "live" } : state;
    case "backend": return { ...state, backend: event.backend };
    case "request": return canAct(state) ? { ...state, awaiting: true, error: "" } : state;
    case "abandon": return { ...state, awaiting: false };
    case "fail": return { ...state, phase: "closed", wire: false, awaiting: false, error: event.error };
    case "announce": return {
      ...state,
      wire: event.pending,
      awaiting: event.error ? false : event.pending || state.awaiting,
      focused: event.focused || state.focused,
      error: event.error,
    };
    case "paint": {
      const awaiting = state.wire && state.awaiting;
      if (awaiting === state.awaiting && sameGrid(state, event.grid)) return state;
      return { ...state, ...event.grid, awaiting };
    }
  }
}

let serial = 0;

/** One hosted connection and the canvas the phux client paints. */
export class LiveSession {
  private state = initialSession;
  private listeners = new Set<() => void>();
  private abort = new AbortController();
  private client?: PhuxController;
  private size = { cols: 0, rows: 0 };
  private settle?: ReturnType<typeof setTimeout>;
  readonly canvas = document.createElement("canvas");

  constructor(private mount: typeof mountPhuxTerminal = mountPhuxTerminal) {
    this.canvas.id = `phux-live-${++serial}`;
    this.canvas.className = "live-canvas";
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("aria-label", "Live phux terminal. Click a pane and type.");
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private send(event: SessionEvent) {
    const next = step(this.state, event);
    if (next === this.state) return;
    this.state = next;
    // A frame can land before the server says it is done; never wait on a paint that already happened.
    clearTimeout(this.settle);
    if (next.awaiting && !next.wire) this.settle = setTimeout(() => this.send({ type: "abandon" }), 1500);
    this.listeners.forEach(listener => listener());
  }

  /** Connect. `box` is the space the canvas may fill; the canvas must already be in the document. */
  async connect(wsUrl: string, box: { width: number; height: number }) {
    const { signal } = this.abort;
    if (!wsUrl) return this.send({ type: "fail", error: "The hosted demo is not configured." });
    this.canvas.addEventListener("phux-panes", event => {
      const announcement = readAnnouncement((event as CustomEvent).detail);
      if (announcement) this.send({ type: "announce", ...announcement });
    }, { signal });
    this.canvas.addEventListener("phux-render", event => {
      const grid = readGrid((event as CustomEvent).detail);
      if (grid) this.send({ type: "paint", grid });
    }, { signal });
    // A protocol failure can drop the socket before any hosted callback runs.
    const dropped = new MutationObserver(() => { if (this.canvas.dataset.phuxConnection === "disconnected") this.fail("The connection was interrupted."); });
    dropped.observe(this.canvas, { attributes: true, attributeFilter: ["data-phux-connection"] });
    signal.addEventListener("abort", () => dropped.disconnect(), { once: true });
    window.addEventListener("pagehide", event => { if (!(event as PageTransitionEvent).persisted) this.dispose(); }, { signal });
    try {
      this.size = terminalGeometry(box.width, box.height, 240, 60);
      const client = await this.mount({ wsUrl, canvasId: this.canvas.id, ...this.size, mode: "demo", appearance: "glass", signal, onEvent: this.hosted });
      if (signal.aborted) return client.close();
      this.client = client;
      this.send({ type: "live" });
    } catch {
      if (!signal.aborted) this.fail("Couldn’t reach the demo shell.");
    }
  }
  private hosted = (event: HostedEvent) => {
    if (event.type === "phux.session.v1") this.send({ type: "backend", backend: event.backend });
    else this.fail(event.type === "close" ? "This demo shell has ended." : "The connection was interrupted.");
  };
  private fail(error: string) {
    if (this.abort.signal.aborted) return;
    this.release();
    this.send({ type: "fail", error });
  }
  private release() {
    clearTimeout(this.settle);
    this.abort.abort();
    this.client?.close();
    this.client = undefined;
  }

  get cell() { return terminalCellMetrics(this.canvas.dataset); }
  /** Fill the given box with whole cells. Glyphs are never scaled. */
  fit(width: number, height: number) {
    if (!this.client || !canAct(this.state)) return;
    const size = terminalGeometry(width, height, 240, 60, this.cell);
    if (size.cols === this.size.cols && size.rows === this.size.rows) return;
    this.size = size;
    this.client.resize(size.cols, size.rows);
  }
  private change(action: (client: PhuxController) => void) {
    if (!this.client || !canAct(this.state)) return;
    this.send({ type: "request" });
    try { action(this.client); } catch { this.send({ type: "abandon" }); }
  }
  split(axis: "vertical" | "horizontal") { if (this.state.panes.length < MAX_PANES) this.change(client => client.splitPane(axis)); }
  closePane() { if (this.state.panes.length > 1) this.change(client => client.closePane()); }
  focus(id: string) { if (canAct(this.state) && this.state.panes.some(pane => pane.id === id)) this.client?.focusPane(id); }
  /** Type a line into the focused pane, exactly as the keyboard would. */
  run(line: string) { if (canAct(this.state)) this.client?.sendText(`${line}\n`); }
  takeKeyboard() { if (this.state.phase === "live") this.canvas.focus({ preventScroll: true }); }
  dispose() {
    this.release();
    this.listeners.clear();
    this.canvas.remove();
  }
}
