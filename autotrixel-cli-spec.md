# Feature: autotrixel-cli

## Overview

**User Story**: As an AI agent or power user, I want a CLI to create, manipulate, and export triangle-pixel art so that I can generate trixel art programmatically without a browser.

**Problem**: The AutoTrixel engine is locked inside a browser SPA. Every operation -- creating a canvas, painting cells, exporting images -- requires the GUI. There is no way to script, automate, or integrate trixel creation into agent workflows or asset pipelines.

**Out of Scope**:
- Native OS desktop app (separate spec under epic #32)
- Real-time preview / GUI within the CLI
- WebSocket or HTTP server mode
- Undo history in the CLI (canvas state files serve as checkpoints)

---

## Open Questions

| # | Question | Raised By | Resolved |
|:--|:---------|:----------|:---------|
| 1 | Should the CLI support reading canvas state from stdin for piping? | spec | [ ] |

---

## Scope

### Must-Have
- **Create canvas**: Initialize a new canvas with configurable rows, columns, and triangle size. Outputs a `.trixel.json` state file. Acceptance: running `autotrixel create --rows 10 --cols 10 -o canvas.trixel.json` produces a valid state file.
- **Paint cells**: Set one or more cells to a color by grid coordinate. Acceptance: `autotrixel paint -i canvas.trixel.json --cell 3,4 --color "oklch(60% 0.15 200)"` updates the cell in the state file.
- **Flood fill**: Fill a contiguous region from a seed cell. Acceptance: `autotrixel fill -i canvas.trixel.json --cell 3,4 --color "#ff0000"` fills all adjacent same-colored cells.
- **Export PNG**: Render the canvas to a PNG file using node-canvas. Acceptance: `autotrixel export -i canvas.trixel.json -o art.png --format png` produces a valid PNG matching the grid contents.
- **Export SVG**: Render the canvas to an SVG file. Acceptance: `autotrixel export -i canvas.trixel.json -o art.svg --format svg` produces a valid SVG with correct triangle geometry.
- **Load palette**: Import a `.gpl` palette file into the canvas state. Acceptance: `autotrixel palette -i canvas.trixel.json --import palette.gpl` stores the palette colors in the state file.
- **Batch run**: Execute a JSON array of operations in sequence. Acceptance: `autotrixel run instructions.json` applies each operation and writes the final state.

### Should-Have
- **Subdivide**: Split a trixel into 4 sub-triangles. `autotrixel subdivide -i canvas.trixel.json --cell 3,4`
- **Export palette**: Export the current palette to `.gpl` format.
- **Dry-run mode**: Validate a batch instruction file without executing.

### Nice-to-Have
- **Interactive REPL**: `autotrixel repl` for exploratory use.
- **Stdin pipe**: Read canvas state from stdin, write to stdout, enabling Unix pipe chains.
- **Grid overlay toggle**: Include/exclude grid lines in exports via `--grid` flag.

---

## Technical Plan

**Affected Components**:

| File | Status | Notes |
|:-----|:-------|:------|
| `src/logic/autotrixel/geometry.js` | Reuse as-is | Pure JS, no DOM. Triangle math, hit-testing, barycentric coords. |
| `src/logic/autotrixel/utils.js` | Reuse as-is | OKLCH/RGB/Hex color conversion. Pure math. |
| `src/logic/palette-utils.js` | Reuse as-is | GPL format parser/generator. Pure JS. |
| `src/logic/autotrixel/actions.js` | Extract | Paint, fill, stroke ops. Currently coupled to closure state -- needs parameter injection. |
| `src/logic/autotrixel/drawing.js` | Adapt | Canvas rendering. Needs canvas adapter interface (browser vs node-canvas). |
| `src/logic/autotrixel/export.js` | Adapt | PNG: swap `document.createElement("canvas")` for adapter. SVG: return string instead of triggering download. |
| `src/logic/createAutoTrixel.js` | Decompose | 1,167-line closure. Extract state management + operations into a headless `Engine` class/factory. Browser app rewires to use the same core. |

**New Files**:

```
src/core/
  engine.js              -- Headless engine: state (gridData, config, palette), operations (paint, fill, subdivide)
  canvas-adapter.js      -- Interface: createCanvas(w,h), getContext(), toBuffer()
  adapters/
    browser.js           -- Browser adapter (document.createElement, toBlob)
    node.js              -- node-canvas adapter (createCanvas from 'canvas' package)
  export.js              -- Headless export: renderPNG(engine, adapter) -> Buffer, renderSVG(engine) -> string

cli/
  index.js               -- Entry point, commander setup, subcommand registration
  commands/
    create.js            -- `autotrixel create`
    paint.js             -- `autotrixel paint`
    fill.js              -- `autotrixel fill`
    export.js            -- `autotrixel export`
    palette.js           -- `autotrixel palette`
    run.js               -- `autotrixel run` (JSON batch)
```

**Canvas State Format** (`.trixel.json`):

```json
{
  "version": 1,
  "config": {
    "rows": 10,
    "cols": 10,
    "triSize": 30
  },
  "gridData": {
    "3,4": "oklch(60% 0.15 200)",
    "5,6": { "type": "image", "imageId": "bg1" },
    "7,8": { "subdivided": true, "children": ["#ff0000", null, "#00ff00", null] }
  },
  "palette": ["#ff0000", "#00ff00", "#0000ff"]
}
```

**Dependencies**:
- `commander` -- CLI framework (subcommands, options, help)
- `canvas` -- node-canvas for headless PNG rendering

**package.json changes**:
- Add `"bin": { "autotrixel": "./cli/index.js" }`
- Add `commander` and `canvas` to dependencies

**Risks**:

| Risk | Likelihood | Mitigation |
|:-----|:-----------|:-----------|
| node-canvas native build deps fail in CI | Medium | Pin Cairo/Pango versions in CI. Document install prereqs. Fallback: SVG-only export if canvas unavailable. |
| OKLCH color rendering differs between browser and node-canvas | Low | Color conversion is manual (utils.js converts to sRGB before canvas ops). Same math, same output. |
| Engine extraction introduces regression in browser app | Medium | T7 explicitly wires browser app to same core. Run manual browser tests before merging. |
| Large grid performance with JSON serialization | Low | gridData is a flat object keyed by strings -- JSON.parse/stringify is fast up to millions of keys. |

---

## Acceptance Scenarios

```gherkin
Feature: autotrixel-cli
  As an AI agent
  I want a CLI for triangle-pixel art
  So that I can generate trixel art programmatically

  Rule: Canvas creation

    Scenario: Create a new canvas with default settings
      Given no existing canvas file
      When I run `autotrixel create --rows 10 --cols 10 -o canvas.trixel.json`
      Then a file `canvas.trixel.json` is created
      And it contains config with rows=10, cols=10
      And gridData is an empty object

    Scenario: Create fails when output path is not writable
      Given a read-only directory
      When I run `autotrixel create --rows 10 --cols 10 -o /readonly/canvas.trixel.json`
      Then the CLI exits with code 1
      And stderr contains an error message

  Rule: Cell painting

    Scenario: Paint a single cell
      Given a canvas file with an empty 10x10 grid
      When I run `autotrixel paint -i canvas.trixel.json --cell 3,4 --color "oklch(60% 0.15 200)"`
      Then gridData["3,4"] equals "oklch(60% 0.15 200)"

    Scenario: Paint multiple cells in one command
      Given a canvas file with an empty 10x10 grid
      When I run `autotrixel paint -i canvas.trixel.json --cell 3,4 --cell 5,6 --color "#ff0000"`
      Then gridData["3,4"] and gridData["5,6"] both equal "#ff0000"

    Scenario: Paint fails for out-of-bounds cell
      Given a canvas file with a 10x10 grid
      When I run `autotrixel paint -i canvas.trixel.json --cell 99,99 --color "#ff0000"`
      Then the CLI exits with code 1
      And stderr contains "out of bounds"

  Rule: Flood fill

    Scenario: Fill a contiguous region
      Given a canvas with cells 3,4 and 3,5 both colored "#ff0000"
      And cell 3,6 colored "#00ff00"
      When I run `autotrixel fill -i canvas.trixel.json --cell 3,4 --color "#0000ff"`
      Then cells 3,4 and 3,5 are "#0000ff"
      And cell 3,6 remains "#00ff00"

  Rule: Export

    Scenario: Export canvas as PNG
      Given a canvas file with painted cells
      When I run `autotrixel export -i canvas.trixel.json -o art.png --format png`
      Then a valid PNG file is written to `art.png`
      And the image dimensions match the canvas configuration

    Scenario: Export canvas as SVG
      Given a canvas file with painted cells
      When I run `autotrixel export -i canvas.trixel.json -o art.svg --format svg`
      Then a valid SVG file is written to `art.svg`
      And it contains polygon elements for each painted cell

    Scenario: Export fails for unknown format
      When I run `autotrixel export -i canvas.trixel.json -o art.bmp --format bmp`
      Then the CLI exits with code 1
      And stderr contains "unsupported format"

  Rule: Palette management

    Scenario: Import a GPL palette
      Given a canvas file and a valid `palette.gpl` file
      When I run `autotrixel palette -i canvas.trixel.json --import palette.gpl`
      Then the canvas state palette array contains the GPL colors

  Rule: Batch execution

    Scenario: Run a batch instruction file
      Given an instructions.json containing:
        | [{"op":"create","rows":5,"cols":5},{"op":"paint","cell":"2,3","color":"#ff0000"},{"op":"export","format":"png","output":"out.png"}] |
      When I run `autotrixel run instructions.json -o canvas.trixel.json`
      Then canvas.trixel.json contains a painted cell at 2,3
      And out.png exists as a valid PNG

    Scenario: Batch fails on invalid operation
      Given an instructions.json containing an unknown operation "dance"
      When I run `autotrixel run instructions.json`
      Then the CLI exits with code 1
      And stderr contains "unknown operation: dance"
```

---

## Task Breakdown

| ID   | Task | Priority | Dependencies | Status  |
|:-----|:-----|:---------|:-------------|:--------|
| T1   | Extract core engine: move gridData state, config, and pure operations (geometry, actions, utils, color) into `src/core/engine.js` | High | None | pending |
| T1.1 | Decouple `actions.js` from closure state -- accept engine state as parameter | High | T1 | pending |
| T1.2 | Decouple `drawing.js` -- accept canvas adapter instead of DOM canvas | High | T1 | pending |
| T2   | Create canvas adapter interface (`src/core/canvas-adapter.js`) and node-canvas adapter (`src/core/adapters/node.js`) | High | T1 | pending |
| T2.1 | Create browser adapter (`src/core/adapters/browser.js`) preserving current behaviour | High | T2 | pending |
| T3   | Headless export: `renderPNG(engine, adapter) -> Buffer`, `renderSVG(engine) -> string` in `src/core/export.js` | High | T2 | pending |
| T4   | CLI scaffold: `cli/index.js` with commander, `bin` field in package.json, `autotrixel --help` | Med | T1 | pending |
| T5   | Implement subcommands: create, paint, fill, export, palette | High | T3, T4 | pending |
| T5.1 | `create` command | High | T4 | pending |
| T5.2 | `paint` command | High | T4, T1.1 | pending |
| T5.3 | `fill` command | High | T4, T1.1 | pending |
| T5.4 | `export` command (PNG + SVG) | High | T3 | pending |
| T5.5 | `palette` command (.gpl import) | Med | T4 | pending |
| T6   | JSON batch `run` command | Med | T5 | pending |
| T7   | Wire browser `createAutoTrixel.js` to use `src/core/engine.js` -- verify no regression | High | T1, T2.1 | pending |

---

## Exit Criteria

- [ ] All Must-Have scenarios pass (manual CLI test or scripted)
- [ ] No regressions on browser app (manual test: paint, fill, export PNG/SVG, palette import)
- [ ] `autotrixel --help` shows all subcommands with descriptions
- [ ] `autotrixel run` successfully executes a multi-step instruction file
- [ ] Canvas state `.trixel.json` round-trips correctly (create -> paint -> export -> re-import)
- [ ] node-canvas produces visually correct PNG output matching browser export

---

## References

- Epic: [#32 Native OS App & Agent CLI](https://github.com/Kiriketsuki/AutoTrixel/issues/32)
- PR: [#33 epic: Native OS App & Agent CLI](https://github.com/Kiriketsuki/AutoTrixel/pull/33)
- Engine source: `src/logic/createAutoTrixel.js`
- Geometry module: `src/logic/autotrixel/geometry.js`
- Export module: `src/logic/autotrixel/export.js`
- GPL palette utils: `src/logic/palette-utils.js`

---
*Authored by: Clault KiperS 4.6*
