# phux-edge generated server

Generated from this website checkout's `edge/` source with
`scripts/build-edge.sh`. The worker runs the real PHUX codec/multiplexer,
backed by a curated interpreter; it does not run native OS processes.

Toolchain: Rust 1.99.0, wasm-pack 0.15.0, wasm-bindgen 0.2.129,
Binaryen 132. Protocol dependency remains pinned by `edge/Cargo.toml` and
`edge/Cargo.lock`.

Current local iteration adds opt-in shell presentation:

- `demo glass` (alias `demo workspace`): clear screen, compact workspace,
  minimal icy `› ` prompt.
- `theme glass`: clear screen and switch to the minimal prompt quietly.
- `theme default`: clear screen and restore the existing demo prompt.

The theme is stored in each terminal's checkpoint. Legacy checkpoints default
to the original theme; default-theme serialization remains unchanged. Existing
commands and explicit color demos remain available. Other embeds are unchanged
until they issue an opt-in command.

Source `edge/src/shell.rs` SHA-256: `5fe89028e420e921c3c7d1e53381861cd96144ae2bea67d885a91baa0ae49641`.
Source `edge/src/lib.rs` SHA-256: `0be5e87e745f2dbbf0a0355b3a20133f64cc7ec97b4c25a1c4d073507322b814`.
No commit was created for this iteration.

| Generated file | Bytes | SHA-256 |
| --- | ---: | --- |
| `phux_edge.js` | 10764 | `245a4acf0d82b61014dba948dd576594cfe019ad6f02e3e160da3ea436ae76f5` |
| `phux_edge_bg.wasm` | 425580 | `45422d328385b7325619c4a2c99282a07cafdd228c4a994404032e2327c68b30` |
| `phux_edge.d.ts` | 2591 | `9afba36079a991cfcdf9748831c7609e1ac25f00e2429ad0bb71a2e77f5379b5` |

Validation: all 24 edge Rust tests pass, including five new opt-in theme,
checkpoint/backward compatibility, command-preservation and refusal scenarios.
Clippy with warnings denied and formatting pass. The staged WASM itself was
instantiated and driven with actual PHUX HELLO/ATTACH and typed `demo glass`
frames: workspace text, arrow prompt, absence of the color bar and restored
checkpoint theme were verified through the real encoded server output.

New split terminals inherit only the exact parent's opt-in presentation before
the initial greeting. Pending user input is never cloned or modified; there is
no input-command injection. Default parents and ownerless spawns retain the
original presentation. A wire-dispatch regression checks inheritance, default
sibling isolation, pending input preservation and checkpoint restore.

The final compact workspace uses four lines of at most 24 visible columns.
Its rebuilt server output was fed through actual libghostty-vt WASM at 24
columns: the four expected rows and arrow prompt were verified without wrap.
