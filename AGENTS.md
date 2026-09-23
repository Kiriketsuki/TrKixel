# AGENTS.md

## Overview

TrKixel is a triangle-pixel art editor built as a Vue single-page app with an imperative HTML Canvas engine.

## Stack

- Vue 3 + Vite
- HTML Canvas
- Imperative engine pattern

## Commands

```bash
npm install
npm run dev
npm run build
npm run preview
```

No test framework is configured. Testing is manual in the browser.

## Architecture

This app uses a hybrid architecture: Vue provides the shell UI, while the canvas engine owns drawing state and behavior.

Important files:

- `src/logic/createTrKixel.js`: main imperative engine
- `src/components/Sidebar.vue`: sidebar composition
- `src/components/PaintControls.vue`: palette and paint controls
- `src/components/OklchPicker.vue`: OKLCH picker
- `src/logic/autotrixel/geometry.js`: triangle math and hit testing
- `src/logic/autotrixel/drawing.js`: rendering
- `src/logic/autotrixel/actions.js`: painting and fill actions
- `src/logic/autotrixel/export.js`: PNG and SVG export

Key model details:

- `gridData` is keyed by `"row,col"`
- Cell values may be colors, image fills, or recursive subdivision nodes
- Triangle orientation is parity-based and must stay consistent everywhere

## Active Work

Current focus areas are the canvas engine, tool behavior, subdivision handling, and Vue-to-engine integration.

## Gotchas

- The engine depends on hardcoded DOM ids from `REQUIRED_SELECTORS`
- All major canvas state lives inside the `createTrKixel` closure
- Undo uses shallow serialized snapshots of `gridData`
- The returned engine API currently contains duplicate keys that overwrite earlier entries
