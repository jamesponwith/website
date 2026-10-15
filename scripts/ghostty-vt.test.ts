import { describe, expect, test } from "bun:test";
import { createEngineLoader, instantiateGhostty, type GhosttyGrid } from "../src/lib/ghostty-vt";
const source = new URL("../src/lib/ghostty-vt/ghostty-vt.wasm", import.meta.url);
const bytes = await Bun.file(source).arrayBuffer();
const text = (grid: GhosttyGrid, row = 0) => grid.cells.slice(row * grid.cols, (row + 1) * grid.cols).map(cell => cell.text).join("").trimEnd();

describe("real libghostty-vt WASM", () => {
  test("staged artifact matches the verified product binary and narrow imports", async () => {
    expect(bytes.byteLength).toBe(1534550);
    expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe("54130128fe485f08b181fd34feed4266690cea368cdf52ec853922fe8ae5da29");
    const module = await WebAssembly.compile(bytes);
    expect(WebAssembly.Module.imports(module).map(entry => `${entry.module}.${entry.name}`)).toEqual(["env.log", "ghostty.host_entropy_fill"]);
    expect(await Bun.file(new URL("../src/lib/ghostty-vt/LICENSE", import.meta.url)).text()).toContain("Copyright (c) 2024 Mitchell Hashimoto, Ghostty contributors");
  });
  test("the engine parses cursor overwrite, erase and cursor visibility", async () => {
    const engine = await instantiateGhostty(bytes), term = engine.createTerminal(20, 4);
    try {
      term.write("world\rW");
      expect(text(term.grid())).toBe("World");
      term.write("\x1b[1;3H\x1b[0K");
      expect(text(term.grid())).toBe("Wo");
      expect(term.grid().cursor).toEqual({ col: 2, row: 0, visible: true });
      term.write("\x1b[?25l\x1b[2J\x1b[Hfresh");
      const grid = term.grid();
      expect(text(grid)).toBe("fresh");
      expect(grid.cursor.visible).toBe(false);
      expect(grid.cells).toHaveLength(80);
    } finally { term.dispose(); }
  });
  test("SGR foreground/background are resolved by Ghostty, not a text parser", async () => {
    const engine = await instantiateGhostty(bytes), term = engine.createTerminal(12, 3);
    try {
      term.write("\x1b[38;2;255;0;0m\x1b[48;2;1;2;3mR\x1b[0mX");
      const grid = term.grid();
      expect(grid.cells[0]).toEqual({ text: "R", fg: [255, 0, 0], bg: [1, 2, 3] });
      expect(grid.cells[1]).toEqual({ text: "X", fg: null, bg: null });
    } finally { term.dispose(); }
  });
  test("partial UTF-8 input is retained across byte chunks", async () => {
    const engine = await instantiateGhostty(bytes), term = engine.createTerminal(12, 3);
    try {
      const input = new TextEncoder().encode("π");
      term.write(input.subarray(0, 1));
      expect(text(term.grid())).toBe("");
      term.write(input.subarray(1));
      expect(text(term.grid())).toBe("π");
    } finally { term.dispose(); }
  });
  test("one shared instance keeps independent panes through resize and free", async () => {
    const engine = await instantiateGhostty(bytes);
    const left = engine.createTerminal(20, 5), right = engine.createTerminal(40, 8);
    try {
      left.write("LEFT"); right.write("RIGHT");
      expect(engine.terminalCount).toBe(2);
      left.resize(30, 6, 7, 14);
      const resized = left.grid();
      expect([resized.cols, resized.rows]).toEqual([30, 6]);
      expect(text(resized)).toBe("LEFT");
      expect(text(right.grid())).toBe("RIGHT");
      left.dispose(); left.dispose();
      expect(engine.terminalCount).toBe(1);
      expect(() => left.write("after free")).toThrow("disposed");
      right.write("\r\ncontinues");
      expect(text(right.grid(), 1)).toBe("continues");
    } finally { left.dispose(); right.dispose(); }
    expect(engine.terminalCount).toBe(0);
  });
  test("invalid sizes and large frames are bounded before engine work", async () => {
    const engine = await instantiateGhostty(bytes);
    expect(() => engine.createTerminal(0, 5)).toThrow("limits");
    expect(() => engine.createTerminal(20, 101)).toThrow("limits");
    const term = engine.createTerminal(20, 4);
    try {
      expect(() => term.resize(1000, 10)).toThrow("limits");
      expect(() => term.write(new Uint8Array(256 * 1024 + 1))).toThrow("limit");
      expect(text(term.grid())).toBe("");
    } finally { term.dispose(); }
  });
  test("failed load retries and concurrent successful loads share one instance", async () => {
    let attempts = 0;
    const load = createEngineLoader(async () => ++attempts === 1 ? new Uint8Array([1, 2, 3]) : bytes);
    await expect(load()).rejects.toThrow();
    const [first, second] = await Promise.all([load(), load()]);
    expect(first).toBe(second);
    expect(attempts).toBe(2);
  });
  test("repeated handle disposal reuses engine memory rather than leaking panes", async () => {
    const engine = await instantiateGhostty(bytes);
    const cycle = () => {
      const terms = Array.from({ length: 6 }, () => engine.createTerminal(60, 16));
      for (const term of terms) { term.write("\x1b[38;2;25;200;100mcompute\r\nreal output"); expect(term.grid().cells).toHaveLength(960); }
      terms.forEach(term => term.dispose());
      expect(engine.terminalCount).toBe(0);
    };
    cycle();
    const warmMemory = engine.memory.buffer.byteLength;
    for (let i = 0; i < 5; i++) cycle();
    expect(engine.memory.buffer.byteLength).toBeLessThanOrEqual(warmMemory + 65536);
  });
});
