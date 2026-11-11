import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MutableRefObject, type ReactNode } from "react";
import { SITE } from "../../../../lib/site";
import { Scene, type SceneGlass } from "../Scene";
import { useLiveScene, type RuntimeControl } from "../runtime";
import type { Pointer } from "../scene-motion";
import { LiveSession, MAX_PANES, canAct, isBusy, type Pane, type SessionState } from "./session";
import InstallHook from "./InstallHook";
import "./live.css";

const SUGGESTIONS = ["help", "ls", "demo glass"];
/** Room around the cell grid, so a pane's tile can reach half a cell past its text. */
const INSET = 12;

function Icon({ children }: { children: ReactNode }) {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden="true">
    <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.25" />{children}
  </svg>;
}

/** Each pane is a tile under the canvas, placed from the geometry the client publishes. */
function tile(pane: Pane, cell: { width: number; height: number }): CSSProperties {
  return {
    left: (pane.x - .5) * cell.width, top: (pane.y - .5) * cell.height,
    width: (pane.cols + 1) * cell.width, height: (pane.rows + 1) * cell.height,
  };
}

function Status({ state, retry }: { state: SessionState; retry: () => void }) {
  if (state.phase === "live" && state.panes.length) return null;
  const closed = state.phase === "closed";
  return <div className="live-status" role="status">
    <p>{closed ? state.error : "Opening a shell…"}</p>
    {closed && <button type="button" onClick={retry}>Start a fresh shell</button>}
  </div>;
}

function Terminal({ glass, retry }: { glass: MutableRefObject<SceneGlass>; retry: () => void }) {
  const session = useMemo(() => new LiveSession(), []);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const screen = useRef<HTMLDivElement>(null), grid = useRef<HTMLDivElement>(null);
  const touched = useRef(false), seeded = useRef(new Set<string>());
  const ready = canAct(state), busy = isBusy(state), count = state.panes.length;

  useEffect(() => {
    const box = screen.current!;
    const room = () => ({ width: box.clientWidth - INSET * 2, height: box.clientHeight - INSET * 2 });
    grid.current!.prepend(session.canvas);
    void session.connect(SITE.demoWsUrl, room());
    const observer = new ResizeObserver(() => { const { width, height } = room(); session.fit(width, height); });
    observer.observe(box);
    return () => { observer.disconnect(); session.dispose(); };
  }, [session]);
  // The first fit needs the font metrics the client measures while it mounts.
  useEffect(() => {
    if (ready && screen.current) session.fit(screen.current.clientWidth - INSET * 2, screen.current.clientHeight - INSET * 2);
  }, [ready, session]);

  // An untouched demo sets its own table: an intro, then one real split. Any input ends that for good.
  useEffect(() => {
    if (!ready || touched.current || state.backend !== "edge") return;
    const fresh = state.panes.find(pane => !seeded.current.has(pane.id));
    if (fresh) {
      seeded.current.add(fresh.id);
      const first = state.panes[0].id;
      session.focus(fresh.id);
      session.run(fresh.id === first ? "theme glass\nclear\ndemo glass" : "theme glass\nclear\nls");
      session.focus(first);
      return;
    }
    // A phone-width grid has no room for two readable panes.
    if (count !== 1 || state.cols < 80) return;
    const timer = setTimeout(() => { if (!touched.current) { glass.current.pulse = performance.now(); session.split("vertical"); } }, 900);
    return () => clearTimeout(timer);
  }, [ready, state.backend, state.panes, state.cols, count, session, glass]);

  const act = (action: () => void) => () => {
    touched.current = true;
    glass.current.pulse = performance.now();
    action();
    session.takeKeyboard();
  };
  const cell = session.cell;
  return <div className="live-window" data-phase={state.phase} data-busy={busy} onPointerDownCapture={() => { touched.current = true; }} onKeyDownCapture={() => { touched.current = true; }}>
    <header className="live-bar">
      <p className="live-title"><i aria-hidden="true" /><b>phux</b><span>{state.phase === "live" ? state.backend === "native" ? "Linux shell" : "demo shell" : state.phase === "closed" ? "ended" : "connecting"}</span></p>
      <nav className="live-tools" aria-label="Panes">
        <span className="live-count" aria-live="polite">{count > 1 ? `${count} panes` : ""}</span>
        <button type="button" title="Split right (Ctrl+A %)" aria-label="Split right" disabled={!ready || count >= MAX_PANES} onClick={act(() => session.split("vertical"))}><Icon><path d="M8 2.75v10.5" /></Icon></button>
        <button type="button" title={'Split down (Ctrl+A ")'} aria-label="Split down" disabled={!ready || count >= MAX_PANES} onClick={act(() => session.split("horizontal"))}><Icon><path d="M1.75 8h12.5" /></Icon></button>
        <button type="button" title="Close pane (Ctrl+A x)" aria-label="Close pane" disabled={!ready || count < 2} onClick={act(() => session.closePane())}><Icon><path d="m6.25 6.25 3.5 3.5m0-3.5-3.5 3.5" /></Icon></button>
      </nav>
    </header>
    <div className="live-screen" ref={screen}>
      <div className="live-grid" data-panes={count} ref={grid}>
        {state.phase === "live" && state.panes.map(pane => <i key={pane.id} className="live-tile" data-pane-id={pane.id} data-focused={pane.id === state.focused} data-left={pane.x > 0} data-top={pane.y > 0} style={tile(pane, cell)} />)}
      </div>
      <Status state={state} retry={retry} />
    </div>
    <footer className="live-foot">
      <span>Try</span>
      {SUGGESTIONS.map(line => <button key={line} type="button" disabled={!ready} onClick={act(() => session.run(line))}>{line}</button>)}
      <kbd title="The multiplexer prefix: Ctrl+A, then % or &quot; to split, o for the next pane, x to close">Ctrl+A</kbd>
    </footer>
    <InstallHook />
  </div>;
}

export default function LiveWorkspace({ runtime }: { runtime: RuntimeControl }) {
  const stage = useRef<HTMLElement>(null);
  const settings = useLiveScene(runtime.state);
  const pointer = useRef<Pointer>({ x: 0, y: 0, active: 0 });
  const glass = useRef<SceneGlass>({ rects: [] });
  const [attempt, setAttempt] = useState(0);

  // The scene refracts through the window, so it needs to know where the window is.
  useEffect(() => {
    const root = stage.current!, pane = root.querySelector<HTMLElement>(".live-window");
    if (!pane) return;
    const measure = () => {
      const a = root.getBoundingClientRect(), b = pane.getBoundingClientRect();
      if (a.width && a.height) glass.current.rects = [[(b.x - a.x + b.width / 2) / a.width, (b.y - a.y + b.height / 2) / a.height, b.width / a.width, b.height / a.height]];
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root); observer.observe(pane); measure();
    return () => observer.disconnect();
  }, [attempt]);

  return <section ref={stage} className="vibe-stage live-stage" aria-label="phux browser demo"
    onPointerMove={event => {
      const box = event.currentTarget.getBoundingClientRect();
      pointer.current = { x: (event.clientX - box.x) / box.width * 2 - 1, y: 1 - (event.clientY - box.y) / box.height * 2, active: 1 };
    }}
    onPointerLeave={() => { pointer.current.active = 0; }}>
    <div className="vibe-universe"><Scene variant={1} settings={settings} ambient input={pointer} glass={glass} /></div>
    <div className="vibe-shade" />
    <Terminal key={attempt} glass={glass} retry={() => setAttempt(n => n + 1)} />
  </section>;
}
