# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Vite + React + TypeScript, shipped as a Firefox WebExtension (Manifest V3). Confirmed by the user during the init interview: the project had no scaffold, and the state-heavy new-tab surface (drag-and-snap layout, multi-page boards, widgets, keyboard command layer) justifies a component framework over hand-written DOM.

## Users

People who open Firefox new tabs dozens of times a day on a desktop machine — developers, students, researchers, knowledge workers. The moment of use is a few seconds long: the tab is a launchpad, not a destination. Their attention is fragmented, their hands are already on the keyboard, and they have a stable, personal set of places they return to.

A secondary, explicitly requested use: the same person opening the board as a standalone page from a toolbar button, on a large desktop display.

## Product Purpose

Turn the new tab from an empty advertising surface into a private, self-arranged control room. It must make two things fast — starting a destination you already know, and getting a glance-level read on your own time, bookmarks, and history — without the user ever leaving the keyboard.

Success means the user stops treating the new tab as something to close. It loads instantly, reflects their own organization rather than a template's, and the layout survives every restart.

## Positioning

A freely arranged desktop, not a templated dashboard.

Neighbouring products let you pick a preset grid and fill slots in it, or they make the wallpaper the product and the utility a footnote. Here the layout itself is the artifact: tiles and circle icons coexist on one canvas at user-chosen size and position, the grid only appears while you are dragging, and quick-launch icons, search, and live widgets are all the same kind of citizen — every one of them draggable, every one of them reachable by `Alt`+number. Nothing about the arrangement is chosen from a menu.

## Operating Context

- Desktop Firefox, Manifest V3, `chrome_url_overrides.newtab` for the primary surface plus a toolbar action opening the same board as an ordinary page.
- Loaded unpacked via `about:debugging` during development; packaged as an `.xpi` for distribution.
- Bookmarks and history read from the browser's own `browser.bookmarks` and `browser.history` APIs — the user's real data, no separate account, no server.
- Layout, settings, and uploaded wallpapers persist in `browser.storage.local` (wallpaper images are far past `storage.sync` quotas, so nothing is synced).
- Interface copy is bilingual (Chinese and English) with a settings switch; all strings live in one dictionary, never inline in components.

## Capabilities and Constraints

Confirmed requirements, in the user's own terms:

1. Custom wallpaper. Preset wallpapers ship with the extension, and the user can add their own by uploading a local image **or** pasting an image URL.
2. Quick-launch icons in two families, freely placeable:
   - **Tile** style at `1×1`, `1×2`, `2×1`, `2×2`, with a user-adjustable corner radius.
   - **Circle** style, a plain round icon.
3. Widgets including bookmarks, browsing history, and a clock. **No weather.** Clicking a widget opens a fuller view.
4. A search box whose engine can be switched quickly, without leaving the page.
5. Keyboard commands: `Alt`+digit launches the matching icon or widget; `Ctrl`+digit multi-selects; holding `Alt`+`Ctrl` together plays a motion on every icon/widget that surfaces its own number.
6. Paging — the board has multiple pages the user can flip between.
7. Bookmarks and history must also exist as standalone full pages. Those pages carry no search box and no quick-launch area, and they are reachable both directly and by clicking the corresponding widget.

Confirmed decisions from the init interview:

- Icon artwork is fetched automatically from a third-party site-icon service, with a setting to turn that off; when off, only locally stored or uploaded icons are used.
- The extension takes over the new tab page and also exposes a standalone entry point.

Constraints and deliberately open facts:

- Manifest V3 only; no MV2 fallback. Firefox-only for now.
- Firefox has no `favicon` API comparable to Chrome's `_favicon/`, so automatic icons come from an external service, which is why the off switch exists.
- Storage is local-only. No accounts, no sync, no telemetry.
- Free/open wallpaper sources only; no wallpaper may be shipped with a license the project cannot state.

## Brand Commitments

- Working project name: **Tabula** (from the repository directory; inferred, not yet confirmed by the user).
- No voice, logo, palette, or identity constraint has been stated. None may be invented as a commitment.

## Evidence on Hand

None. The repository was an empty directory when work began: no existing code, copy, assets, screenshots, testimonials, or analytics.

Consequences future work must respect: no user counts, no performance benchmarks, no "trusted by" claims, and no wallpaper may be presented as licensed material the project does not actually have.

## Product Principles

1. **The keyboard is a first-class input.** Every gesture that has a mouse path must have a key path, and the key path must be the fast one — not a fallback.
2. **Arrange, don't configure.** The user shapes the board by moving things, not by filling in a preferences form. Settings exist for what cannot be dragged.
3. **Chrome appears only when needed.** The grid, the number badges, the handles: present during an edit gesture, gone during use.
4. **The user's data is the content.** Bookmarks, history, and time come from the browser and the clock, never from a fabricated or placeholder feed.
5. **Local by default, disclosed when not.** Nothing leaves the machine unless the user turned it on, and the surface where it happens says so.

## Accessibility & Inclusion

Derived from the stated keyboard requirements and must not be dropped during visual polish: the board is fully operable without a pointer, `Alt`+number targets are announced in a stable order, focus is always visible, and motion respects `prefers-reduced-motion` — including the `Alt`+`Ctrl` number reveal.
