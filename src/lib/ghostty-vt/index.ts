export type RGB = [number, number, number];
export type GhosttyCell = { text: string; fg: RGB | null; bg: RGB | null };
export type GhosttyGrid = { cols: number; rows: number; defaultFg: RGB; defaultBg: RGB; cells: GhosttyCell[]; cursor: { col: number; row: number; visible: boolean } };
export const ghosttyLicenseUrl = new URL("./LICENSE", import.meta.url).href;
export const ghosttyNoticeUrl = new URL("./NOTICE", import.meta.url).href;
type WasmFunction = (...args: number[]) => number | undefined;

/** A shared real libghostty-vt instance, containing independent terminal handles. */
export class GhosttyEngine {
  readonly memory: WebAssembly.Memory;
  private functions = new Map<string, WasmFunction>();
  private terminals = new Set<GhosttyTerminal>();
  constructor(exports: WebAssembly.Exports) {
    if (!(exports.memory instanceof WebAssembly.Memory)) throw new Error("Ghostty engine has no memory export.");
    this.memory = exports.memory;
    for (const [name, value] of Object.entries(exports)) if (typeof value === "function") this.functions.set(name, value as WasmFunction);
    for (const name of ["ghostty_terminal_new", "ghostty_terminal_vt_write", "ghostty_render_state_new", "ghostty_render_state_row_cells_get"]) if (!this.functions.has(name)) throw new Error(`Ghostty engine is missing ${name}.`);
  }
  call(name: string, ...args: number[]) {
    const fn = this.functions.get(name);
    if (!fn) throw new Error(`Ghostty engine is missing ${name}.`);
    return fn(...args);
  }
  check(name: string, ...args: number[]) {
    const status = this.call(name, ...args);
    if (status !== undefined && status !== 0) throw new Error(`${name} failed (${status}).`);
  }
  alloc(length: number) {
    const ptr = Number(this.call("ghostty_wasm_alloc_u8_array", length));
    if (!ptr) throw new Error("Ghostty engine could not allocate memory.");
    new Uint8Array(this.memory.buffer, ptr, length).fill(0);
    return ptr;
  }
  free(ptr: number, length: number) { if (ptr) this.call("ghostty_wasm_free_u8_array", ptr, length); }
  u32(ptr: number) { return new DataView(this.memory.buffer).getUint32(ptr, true); }
  clear32(ptr: number) { new DataView(this.memory.buffer).setUint32(ptr, 0, true); }
  rgb(ptr: number): RGB { const bytes = new Uint8Array(this.memory.buffer, ptr, 3); return [bytes[0], bytes[1], bytes[2]]; }
  createTerminal(cols: number, rows: number) {
    const terminal = new GhosttyTerminal(this, cols, rows);
    this.terminals.add(terminal);
    return terminal;
  }
  release(terminal: GhosttyTerminal) { this.terminals.delete(terminal); }
  get terminalCount() { return this.terminals.size; }
}

