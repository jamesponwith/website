---
audience: contributors
stability: stable
last-reviewed: 2026-10-21
---
# phux site design system

**TL;DR.** The landing pairs a quiet product tour with an on-demand shell.
Documentation is a calm single reading column on quiet paper: one left sidebar
whose active page unfolds into its own scroll-spied outline, no right rail, no
breadcrumbs. System sans and monospace, one warm accent, Light/Dark/System.
Fumadocs supplies the page tree, search index and dialog, and the heading
observer; the reader chrome around them is ours.

## Two surfaces, shared identity

The marketing shell uses `SITE.designMode` (`terminal`) from `src/lib/site.ts`.
The documentation shell uses `data-design="reader"`. Every reader rule lives in
`src/styles/reader/*.css` (imported in order by `src/styles/reader.css`),
scoped to `html[data-design="reader"]`, so it cannot change the marketing or
live-terminal palette. Keep reader rules there rather than appending a second
theme override to `global.css`.

- Reader prose and navigation use `-apple-system, BlinkMacSystemFont, "Inter",
  "Helvetica Neue", sans-serif`. Code uses `ui-monospace, "SFMono-Regular",
  "SF Mono", Menlo, Consolas, monospace`. Inter is a local fallback, not a download.
- Reader `--font-sans` and `--font-mono` aliases include portalled search UI.
  The shared head no longer fetches IBM fonts. Paper Mono remains outside the reader.
- The wordmark is lowercase `phux`; navigation uses sentence case.
- The favicon and mark-only surfaces use `docs/assets/fox-mark.*`.
- Information hierarchy comes from type size, weight, spacing, and position.
  Color reinforces it; color never carries state alone.

## Reader tokens and typography

The reader is neutral paper and ink with one warm accent: off-white paper in
light mode, near-black in dark, and white (or a lifted graphite) panels for code
and tables. Tokens map to Fumadocs' `--color-fd-*` palette, including the
portalled search dialog. Head theme colors match the two paper colors.

| Token (`--color-`) | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#f5f5f3` | `#121311` | paper |
| `fg` | `#121310` | `#ebebe7` | ink: body, titles, active position |
| `nav` | `#2c2d29` | `#cfd0ca` | sidebar links |
| `muted` (also `dim`) | `#44453f` | `#b0b1aa` | lead, table cells, secondary text |
| `subtle` | `#575852` | `#92938c` | group labels, outline, meta, icons |
| `faint` | `#c9c9c5` | `#3b3c38` | outline branch lines (non-text) |
| `rule` | ink at 12% | ink at 13% | panel borders, header rules |
| `rule-faint` | ink at 7% | ink at 7% | table row separators |
| `wash` | ink at 5% | ink at 7% | inline code, hover |
| `surface` | `#ffffff` | `#1a1b19` | code, tables, `kbd`, search dialog |
| `accent` | `#7d5f38` | `#d2b98f` | link underlines, focus, current section tick |

Every text token meets WCAG AA (4.5:1) on paper and on `surface` in both themes.
The native Theme selector (sidebar foot) supports System, Light, and Dark; System
is the default. next-themes owns persistence and system updates. A head script
applies the saved preference before paint and Astro document swaps.

- Body is 15px with 1.6 line height in a 38rem column (`--reading-width`).
- The title is 28px, weight 500, -0.022em. H2 is 18px/500; H3 is 15px/600.
  There is no oversized lead: the summary is a normal paragraph in `muted`.
- Utilities stay at least 13px. Commands are 13px but remain zoomable and
  horizontally scrollable. Do not shrink text to make long commands fit.
- Panels (code, tables, overview cards) share one recipe: `surface` fill, 1px
  `rule` border, 10px radius, a hairline shadow in light mode.

## Landing and live shell

