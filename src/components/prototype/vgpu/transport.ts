import type { SharedScene } from "./browser-engine";

export function isBrowserConceptPath(pathname: string) {
  return pathname.replace(/\/index\.html$/, "").replace(/\.html$/, "").replace(/\/$/, "") === "/concepts/vgpu";
}
export const isBrowserConcept = typeof location !== "undefined" && isBrowserConceptPath(location.pathname);
const storageKey = "phux.concepts.scene.v1";
const channelName = "phux-concepts-scene-v1";
type Pending = { resolve: (response: Response) => void; reject: (error: Error) => void; cleanup: () => void };
let bridge: BrowserTransport | null = null;
let references = 0;

class BrowserTransport {
  private worker = new Worker(new URL("./browser-worker.ts", import.meta.url), { type: "module", name: "phux-concepts" });
  private pending = new Map<string, Pending>();
  private channel: BroadcastChannel | null = null;
  private disposed = false;
  private lastShared = "";
  constructor() {
    this.worker.addEventListener("message", event => this.receive(event.data));
    this.worker.addEventListener("error", () => this.fail("The browser computation worker could not start. Reload this concept to retry."));
    document.addEventListener("visibilitychange", this.visibility);
    window.addEventListener("pagehide", this.pagehide);
    window.addEventListener("pageshow", this.pageshow);
    window.addEventListener("storage", this.storage);
    this.visibility();
    try { this.restore(localStorage.getItem(storageKey)); } catch { /* Storage may be unavailable in private contexts. */ }
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(channelName);
      this.channel.addEventListener("message", event => this.restore(JSON.stringify(event.data)));
    }
  }
  private visibility = () => { this.worker.postMessage({ type: "visibility", visible: !document.hidden }); };
  private pagehide = (event: PageTransitionEvent) => {
    if (event.persisted) this.worker.postMessage({ type: "visibility", visible: false });
    else this.dispose();
  };
  private pageshow = (event: PageTransitionEvent) => {
    if (!event.persisted) return;
    this.visibility();
    document.dispatchEvent(new Event("visibilitychange"));
  };
  private storage = (event: StorageEvent) => { if (event.key === storageKey) this.restore(event.newValue); };
  private restore(value: string | null) {
    if (!value || value === this.lastShared) return;
    try { this.worker.postMessage({ type: "restore", scene: JSON.parse(value) }); this.lastShared = value; } catch { /* Ignore invalid persisted settings. */ }
  }
  private share(scene: SharedScene) {
    this.channel?.postMessage(scene);
    try { localStorage.setItem(storageKey, JSON.stringify(scene)); } catch { /* Controls still work without persistence. */ }
  }
  private receive(value: { id: string; status: number; body?: unknown; scene?: SharedScene }) {
    const request = this.pending.get(value.id);
    if (!request) return;
    this.pending.delete(value.id);
    request.cleanup();
    if (value.scene) this.share(value.scene);
    const body = value.status === 204 ? null : JSON.stringify(value.body ?? {});
    request.resolve(new Response(body, { status: value.status, headers: { "content-type": "application/json", "cache-control": "no-store" } }));
  }
  private fail(message: string) {
    for (const request of this.pending.values()) { request.cleanup(); request.reject(new Error(message)); }
    this.pending.clear();
  }
  async request(path: string, init: RequestInit = {}): Promise<Response> {
    if (this.disposed) throw new Error("The browser runtime has closed.");
    if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    let body: unknown = {};
    if (typeof init.body === "string") {
      try { body = JSON.parse(init.body); } catch { return Response.json({ error: "Send valid JSON." }, { status: 400 }); }
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Send a JSON object." }, { status: 400 });
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const abort = () => { this.pending.delete(id); cleanup(); reject(new DOMException("Aborted", "AbortError")); };
      const timeout = setTimeout(() => { this.pending.delete(id); cleanup(); reject(new Error("The browser worker did not respond.")); }, 15_000);
      const cleanup = () => { clearTimeout(timeout); init.signal?.removeEventListener("abort", abort); };
      this.pending.set(id, { resolve, reject, cleanup });
      init.signal?.addEventListener("abort", abort, { once: true });
      this.worker.postMessage({ type: "request", id, path, method: init.method ?? "GET", body });
    });
  }
  dispose = () => {
    if (this.disposed) return;
    this.disposed = true;
    document.removeEventListener("visibilitychange", this.visibility);
    window.removeEventListener("pagehide", this.pagehide);
    window.removeEventListener("pageshow", this.pageshow);
    window.removeEventListener("storage", this.storage);
    this.channel?.close();
    this.worker.terminate();
    this.fail("The browser runtime has closed.");
    if (bridge === this) bridge = null;
  };
}
function browserTransport() { return bridge ??= new BrowserTransport(); }
export function retainSceneTransport() {
  if (!isBrowserConcept) return () => {};
  references++;
  browserTransport();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    references--;
    queueMicrotask(() => { if (references === 0) bridge?.dispose(); });
  };
}
/** Public concepts never make a network request to the native preview bridge. */
export function sceneFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  if (!isBrowserConcept) return fetch(input, init);
  const url = new URL(String(input), location.origin);
  if (url.origin !== location.origin || !url.pathname.startsWith("/__scene/")) return Promise.resolve(Response.json({ error: "This public concept only supports its browser controls." }, { status: 400 }));
  return browserTransport().request(url.pathname + url.search, init);
}