export class GhosttyTerminal {
  private term = 0;
  private state = 0;
  private iterSlot = 0;
  private cellsSlot = 0;
  private scratch = 0;
  private glyph = 0;
  private disposed = false;
  constructor(private engine: GhosttyEngine, cols: number, rows: number) {
    validateSize(cols, rows);
    try {
      this.scratch = engine.alloc(8);
      this.glyph = engine.alloc(256);
      this.term = this.newHandle("ghostty_terminal_new", cols, rows);
      this.state = this.newHandle("ghostty_render_state_new");
      this.iterSlot = engine.alloc(4);
      engine.check("ghostty_render_state_row_iterator_new", 0, this.iterSlot);
      this.cellsSlot = engine.alloc(4);
      engine.check("ghostty_render_state_row_cells_new", 0, this.cellsSlot);
    } catch (error) { this.dispose(); throw error; }
  }
  private newHandle(name: string, ...args: number[]) {
    this.engine.clear32(this.scratch);
    this.engine.check(name, 0, this.scratch, ...args);
    const handle = this.engine.u32(this.scratch);
    if (!handle) throw new Error(`${name} returned an empty handle.`);
    return handle;
  }
  private ensureOpen() { if (this.disposed) throw new Error("Ghostty terminal has been disposed."); }
  write(input: string | Uint8Array) {
    this.ensureOpen();
    const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
    if (!bytes.length) return;
    if (bytes.length > 256 * 1024) throw new Error("Ghostty frame exceeds the local display limit.");
    const ptr = this.engine.alloc(bytes.length);
    try { new Uint8Array(this.engine.memory.buffer, ptr, bytes.length).set(bytes); this.engine.check("ghostty_terminal_vt_write", this.term, ptr, bytes.length); }
    finally { this.engine.free(ptr, bytes.length); }
  }
  resize(cols: number, rows: number, cellWidth = 8, cellHeight = 16) {
    this.ensureOpen(); validateSize(cols, rows);
    this.engine.check("ghostty_terminal_resize", this.term, cols, rows, Math.max(1, Math.ceil(cellWidth)), Math.max(1, Math.ceil(cellHeight)));
  }
  private readValue(name: string, handle: number, tag: number) {
    this.engine.clear32(this.scratch);
    this.engine.check(name, handle, tag, this.scratch);
    return this.engine.u32(this.scratch);
  }
  private color(name: string, handle: number, tag: number): RGB | null {
    const status = this.engine.call(name, handle, tag, this.scratch);
    return status === 0 ? this.engine.rgb(this.scratch) : null;
  }
  private cell(cells: number): GhosttyCell {
    const count = this.readValue("ghostty_render_state_row_cells_get", cells, 3);
    let text = " ";
    if (count > 64) text = "�";
    else if (count > 0) {
      this.engine.check("ghostty_render_state_row_cells_get", cells, 4, this.glyph);
      const point = this.engine.u32(this.glyph);
      text = point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : " ";
    }
    return { text, fg: this.color("ghostty_render_state_row_cells_get", cells, 6), bg: this.color("ghostty_render_state_row_cells_get", cells, 5) };
  }
  grid(): GhosttyGrid {
    this.ensureOpen();
    const e = this.engine;
    e.check("ghostty_render_state_update", this.state, this.term);
    const cols = this.readValue("ghostty_render_state_get", this.state, 1);
    const rows = this.readValue("ghostty_render_state_get", this.state, 2);
    e.check("ghostty_render_state_get", this.state, 4, this.iterSlot);
    const iterator = e.u32(this.iterSlot);
    const cells: GhosttyCell[] = [];
    while (e.call("ghostty_render_state_row_iterator_next", iterator)) {
      e.check("ghostty_render_state_row_get", iterator, 3, this.cellsSlot);
      const current = e.u32(this.cellsSlot);
      const row: GhosttyCell[] = [];
      while (e.call("ghostty_render_state_row_cells_next", current)) row.push(this.cell(current));
      while (row.length < cols) row.push({ text: " ", fg: null, bg: null });
      cells.push(...row.slice(0, cols));
    }
    return {
      cols, rows, cells,
      defaultFg: this.color("ghostty_render_state_get", this.state, 6) ?? [215, 215, 221],
      defaultBg: this.color("ghostty_render_state_get", this.state, 5) ?? [11, 11, 15],
      cursor: { col: this.readValue("ghostty_terminal_get", this.term, 3), row: this.readValue("ghostty_terminal_get", this.term, 4), visible: this.readValue("ghostty_terminal_get", this.term, 7) !== 0 },
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const e = this.engine;
    if (this.iterSlot) { const iterator = e.u32(this.iterSlot); if (iterator) e.call("ghostty_render_state_row_iterator_free", iterator); }
    if (this.cellsSlot) { const cells = e.u32(this.cellsSlot); if (cells) e.call("ghostty_render_state_row_cells_free", cells); }
    if (this.state) e.call("ghostty_render_state_free", this.state);
    if (this.term) e.call("ghostty_terminal_free", this.term);
    e.free(this.iterSlot, 4); e.free(this.cellsSlot, 4); e.free(this.scratch, 8); e.free(this.glyph, 256);
    e.release(this);
  }
}
function validateSize(cols: number, rows: number) {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || cols > 240 || rows < 1 || rows > 100) throw new Error("Ghostty grid size is outside local display limits.");
}
export async function instantiateGhostty(source: BufferSource | WebAssembly.Module) {
  let memory: WebAssembly.Memory | undefined;
  const imports = {
    env: { log: () => {} },
    ghostty: { host_entropy_fill: (ptr: number, length: number) => {
      if (!memory || ptr < 0 || length < 0 || ptr + length > memory.buffer.byteLength) return -1;
      for (let offset = 0; offset < length; offset += 65536) crypto.getRandomValues(new Uint8Array(memory.buffer, ptr + offset, Math.min(65536, length - offset)));
      return 0;
    } },
  };
  const module = source instanceof WebAssembly.Module ? source : await WebAssembly.compile(source);
  const result = await WebAssembly.instantiate(module, imports);
  const engine = new GhosttyEngine(result.exports);
  memory = engine.memory;
  return engine;
}
export function createEngineLoader(load: () => Promise<BufferSource | WebAssembly.Module>) {
  let pending: Promise<GhosttyEngine> | null = null;
  return () => pending ??= load().then(instantiateGhostty).catch(error => { pending = null; throw error; });
}
export const getGhosttyEngine = createEngineLoader(async () => {
  const response = await fetch(new URL("./ghostty-vt.wasm", import.meta.url));
  if (!response.ok) throw new Error(`Ghostty engine could not load (${response.status}).`);
  return response.arrayBuffer();
});
