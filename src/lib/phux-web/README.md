# phux-web (generated)

These are the real PHUX browser client artifacts, compiled from
`clients/phux-web`. The Rust client speaks the PHUX wire and embeds the real
libghostty-vt engine. The website loads them dynamically when a terminal starts.
Do not edit generated JavaScript, declarations, or WASM by hand.

## Source and reproduction

Source branch: `feat/glass-pane-views` in the isolated product checkout.
Source commit: `7150316b43a187f4222f21c9bc4c1d4cb3bd7018`.
Base: `ec9978c3b5998d7ae5f1f4f4dbc5c9e4a5ecd415` (product release 0.80.1).

The presentation commits were rebased unchanged onto that main revision:
`079834aa`, `e7ffc903`, `7150316b`. The recoverable local backup ref
`backup/glass-pane-views-before-main-20261016` retains the previous stack.

Toolchain: Rust 1.99.0, wasm-pack 0.15.0, wasm-bindgen 0.2.129,
Binaryen 132. Command: `wasm-pack build --target web --release --out-dir pkg --locked`.
The website helper accepts an explicit product checkout:

```sh
PHUX_DIR=/path/to/phux bun run build:client
```

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `phux_web.js` | 68521 | `48d1648719b7e0fbc0925316504a34628e0870ff84ebf98a22674648bb8bac85` |
| `phux_web_bg.wasm` | 2315880 | `12869f3dbc39cb84227e60547dd72863cbb7621cf24c89000f61cb95ead2863c` |
| `phux_web.d.ts` | 9966 | `b552b11558bd4f386fcdbbe964f0380eff990f702f636b6374f3e162113d233c` |
| `phux_web_bg.wasm.d.ts` | 3875 | `4e263ef93ba3d3593bf8c0c6170fc4c8819ffd5fa5f302a7e04a45d9c97e06e6` |

## Protocol compatibility

The client still implements protocol 0.9.0. The website edge server remains
pinned to `7eaa9cf61909e41d36ef2afa776444b9fde06e7f`, also protocol 0.9.0.
New product-main agent commands are additive; this integration changes no wire
bytes or server behavior. The exact release package was tested in real Chrome
against the website's compiled `worker/edge/phux_edge_bg.wasm`: one hosted
WebSocket, two independently addressed panes, split/bootstrap, direct focus,
real typed command output, and transparent default pixels all passed.

The client WASM is 2,315,880 bytes raw (740,927 gzip). New product-main codec
features account for the size increase from the previous 2,158,318-byte build.
No extra sessions or network services are required for pane projections.

## Presentation interface

- `phux-panes` retains `count`, `focused`, `pending` and optional `error`, adding
  canonical `{id,x,y,cols,rows,cursorRow?}` descriptors and total cell geometry.
- `phux-render` reports those descriptors after an actual full canvas paint,
  with backing pixel dimensions. Cursor-only blinks do not emit this event.
- `cursorRow` comes from already-read engine grids; no extra grid copy occurs.
- `HostedClient.focus_pane(id)` targets an exact visible canonical resource.
- `send_text(text)` sends one trusted paste, bounded to 4096 UTF-8 bytes, with no
  implicit Enter. Empty text is a no-op.
- `set_glass_mode(true)` clears default backgrounds and native pane borders.
  Explicit ANSI backgrounds, including black or the default RGB, remain opaque.
  Inverse, selection/search, and cursor rendering remain visible. Clear-before-
  paint removes glyph and blink trails. Opaque presentation remains the default.

The VT adapter reads actual inverse metadata from the pinned `GhosttyStyle`
ABI and frees its style scratch buffer with each terminal. No CSS color-keying,
blend mode, fabricated shell output, or raw-protocol imitation is used.

## Validation of the rebased source

- Node: 10 engine-adapter and 76 browser helper/session tests pass.
- Metadata normalization: 1 test; browser-runner regressions: 28 tests pass.
- Standard `scripts/ci/web-browser.py`: 31 library browser tests, 4 native live
  browser cases, 12 real-PTY input cases, 3 render checks, and 1 authenticated
  WSS fallback pass. The runner verifies its 21 normal + 1 authenticated required
  scenarios, including a real WebTransport blackhole.
- The optional loopback paste-echo test remains explicitly ignored unless its
  private fixture is supplied. Actual edge command input was exercised by the
  separate exact-package interoperability check above.
- Web doctor, WASM Clippy with warnings denied, formatting, release package
  build, and commitlint 19 on all three product commits pass.
- Always-on workflow, docs, font, E2E-lane, formula, Zig/Ghostty pin, installer,
  and portable-cache guards pass. Desktop checks (29 tests plus 13 host-lock
  tests) and the agents-fleet smoke check pass.

CI classifies the product diff as web-only; its native workspace pool and Zig
engine-reproduction lane are not selected. Hosted required checks remain the
`ci` aggregate, `commitlint`, and the applicable `web-check` workflow.
