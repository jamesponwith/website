---
title: "Live resources in the native Rune app"
summary: "Open a real browser's pixel surface, watch its live counter, then switch to its accessibility tree—all in Rune's native GPU interface."
publishedAt: "2026-11-05"
duration: 9.2
video: "/demos/native-resource-rune/video.mp4"
poster: "/demos/native-resource-rune/poster.webp"
captions: "/demos/native-resource-rune/captions.vtt"
version: "Development preview"
---

This is the **native Rune client**, built from the
[resource-host development branch](https://github.com/no-phux/phux/tree/feat/finish-resource-host).
It is a development preview, not an embedded web view and not the browser-based
phux client. The current release download may not include these changes.

A real Chrome page publishes pixels and an accessibility tree through a
dedicated producer connected to an isolated phux server. Rune's own recording
mode captures its actual GPU-rendered interface. The visible page is a small
fixture with a changing counter, so updates can be seen without exposing a
person's browser profile or private work.

## What to watch

- **0:00 — Pixel surface.** A native, letterboxed PNG pane shows the page.
  Watch the counter and progress bar change as the source keeps running.
- **0:05 — Choose another resource.** The native command palette finds the
  page's accessibility tree.
- **0:07 — JSON.** The native read-only inspector displays the actual Chrome
  accessibility document.

No native interface was reconstructed in HTML. The clip trims startup and keeps
the recorded sequence; its poster is another frame from the same live setup.

## Boundaries

Document panes are **read-only**. They do not send terminal typing, paste,
uploads or grid resizing to the source. Source processes stay on their original
host; reopening or moving a view is not process migration or browser control.

Native source-startup actions use a dedicated supervised producer with explicit
argv, never commands typed into a person's focused shell. Browser mirroring
requires an existing Chrome DevTools endpoint.

Compare the [GPUI Desktop recording](/demos/native-resource-desktop), using the
same resource kinds and producer path.