The homepage opens with a two-column hero: headline, description and download
on the left; an alert, lean silver fox on the right. The fox is a site illustration
(`src/components/fox/Fox.astro`), not a modification of the pinned identity kit.
Long legs, a tucked waist, tapered tail, clean cheek planes and satin highlights
replace rounded toy-like anatomy. The only ambient art token is `--fox-halo`
(`#bacab309`); the illustration's silver/graphite material stops are local SVG paint.
Keep the silhouette still: only the eyes and a sub-two-degree head response follow
the pointer. Gaze is bounded, clipped inside the eyes and time-damped; it returns
to center on pointer exit. Reduced motion, hidden tabs and offscreen art settle
to a static pose. No WebGL, animation loop at rest or extra framework is needed.
On phones the fox sits below the download, above the real product comparison.

The headline is the joke: **Oh good, another terminal multiplexer for agents.**
One paragraph (`HOME.lede`) owns up to it ("This one gives a phux") and then
says what phux does. There is no eyebrow and no second slogan; the joke is told
once and everything below it is plain. `HOME` in `src/lib/site.ts` owns the headline, lede and
metadata; `SITE.tagline` retains the precise technical category for
documentation. The share card uses the same headline and real captures. Keep the
download and the beginning of the product screenshot within the first screen.

The landing sets its text in Inter (`public/fonts/InterVariable.woff2`, declared
as `Phux Inter` so the reader's local-only `Inter` fallback stays local; the
latin variable subset, preloaded on the landing only) so the page reads the
same on every platform. Headings are weight 550 to 600 with -.03em to -.04em
tracking; do not tighten further, letters collide. Body copy on the landing is
16px in `--color-muted`. Paper Mono stays for commands and output.

`Exhibits.astro` shows what phux does as four rows: a short statement and two
or three plain sentences on the left, and on the right what phux prints. The
transcripts are captured from a real server and typeset in one panel recipe
(`#101316`, 1px rule, 12px radius, Paper Mono 13.5px). Prompts are dim green,
output is dim, and at most one line per panel takes the amber attention color:
the line the row is about. No window chrome, traffic lights, typing animation
or invented activity. The fourth row is Crew, with its requirements visible
next to its setup link. Do not add a competitor pitch or feature matrix. Never
use “keep your editor” or editor adoption as the homepage proposition. This
content is plain HTML, with no new hydration, animation, or initial requests.
The fox, install behavior, and lazy demo stay intact.

The primary install action follows the visitor's OS, not viewport width.
macOS keeps the Mac download; Linux opens the CLI installer; Windows leads to
installation instructions with the required WSL 2 coordinator noted. Desktop
0.50.0+ publishes a native Windows client; do not rewrite that as unavailable.
iPhone/iPad use the existing TestFlight handoff; Android opens its access options
without forcing the keyboard. Email remains an explicit, viewport-safe alternative.
The closing action follows the same selection and hides the desktop shell command
on Windows and on phone browsers.
Static/no-JavaScript HTML uses a real installation-guide link rather than guessing
a Mac download; detection is client-side only, with no stored device profile or
device-dependent edge cache.

The landing carries a short top bar: mark and typeset wordmark, Docs, and a recognizable
GitHub source badge (local SVG, no third-party badge request or invented star count).
The headline, install action and fox lead a draggable TUI/GUI
comparison. The comparison begins in the first screen at mobile and desktop
widths. It shows real product captures, not a live connection; both sides show
the same workspace.
Use a native range input for pointer, touch and keyboard, plus full-client shortcuts.
Without JavaScript, show both previews and hide the inert controls.

The install targets, command, and copy action float as type on the canvas — no
card, panel, or fill behind them, and hover changes color rather than background. The targets are CLI, Desktop, and Mobile. Desktop swaps the
command line for the Mac download; Mobile shows native access and optional email, so
the landing carries no separate beta band. The quiet footer keeps Demos, More,
Privacy, and Support instead of repeating the top bar. The landing canvas is
`#0b0b0d`, with `#ededee` text and neutral accents.

The glass live workspace stays inline below the fold, with a visible anchor from
the hero and a separate full-shell link. Its iframe does not exist until the section
intersects the viewport. Leaving view or hiding the tab removes it after a short
grace period, releasing its GPU, browser worker and disposable connection; returning
starts a fresh demo. Say so next to the workspace. Legacy `?hero=light` links scroll
to this section rather than replacing the homepage. No terminal/GPU/WASM JavaScript
or demo-origin preconnect belongs in the initial viewport's resource budget.

