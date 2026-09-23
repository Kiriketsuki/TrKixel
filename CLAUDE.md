# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start Vite dev server (http://localhost:5173)
npm run build        # Production build → dist/
npm run preview      # Preview production build
```

No test framework is configured. Testing is manual (browser-based).

## Architecture

TrKixel is a triangle-pixel art editor — a single-page Vue 3 app that renders and manipulates triangular grids on HTML Canvas.

### Core Pattern: Imperative Engine + Vue Shell

The app uses a **hybrid architecture**. Vue components handle the sidebar UI, but the canvas engine (`createTrKixel`) is a standalone imperative module that directly manipulates DOM elements via `id` selectors. Vue's `App.vue` mounts the engine into the root element and exposes it to sidebar components via `shallowRef`.

- `src/logic/createTrKixel.js` — **The engine.** A single factory function that returns an API object. It owns all canvas state: `gridData` (the pixel data), tool state, undo history, zoom/pan, background image, and event listeners. This is the largest and most critical file.
- `src/components/Sidebar.vue` — Orchestrates sidebar sections. Receives the engine instance as a prop and delegates to child components.
- `src/components/PaintControls.vue` — Color picker (OKLCH), palette management (import/export `.gpl`), and image fill uploads. Calls engine methods like `setColor()`, `registerImage()`.
- `src/components/OklchPicker.vue` — Full OKLCH color picker with three 2D gamut-mapped canvases (L×C, C×H, H×L). Renders pixel-by-pixel via `ImageData`.

### Engine Internals (`src/logic/autotrixel/`)

The engine logic is split into focused modules:

- **`geometry.js`** — Triangle math: `getTrianglePath()`, `pixelToGrid()` (hit-testing which triangle the cursor is over), `getTriangleCluster()` (brush size expansion), barycentric coordinate calculations for subdivision drilling.
- **`drawing.js`** — Canvas rendering: `fullRedraw()` (batched color drawing + complex items like subdivided triangles and image fills), `drawCursor()`, `drawGridLines()`.
- **`actions.js`** — Mutation operations: `batchPaintCells()`, `fillBucket()` (flood fill with adjacency for triangular grids), `interpolateStroke()` (continuous stroke interpolation).
- **`export.js`** — Export to PNG (via temp canvas + `toBlob`) and SVG (string building with recursive subdivision support).
- **`constants.js`** — `DEFAULT_CONFIG` and `REQUIRED_SELECTORS` (the engine validates all required DOM elements exist on init).
- **`utils.js`** — OKLCH ↔ RGB ↔ Hex color conversion (manual matrix math, not a library).

### Key Data Structures

- **`gridData`** — Plain object keyed by `"row,col"` strings. Values are either:
  - A CSS color string (`"oklch(60% 0.15 200)"` or `"#ff0000"`)
  - An object `{ type: "image", imageId: "..." }` for image fills
  - An object `{ subdivided: true, children: [child0, child1, child2, child3] }` for recursive subdivision (each child can itself be subdivided, a color string, or null)
- **Triangle orientation** — A triangle at `(r, c)` points up if `r % 2 === |c| % 2`, otherwise down. This parity rule is used everywhere.

### Subdivision System

Trixels can be subdivided into 4 sub-triangles (connecting edge midpoints). Subdivision is recursive — each sub-triangle can be further subdivided. The engine uses barycentric coordinates to determine which sub-triangle the cursor is in, drilling down recursively through `processSubdivision()` in `createTrKixel.js`.

## Color System

Colors use OKLCH throughout. The theme in `src/style.css` defines a Tailwind 4 `@theme` block with semantic color tokens (primary=blue, secondary=red, tertiary=purple) using OKLCH values with lightness variants (`-light`, `-dark`, `--1`, `-1` suffixes for ±0.05 L steps).

## Branching & Versioning

- **`main`** — Development branch. PRs from `feature/*` or `bug/*` branches.
- **`release`** — Production. Receives periodic PRs from `main`. Deploys to GitHub Pages on push.
- Branch naming: `feature/{name}` or `bug/{name}`.
- Version format: `YY.MM.minor.patch` (in `VERSION` file and `package.json`).
- Version bumps are automatic via CI when feature/bug branches merge to `main` (`version-bump.yml`).
- The `base` in `vite.config.js` is `/TrKixel/` for GitHub Pages deployment.

## Tools

Five drawing tools: `pencil`, `bucket` (flood fill), `eraser`, `picker` (eyedropper), `subdivide` (split trixel into 4 sub-triangles). Tool state is managed inside the engine; Vue buttons call `setTool(name)`.

## Engine-Vue Communication

The engine returns an API object from `createTrKixel()`. Vue components call these methods directly — there is no Vuex/Pinia store.

**Returned API:** `select`, `updateDimensions`, `resetCanvas`, `exportImage`, `exportSVG`, `destroy`, `registerImage`, `setCurrentImage`, `onBgChange`, `updateBackground`, `setControlMode`, `setColor(l, c, h)`, `onColorChange(cb)`, `setTool`, `undoAction`.

Note: The return object currently has duplicate keys (`setCurrentImage` x2, `onBgChange` x2) — the second silently overwrites the first. Not currently a bug since both are the same reference, but worth knowing.

## Gotchas

- **DOM id coupling**: The engine discovers UI elements via `REQUIRED_SELECTORS` in `constants.js` — a hardcoded list of `#id` strings. If any Vue component renames or removes an element's `id`, `createTrKixel()` will throw on init. Always check `REQUIRED_SELECTORS` when modifying template `id` attributes.
- **No state management library**: All canvas state lives inside the `createTrKixel` closure. There is no reactive store. Vue components only see what the engine explicitly exposes.
- **Undo is shallow**: History stores `JSON.stringify(gridData)` snapshots (max 10). Image fill references (`imageId`) survive undo but the actual `HTMLImageElement` lives in a separate `imageRegistry` Map that is not part of undo history.
