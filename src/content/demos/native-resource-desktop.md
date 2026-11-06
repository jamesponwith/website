---
title: "A browser page in native Desktop panes"
summary: "Real Chrome pixels and its accessibility tree, rendered as read-only resources in the native GPUI app—not an HTML viewer or terminal graphics."
publishedAt: "2026-11-05"
duration: 14.37
video: "/demos/native-resource-desktop/video.mp4"
poster: "/demos/native-resource-desktop/poster.webp"
captions: "/demos/native-resource-desktop/captions.vtt"
version: "Development preview"
---

This is the **native Phux Desktop app**, built from the
[resource-host development branch](https://github.com/no-phux/phux/tree/feat/finish-resource-host).
It is a development preview, not a promise that the current download contains
these changes.

The source is a real, isolated Chrome page. A producer reads its pixels and
accessibility tree over Chrome DevTools Protocol and publishes two resources to
an isolated phux server. Desktop renders the PNG natively and the JSON as inert
text. The recording captures the actual GPUI window, including its sidebar and
read-only labels. It is not the browser-based phux client.

## What to watch

- **0:00 — Pixels.** A browser page appears in a native pixel-surface pane.
  The source's update counter changes as new PNG documents arrive.
- **0:07 — Structured text.** The same page's accessibility tree appears in a
  native JSON inspector. No terminal grid or image escape sequences are involved.

The two native-window captures are joined at the cut; timing within each
capture is preserved. The source page is a purpose-built fixture, not a
simulation of the native app.

## What this does—and does not—do

These are **read-only mirrors**. Clicking or typing in a document does not drive
Chrome. Moving a view between windows does not move the browser process to
another host. Closing a document view leaves its producer and other viewers
running.

The implementation also covers mixed and document-only sessions, reconnect,
restore, and destination-accepted window transfer. Those journeys have separate
isolated-server tests; this clip demonstrates rendering, not a transfer.

See the [Rune recording](/demos/native-resource-rune) for the same live source
rendered by the other native client.