The workspace is one glass window holding the real phux client, used where it
sits. A visitor clicks a pane and types; a split divides the same window. There
is no dialog, no preview and no copy of the canvas: the multiplexer's own layout
is the layout. The phux client paints text on a transparent canvas and publishes
each pane's cell rectangle; the page draws the hairline dividers and the focused
pane's tile under it from that geometry, and never guesses one.

The window is dark tinted glass over the WebGPU light (`backdrop-filter` blur, a
1px hairline, a lit top edge, a 16px radius), and the terminal area adds a
darker wash so text stays readable at its native size. Glyphs are never scaled:
the grid is fitted in whole cells. The terminal area has one fixed height per
breakpoint (408px, 296px at 700px and below) in every phase, so connecting does
not move the page. The title bar carries the pane controls (split right, split
down, close); the footer offers three commands to run and the full-shell link;
install controls are the tray at the bottom of the same window. An untouched
demo runs its intro and makes one split when there is room for two readable
panes; the first pointer or key press ends all automation.

Below the workspace, the illustrated tour shows a server, clients, and signals
travelling along connections.
It autoplays only while on screen, with pause and chapter controls; reduced motion
shows settled chapters. Faint background hosts are decorative, hidden from
assistive technology, and do not claim live status. The scene's live-demo invitation is always visible as a bottom chip, for mouse,
keyboard, and touch alike. Hover and focus emphasize that invitation without
covering or blurring the product. Chapter headings and client emphasis follow
the story; output enters briefly rather than flashing. Opening the live shell
suspends the illustration, and closing it resumes the same position. `/more` retains its opt-in, pausable,
scrubbable explainer.

The live shell's dialog offers one more thing: **Pair your phone**, a single line
that expands into a QR (a white tile, the only light surface in the dialog) with
the status beneath it. The phone opens `/phone#CODE` — a page that is a terminal
and almost nothing else — and lands in the same shell, thumb key bar included, in
about a second. The link is single-use and expires with the session; the pairing
code never appears in a URL the site's own logs would keep. While a phone is
attached the shared shell follows the newest screen's size, which is the tmux
rule and the honest reading of "one shell, two screens"; the pairing line says
"Phone linked" so the beat is visible on the big screen.

The hosted `/embed` shell and live dialog share ice-blue neutral glass tokens,
a single rounded frame, a subtle edge and inset highlight, and an opaque readable
terminal canvas. The standalone shell gets a quiet radial backdrop, GitHub badge,
and a direct way home; embedded clients hide that page chrome. The dialog adds a
blurred backdrop, not stacked outer frames. The terminal canvas is inset within it; pane controls sit below the
canvas, using icons with accessible names and a labelled primary Split pane action.
The Info disclosure opens an inspector for runtime, network/file limits, shortcuts,
and session controls, plus identity, startup timing, and focused terminal when
available. Runtime and connection status remain in the header. OAuth returns wake
the visibility-hydrated tour dialog; moving the demo down-page must not strand sign-in.
Terminal interiors use local neutral tokens;
program output and reader themes are not recolored.

## Article structure

An article is a title, one useful full summary, and the author's content — in a
single 38rem column. No breadcrumb, no section eyebrow, no right-hand rail. Do not
repeat the source TL;DR in the body, hide the summary behind a disclosure, or
inject another section primer ahead of the author's content.

Page actions are a quiet icon row at the right of the title line: copy the page
as Markdown, view the `.md` twin, and view the exact source on GitHub (pinned to
the synchronized revision). Each icon has an accessible name and a tooltip; copy
outcomes are announced in a polite live region. The links work without
JavaScript.

The article ends with quiet previous/next links from the page tree, then a meta
line (non-stable status, wire version on protocol pages, Privacy, Support).
Heading IDs and deep links must survive presentation changes.

