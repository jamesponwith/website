# libghostty-vt browser adapter

`ghostty-vt.wasm` is the actual standalone Ghostty VT engine already shipped by
PHUX. It is copied byte-for-byte from
`phux/clients/phux-vt-web/vendor/ghostty-vt.wasm`; no product source is modified.

- Size: **1,534,550 bytes**
- SHA-256: `54130128fe485f08b181fd34feed4266690cea368cdf52ec853922fe8ae5da29`
- Engine source: `phall1/ghostty` revision
  `392baed9cbf0f572d551c4b3e0c4f5c40bcca054`
- Reproduction recipe: PHUX `scripts/build-vt-wasm.sh`, which pins and verifies
  the source archive and Zig toolchain.
- Engine license: MIT; the complete notice is retained in `LICENSE`.
- This TypeScript adapter mirrors the C ABI calls and tags in PHUX
  `clients/phux-vt-web/src/lib.rs` (Apache-2.0).

The engine imports only logging and secure entropy. It has no socket, shell,
PHUX protocol, DOM, canvas, or renderer. This adapter feeds bytes into the real
parser and reads its grid; `GhosttySurface` paints that grid onto a transparent
canvas. The display supports the same base-codepoint and resolved RGB scope as
the existing PHUX Rust grid adapter.

`getGhosttyEngine()` lazily fetches one shared engine per page. Its failed load
is not cached permanently. `instantiateGhostty()` accepts bytes for tests.
Every terminal must be disposed, including its render state, iterators and
scratch allocations. Keep iterator output slots separate: the C ABI reuses the
existing handle stored in each slot. Memory views are recreated after calls
that can grow WASM memory.

Local native `phux snapshot --json --format vt` returns server-formatted VT in
`rendered.data` (base64), with `rendered.format === "vt"`. That is a replayable
screen capture, not an original PTY byte stream. Public concepts instead feed
VT frames produced from their actual browser workload output. Neither path
requires exposing a public remote shell.
