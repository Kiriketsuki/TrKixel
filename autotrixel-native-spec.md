# Feature: autotrixel-native

## Overview

**User Story**: As a trixel artist, I want a native desktop application so that I can create and edit triangle-pixel art with full OS integration, offline access, and a native file workflow.

**Problem**: AutoTrixel runs only as a browser SPA. Users cannot open/save files via native dialogs, associate `.trixel.json` with the app, use native keyboard shortcuts, or run the editor offline without a dev server. There is no installable binary to distribute.

**Out of Scope**:
- CLI / headless engine (separate spec: `autotrixel-cli-spec.md`)
- Mobile builds (Tauri v2 supports mobile, but not in this iteration)
- Plugin / extension system
- Cloud sync or collaborative editing

---

## Open Questions

| # | Question | Raised By | Resolved |
|:--|:---------|:----------|:---------|
| 1 | Should image fills (HTMLImageElement refs) be serialized as data URLs in `.trixel.json` for full state portability? | spec | [ ] |

---

## Scope

### Must-Have
- **Native window with editor**: Launch a standalone native window rendering the full trixel editor. Acceptance: app launches, canvas is interactive, all drawing tools work.
- **File > New**: Reset to a fresh empty canvas. Acceptance: Ctrl+N clears the canvas, title becomes "AutoTrixel - Untitled".
- **File > Open**: Native file dialog filtered to `.trixel.json`. Loads grid state into the engine. Acceptance: selecting a valid file renders the saved canvas; title shows filename.
- **File > Save / Save As**: Write current state to disk via native dialog. Acceptance: Ctrl+S writes to current path (or prompts Save As if untitled); Ctrl+Shift+S always prompts.
- **Export PNG via native dialog**: Native save dialog filtered to `.png`, writes a valid PNG. Acceptance: exported PNG matches canvas contents and dimensions.
- **Export SVG via native dialog**: Native save dialog filtered to `.svg`, writes a valid SVG. Acceptance: SVG contains correct polygon geometry for all painted cells.
- **Drag-and-drop**: Drop a `.trixel.json` file onto the window to open it. Acceptance: file loads and title updates.
- **Native menu bar**: File (New, Open, Save, Save As, Export PNG, Export SVG, Recent Files, Quit), Edit (Undo, Redo), View (Zoom In, Zoom Out, Reset Zoom), Help (About). Acceptance: all menu items trigger the correct action.
- **Keyboard shortcuts**: Ctrl/Cmd+N, O, S, Shift+S, Z, Shift+Z, +, -, Q mapped to menu items. Acceptance: shortcuts work identically to menu actions.
- **Window title + dirty indicator**: Title shows "AutoTrixel - filename.trixel.json" (or "Untitled"). Asterisk (*) appears when unsaved changes exist. Acceptance: title updates on open/save; asterisk appears on edit, disappears on save.
- **Unsaved changes guard**: Closing the window with unsaved edits shows a native confirm dialog (Save / Don't Save / Cancel). Acceptance: Cancel aborts close; Don't Save closes without saving; Save writes then closes.
- **Standalone offline binary**: Runs without browser or internet. Cross-platform: Windows, macOS, Linux. Acceptance: app launches and is fully functional with no network.

### Should-Have
- **File association**: `.trixel.json` files open in AutoTrixel on double-click (OS-level registration). Acceptance: double-clicking a `.trixel.json` in the file manager launches the app with that file loaded.
- **Recent files**: Last 10 opened files shown in File > Recent Files submenu. Acceptance: list persists across app restarts; selecting an entry opens the file.
- **Auto-save / crash recovery**: Periodic auto-save to app data directory. On launch, detect recovery file and offer to restore. Acceptance: after a simulated crash, relaunch offers recovery of the last auto-saved state.

### Nice-to-Have
- **Multi-window**: Open multiple canvases in separate windows.
- **Auto-updater**: Check for updates on launch via Tauri updater plugin + GitHub Releases. Notify user if an update is available.
- **System tray**: Minimize to system tray.

---

## Technical Plan

**Framework**: Tauri v2
- Rust backend for native APIs (file dialogs, menus, tray, updater)
- System webview (WebView2 on Windows, WebKit on macOS, WebKitGTK on Linux)
- Vite plugin (`@tauri-apps/vite-plugin`) for dev/build integration
- Tiny binaries (~5-10MB vs ~100MB+ for Electron)

**Affected Components**:

| File | Status | Notes |
|:-----|:-------|:------|
| `src/logic/createAutoTrixel.js` | Extend | Add 4 new API methods: `getState()`, `loadState()`, `exportImageAsBlob()`, `exportSVGAsString()` |
| `src/logic/autotrixel/export.js` | Extend | Add data-return variants alongside existing download-trigger functions |
| `src/components/App.vue` | Extend | Detect Tauri environment, register menu event listeners, wire file ops |
| `package.json` | Extend | Add Tauri deps (`@tauri-apps/cli`, `@tauri-apps/api`, `@tauri-apps/plugin-*`) |
| `vite.config.js` | Extend | Add Tauri Vite plugin, conditional `base` for native vs web |

**New Files**:

```
src-tauri/
  src/
    main.rs              -- App entry, window config, menu setup
    lib.rs               -- Tauri command registrations
  tauri.conf.json        -- App identifier, window size, permissions, file associations
  Cargo.toml             -- Rust dependencies
  icons/                 -- App icons (all required sizes)

src/tauri/
  file-ops.js            -- Open, save, save-as via @tauri-apps/api
  export-ops.js          -- Export PNG/SVG via native dialog
  menu-handler.js        -- Listen for Tauri menu events, dispatch to engine
  state.js               -- Current file path, dirty tracking, recent files
```

**Engine API Additions** (non-breaking, added to return object of `createAutoTrixel`):

| Method | Signature | Description |
|:-------|:----------|:------------|
| `getState()` | `() -> { version, config, gridData, palette }` | Serialize full canvas state to a JSON-compatible object |
| `loadState(state)` | `(state) -> void` | Deserialize `.trixel.json` content into engine, trigger fullRedraw |
| `exportImageAsBlob()` | `() -> Promise<Blob>` | Render canvas to PNG blob without triggering download |
| `exportSVGAsString()` | `() -> string` | Build SVG string without triggering download |

**Canvas State Format** (`.trixel.json` -- shared with CLI spec):

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
    "7,8": { "subdivided": true, "children": ["#ff0000", null, "#00ff00", null] }
  },
  "palette": ["#ff0000", "#00ff00", "#0000ff"]
}
```

**Dependencies**:
- `@tauri-apps/cli` -- Tauri CLI for dev/build
- `@tauri-apps/api` -- JS bridge to Tauri backend
- `@tauri-apps/plugin-dialog` -- Native file dialogs
- `@tauri-apps/plugin-fs` -- File system access
- `@tauri-apps/plugin-window-state` -- Window position/size persistence
- `@tauri-apps/plugin-updater` -- Auto-update (Nice-to-Have)

**Risks**:

| Risk | Likelihood | Mitigation |
|:-----|:-----------|:-----------|
| WebKitGTK Canvas rendering differs from Chromium on Linux | Low | OKLCH conversion is JS-side (same math everywhere). Test on all 3 platforms in CI. |
| Image fill serialization (HTMLImageElement not JSON-safe) | Medium | Store `src` as data URL in gridData. Reconstruct Image on load. Deferred to Open Question #1. |
| Tauri v2 plugin ecosystem gaps | Low | Core plugins (dialog, fs, window-state) are stable. Updater is official. |
| Cross-platform CI build complexity | Medium | Use official `tauri-action` GitHub Action. Pin Rust toolchain version. |
| `base` path conflict (GitHub Pages `/AutoTrixel/` vs native `/`) | Low | Conditional `base` in `vite.config.js` based on Tauri env var. |

---

## Acceptance Scenarios

```gherkin
Feature: autotrixel-native
  As a trixel artist
  I want a native desktop app
  So that I can create and edit trixel art with full OS integration

  Rule: App launch and window

    Scenario: Launch the app
      Given AutoTrixel is installed
      When I launch the application
      Then a native window appears with the trixel editor
      And the menu bar shows File, Edit, View, Help menus
      And the window title is "AutoTrixel"

    Scenario: App runs offline
      Given no network connection
      When I launch AutoTrixel
      Then the app starts and is fully functional

  Rule: File creation

    Scenario: Create a new canvas
      When I select File > New (or press Ctrl+N)
      Then the editor resets to a fresh empty canvas
      And the window title becomes "AutoTrixel - Untitled"

    Scenario: New canvas prompts to save unsaved work
      Given the canvas has unsaved edits
      When I select File > New
      Then a confirm dialog appears: "Save changes?"
      And I can choose Save, Don't Save, or Cancel

  Rule: File open

    Scenario: Open a .trixel.json file
      When I select File > Open (or press Ctrl+O)
      Then a native file dialog appears filtered to .trixel.json
      When I select a valid file
      Then the canvas renders the saved grid state
      And the window title shows the filename

    Scenario: Open an invalid file
      When I select File > Open and choose a malformed JSON file
      Then an error notification appears
      And the current canvas is unchanged

    Scenario: Drag-and-drop a file
      Given the app is running
      When I drag a .trixel.json file onto the window
      Then the canvas loads the file contents
      And the window title updates to the filename

  Rule: File save

    Scenario: Save to current file
      Given a file is open and has unsaved changes
      When I press Ctrl+S
      Then the current state is written to the file path
      And the dirty indicator disappears from the title

    Scenario: Save As to a new path
      When I select File > Save As (or press Ctrl+Shift+S)
      Then a native save dialog appears
      When I choose a destination
      Then the state is written to the new path
      And the title updates to the new filename

    Scenario: Save untitled canvas
      Given the canvas is "Untitled" with edits
      When I press Ctrl+S
      Then a Save As dialog appears (since there is no file path)

  Rule: Export

    Scenario: Export as PNG
      When I select File > Export PNG
      Then a native save dialog appears filtered to .png
      When I choose a destination
      Then a valid PNG matching the canvas is written

    Scenario: Export as SVG
      When I select File > Export SVG
      Then a native save dialog appears filtered to .svg
      When I choose a destination
      Then a valid SVG with correct triangle geometry is written

  Rule: Window state

    Scenario: Window title shows filename
      Given I open "myart.trixel.json"
      Then the window title is "AutoTrixel - myart.trixel.json"

    Scenario: Dirty indicator on edit
      Given a clean canvas (no unsaved changes)
      When I paint a cell
      Then the window title shows an asterisk: "AutoTrixel - myart.trixel.json *"

    Scenario: Close with unsaved changes
      Given the canvas has unsaved edits
      When I attempt to close the window
      Then a native confirm dialog appears: "Save changes?"
      And options are Save / Don't Save / Cancel
      When I select Cancel
      Then the window remains open
