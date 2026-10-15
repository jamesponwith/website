import { useEffect, useRef, useState } from "react";
import { getGhosttyEngine, ghosttyLicenseUrl, ghosttyNoticeUrl, type GhosttyEngine, type GhosttyGrid, type GhosttyTerminal, type RGB } from "../../../lib/ghostty-vt";

export type GhosttySurfaceProps = { vt: string; label: string; fontSize?: number; className?: string; active?: boolean };
const cssColor = (color: RGB) => `rgb(${color.join(",")})`;
const bounded = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const resetFrame = "\x1b[0m\x1b[?25l\x1b[H\x1b[2J";
function plainText(value: string) {
  return value.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\r/g, "");
}
function paintGrid(context: CanvasRenderingContext2D, grid: GhosttyGrid, cellWidth: number, cellHeight: number) {
  // Backgrounds first, so a wide glyph cannot be covered by its spacer cell.
  for (let row = 0; row < grid.rows; row++) {
    const cells = grid.cells.slice(row * grid.cols, (row + 1) * grid.cols);
    for (let col = 0; col < cells.length; col++) {
      const bg = cells[col].bg;
      if (!bg) continue; // The default background is the surrounding glass.
      context.fillStyle = cssColor(bg);
      context.fillRect(col * cellWidth, row * cellHeight, cellWidth, cellHeight);
    }
    for (let col = 0; col < cells.length; col++) {
      const cell = cells[col];
      if (!cell.text.trim()) continue;
      context.fillStyle = cssColor(cell.fg ?? grid.defaultFg);
      context.fillText(cell.text, col * cellWidth, row * cellHeight);
    }
  }
}

/** A view of real libghostty-vt state; it neither starts nor connects a shell. */
export default function GhosttySurface({ vt, label, fontSize = 10, className = "", active = true }: GhosttySurfaceProps) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef({ vt, active }); current.current = { vt, active };
  const redraw = useRef<() => void>(() => {});
  const [status, setStatus] = useState<"waiting" | "ready" | "error">("waiting");
  const [error, setError] = useState("");
  useEffect(() => {
    const hostElement = host.current, canvasElement = canvas.current;
    if (!hostElement || !canvasElement) return;
    const element: HTMLDivElement = hostElement, surface: HTMLCanvasElement = canvasElement;
    const maybeContext = surface.getContext("2d", { alpha: true });
    if (!maybeContext) { setStatus("error"); setError("Canvas rendering is unavailable."); return; }
    const context: CanvasRenderingContext2D = maybeContext;
    let terminal: GhosttyTerminal | undefined;
    let cols = 0, rows = 0, frame = 0;
    let disposed = false, inFlight = false, onScreen = false, dirty = true, failed = false;
    const size = bounded(fontSize, 7, 24);
    const canPaint = () => !disposed && !document.hidden && onScreen && current.current.active;
    const requestPaint = () => {
      dirty = true;
      if (!canPaint() || frame || inFlight || failed) return;
      frame = requestAnimationFrame(() => { frame = 0; void paint(); });
    };
    const geometry = () => {
      const box = surface.getBoundingClientRect();
      const width = surface.clientWidth || box.width, height = surface.clientHeight || box.height;
      context.font = `${size}px "Paper Mono", ui-monospace, monospace`;
      const cellWidth = Math.max(1, context.measureText("M").width), cellHeight = size * 1.3;
      return { width, height, cellWidth, cellHeight, cols: bounded(Math.floor(width / cellWidth), 8, 180), rows: bounded(Math.floor(height / cellHeight), 2, 80) };
    };
    function drawSurface(grid: GhosttyGrid, box: ReturnType<typeof geometry>) {
      const dpr = bounded(window.devicePixelRatio || 1, 1, 2);
      surface.width = Math.ceil(box.width * dpr); surface.height = Math.ceil(box.height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, box.width, box.height);
      context.font = `${size}px "Paper Mono", ui-monospace, monospace`;
      context.textBaseline = "top";
      paintGrid(context, grid, box.cellWidth, box.cellHeight);
      surface.dataset.cols = String(cols); surface.dataset.rows = String(rows);
      surface.dataset.renderer = "libghostty-vt · WASM";
    }
    function applyFrame(engine: GhosttyEngine) {
      const box = geometry();
      if (box.width < 1 || box.height < 1) { dirty = false; return; }
      terminal ??= engine.createTerminal(box.cols, box.rows);
      if (cols !== box.cols || rows !== box.rows) terminal.resize(box.cols, box.rows, box.cellWidth, box.cellHeight);
      cols = box.cols; rows = box.rows;
      terminal.write(resetFrame + current.current.vt);
      drawSurface(terminal.grid(), box);
      dirty = false;
      setStatus("ready");
    }
    function showError(cause: unknown) {
      failed = true;
      terminal?.dispose(); terminal = undefined;
      if (disposed) return;
      setError(cause instanceof Error ? cause.message : "Terminal engine unavailable.");
      setStatus("error");
    }
    async function paint() {
      if (!canPaint()) return;
      inFlight = true;
      try {
        const engine = await getGhosttyEngine();
        if (canPaint()) applyFrame(engine);
      } catch (cause) {
        showError(cause);
      } finally {
        inFlight = false;
        if (dirty && canPaint() && !failed) requestPaint();
      }
    }
    const resize = new ResizeObserver(requestPaint);
    resize.observe(element);
    const intersection = new IntersectionObserver(entries => { onScreen = entries[0]?.isIntersecting ?? false; if (onScreen) requestPaint(); });
    intersection.observe(element);
    const visibility = () => { if (!document.hidden) requestPaint(); };
    document.addEventListener("visibilitychange", visibility);
    void document.fonts?.ready.then(() => requestPaint());
    redraw.current = requestPaint;
    requestPaint();
    return () => {
      disposed = true; redraw.current = () => {};
      cancelAnimationFrame(frame);
      resize.disconnect(); intersection.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      terminal?.dispose();
    };
  }, [fontSize]);
  useEffect(() => { redraw.current(); }, [vt, active]);
  return <div ref={host} className={`ghostty-surface ${className}`} data-license={ghosttyLicenseUrl} data-notice={ghosttyNoticeUrl} aria-busy={status === "waiting"}>
    <canvas ref={canvas} role="img" aria-label={`${label} · ${status === "ready" ? "libghostty VT output" : "terminal view"}`} data-renderer={status === "ready" ? "libghostty-vt · WASM" : undefined} style={{ display: status === "error" ? "none" : "block", width: "100%", height: "100%", background: "transparent" }}/>
    {status === "waiting" && <span role="status" style={{ position: "absolute", inset: 0, font: '9px "Paper Mono", monospace', color: "#a19aa9" }}>Loading terminal engine…</span>}
    {status === "error" && <><span role="status" title={error} style={{ font: '9px "Paper Mono", monospace' }}>Terminal engine unavailable · plain output fallback</span><pre aria-label={`${label} · plain output fallback`} data-renderer="text-fallback" style={{ margin: 0, whiteSpace: "pre-wrap", font: `${bounded(fontSize, 7, 24)}px/1.3 "Paper Mono", monospace` }}>{plainText(vt)}</pre></>}
  </div>;
}