Prose links are ink with an accent underline; headings remain ordinary text with
discoverable anchor links. Headings have generous separation without a rule
above every section. Callouts are bold lead-ins or a plain quoted aside, not
coloured boxes; reserve them for warnings or meaningful constraints.

## Static technical content

Fenced code stays in the original Shiki-highlighted HTML. No second React root,
shadow DOM, line-selection model, or client-side syntax renderer replaces it.
A lightweight enhancement adds a small copy icon inside the panel's top-right
corner (accessible name "Copy code") and a polite status; clipboard failure
shows how to copy manually. Code remains selectable, searchable with browser
Find, and keyboard-scrollable. Without JavaScript, the static code remains
readable and selectable.

Inline code is a small tinted pill. Keys are raw `<kbd>` in the Markdown
(`<kbd>C-a</kbd> <kbd>d</kbd>`) and render as small raised keycaps in prose,
lists, and tables alike.

Tables are light and compact: muted header text over one rule, faint row
separators, no zebra fill, on the shared panel. They retain native table
semantics inside a labelled, focusable scrolling region. Code and table overflow
stays local to its panel rather than widening the page. Never wrap byte
diagrams or clip commands to fit a viewport.

## Navigation and overview

`/overview` is the primary docs home. Its first-run steps, model figure, and
guide cards connect the reader's goal to a working path. `/docs` remains the
addressable complete index and leads the first group after the overview.

The sidebar is the only navigation: the fox mark and wordmark, a pill search
button with its shortcut, then one flat list. `scripts/docs-output.ts` derives
it from the catalog (`scripts/docs-catalog.ts`): a quiet, always-open label per
`GROUPS` entry in `GROUPS` order, then that group's pages by `order`. Top-level
folders such as `reference/` are extracted in place, so every page keeps its
URL. Do not hand-maintain a second page list.

The active page expands to show its outline: H2s, plus H3s while the outline
stays at 24 entries or fewer, on thin branch lines. The section in view is inked
and its branch tick takes the accent; the outline keeps it scrolled into view.
The sidebar foot holds the Theme selector and `llms.txt`, GitHub, and site links.

Search is a minimal dialog: a 22px field, an `esc` hint, and grouped results from
the static advanced index. ⌘K / Ctrl-K and `/` (when not typing) open it.
Exact, prefix, and word-prefix title matches move whole page groups forward,
leaving each heading/text hit with its parent. Failed index loading gets an
announced error, a genuine retry, and an all-documentation escape path; an error
must not masquerade as zero matches.

## Agent surfaces

Every page has a Markdown twin at its URL plus `.md` (also served for
`Accept: text/markdown`), advertised with `<link rel="alternate"
type="text/markdown">`. `/llms-full.txt` concatenates every page's Markdown in
sidebar order, each headed by its URL and exact source; `/llms.txt` is the
curated index and links to it. Each page has its own 1200×630 social card at
`/og/<slug>.png`, drawn with sharp in the reader's paper and ink.

## Responsive and interaction rules

- Above 860px the sidebar is a sticky column. At 860px and below it becomes a
  drawer behind a sticky top bar (menu, wordmark, search).
- The drawer is a native modal dialog holding the same tree and outline. Escape
  or a backdrop click closes it, focus starts on Close, Tab stays inside, and
  closing returns focus to the opening control. Opening search, or following a
  link, closes the drawer.
- Mobile navigation targets are at least 44px tall. Icon controls have accessible
  names; decorative icons and arrows do not enter the accessible name.
- No horizontal page scroll at 320px or wider; only code and table panels scroll.
- Keep visible two-pixel focus outlines and a working skip-to-documentation link.
- Reduced-motion preference disables reader animation and smooth scrolling.
- Do not persist the entire document body between Astro routes: article, active
  navigation, outline, copy controls, and metadata must update together.

Before landing UI changes, inspect overview, an article, and code/table-heavy
reference pages at 320px, tablet, and desktop widths in both themes. Exercise
Escape, Tab, skip navigation, copy success/failure, theme persistence, search
failure/retry, deep links, and route/back navigation on the built site.
`bun run verify:docs` automates the copy, discovery, ordering, outline, search
key, and drawer checks.