```

---

## Task Breakdown

| ID | Task | Priority | Dependencies | Status |
|:---|:-----|:---------|:-------------|:-------|
| T1 | Scaffold Tauri v2 project: `tauri init`, configure `tauri.conf.json`, add Vite plugin, verify SPA loads in native window | High | None | pending |
| T2 | Engine API additions: add `getState()`, `loadState(state)`, `exportImageAsBlob()`, `exportSVGAsString()` to `createAutoTrixel` return object | High | None | pending |
| T3 | Native menu bar: define File/Edit/View/Help menus with accelerators in Rust, emit events to frontend | High | T1 | pending |
| T4 | File operations bridge: implement open, save, save-as using `@tauri-apps/plugin-dialog` + `@tauri-apps/plugin-fs` | High | T1, T2 | pending |
| T5 | Export bridge: PNG and SVG export via native save dialog | High | T2, T4 | pending |
| T6 | Window title + dirty state tracking | High | T4 | pending |
| T7 | Unsaved changes guard: confirm dialog on close/new/open when dirty | High | T6 | pending |
| T8 | Drag-and-drop file opening via Tauri file drop handler | Med | T4 | pending |
| T9 | Recent files: persist last 10 paths, populate File > Recent Files submenu | Med | T4 | pending |
| T10 | Auto-save / crash recovery: periodic temp save, recovery prompt on launch | Med | T4 | pending |
| T11 | File association: register `.trixel.json` in Tauri config per platform | Med | T1 | pending |
| T12 | Auto-updater: Tauri updater plugin + GitHub Releases endpoint | Low | T1 | pending |
| T13 | CI/CD: GitHub Actions workflow with `tauri-action` for Windows/macOS/Linux builds | Med | T1 | pending |

---

## Exit Criteria

- [ ] All Must-Have scenarios pass (manual test on at least one platform)
- [ ] No regressions on browser SPA (paint, fill, export, palette, subdivide all still work)
- [ ] Native file dialogs work for open, save, save-as, export
- [ ] Keyboard shortcuts match menu accelerators
- [ ] Window title reflects current file and dirty state
- [ ] Unsaved changes guard prevents accidental data loss
- [ ] App launches and runs fully offline
- [ ] Cross-platform builds produce installable binaries (Windows MSI, macOS DMG, Linux AppImage)

---

## References

- Epic: [#32 Native OS App & Agent CLI](https://github.com/Kiriketsuki/AutoTrixel/issues/32)
- PR: [#33 epic: Native OS App & Agent CLI](https://github.com/Kiriketsuki/AutoTrixel/pull/33)
- CLI spec (sibling): `autotrixel-cli-spec.md`
- Engine source: `src/logic/createAutoTrixel.js`
- Export module: `src/logic/autotrixel/export.js`
- Tauri v2 docs: https://v2.tauri.app

---
*Authored by: Clault KiperS 4.6*
