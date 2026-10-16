# phux-web (generated)

Do not edit by hand. This is the **real** phux browser client — the phux repo's
`clients/phux-web` compiled to wasm (`wasm-pack --target web`), which embeds the
real `libghostty-vt` engine (`ghostty-vt.wasm`). The `<PhuxTerminal>` React
island (`src/components/PhuxTerminal.tsx`, via `terminal/core.ts`) dynamically
imports it on mount.

The committed artifacts are built from in-repo `clients/phux-web` at workspace
protocol 0.9, matching the native image pin and `phux-edge`. They include
`start_hosted` for the Worker session envelope.

It is committed (not built in CI) because Cloudflare Pages' build image has no
Rust/Zig toolchain. Regenerate it from this checkout:

```sh
bun run build:client     # → scripts/build-client.sh
```

`phux_web_bg.wasm` is ~2 MB (client; the VT engine is the committed
`ghostty-vt.wasm`). It is a dynamic import, so it ships only when a visitor
clicks Launch — idle pageviews never download it.

## Pane presentation build provenance

The committed client is rebuilt from local PHUX branch `feat/glass-pane-views`,
commit `a9dafcb870bd249abb082f0f866291054d606b23` (base `f65dcd5a`).
Task commits add real pane presentation, direct input and opt-in glass
appearance; no wire or server behavior is changed.

Toolchain: Rust 1.99.0, wasm-pack 0.15.0, wasm-bindgen 0.2.129,
Binaryen 132, `wasm-pack build --target web --release --out-dir pkg --locked`.
To regenerate from a separate checkout, set `PHUX_DIR` to that checkout when
running `bun run build:client`.

Verified generated files:

| File | SHA-256 |
| --- | --- |
| `phux_web.js` | `6090732338012c3623260acdf0f362b94f34c0539d1db01ed6724911b8d3ed01` |
| `phux_web_bg.wasm` | `5c5f856de279e95bd1e1b7d06887534799692a2fd989e4ad3f2fdb208b707eac` |
| `phux_web.d.ts` | `b552b11558bd4f386fcdbbe964f0380eff990f702f636b6374f3e162113d233c` |
| `phux_web_bg.wasm.d.ts` | `4e263ef93ba3d3593bf8c0c6170fc4c8819ffd5fa5f302a7e04a45d9c97e06e6` |

`phux-panes` retains its old fields and adds canonical pane descriptors and
total cell geometry. `phux-render` carries those descriptors after an actual
full canvas paint, with backing pixel dimensions. Optional pane `cursorRow`
comes from the last painted engine grid without an additional grid read.
Generated declarations include the event interfaces. Cursor-only blink redraws
do not emit the full-paint event.

`HostedClient.focus_pane(id)` targets an exact visible canonical ID.
`HostedClient.send_text(text)` sends one structured trusted paste, bounded to
4096 UTF-8 bytes, with no implicit Enter. Empty input is a no-op. These methods
reuse the existing connection and terminal; they do not create sessions.

Validation: five focused actual-Chrome/WASM presentation tests pass, including
real pixel/cursor proof, direct-focus lifecycle, reentrant paint listeners,
UTF-8 input bounds, and actual encoded paste bytes through an owned loopback
echo fixture. Rust formatting and WASM-target Clippy with warnings denied pass.
This is a focused client gate, not full PHUX CI or native-host qualification.


The same client exposes `set_glass_mode(enabled)`, default `false`. In glass
mode the real renderer clears the canvas and cursor row, skips only cells with
no explicit background, and omits native pane borders. Explicit ANSI black or
backgrounds matching the terminal default remain opaque. Inverse, selection,
search and blinking cursor rendering remain visible; disabling the mode
restores the usual opaque appearance. No CSS blending or color-keying is used.
The VT adapter now retains actual SGR inverse metadata from the pinned
`GhosttyStyle` ABI, allocating and freeing its style scratch buffer per terminal.

Glass validation: five new actual-Chrome/WASM pixel tests pass, including
transparent defaults, explicit ANSI/inverse backgrounds, selected/search cells,
exact wide-glyph pixel restoration through repeated blinks, erase cleanup and
opaque/glass toggling. Four existing presentation cases and six existing canvas
regressions also pass (15 distinct browser tests). The optional wire-echo test
remains explicitly ignored unless its owned fixture is supplied; it was not
rerun for the appearance-only follow-up. Clippy with warnings denied, format
checks and the final production client build pass.
