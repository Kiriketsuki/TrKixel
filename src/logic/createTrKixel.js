import { REQUIRED_SELECTORS } from "./autotrixel/constants.js";
import { clamp, hexToOklchVals } from "./autotrixel/utils.js";
import { getTriangleVertices, getBarycentric } from "./autotrixel/geometry.js";
import { fullRedraw, drawCursor, drawGridLines } from "./autotrixel/drawing.js";
import { renderSVG, renderToCanvas } from "../core/export.js";
import { createBrowserCanvasAdapter } from "../core/adapters/browser.js";
import { createEngine } from "../core/engine.js";

export function createTrKixel(rootElement) {
    if (!rootElement) {
        throw new Error("TrKixel root element was not provided");
    }

    // --- DOM selector cache ---

    const selectorCache = new Map();
    const select = (selector) => {
        if (selectorCache.has(selector)) {
            return selectorCache.get(selector);
        }
        const el = rootElement.querySelector(selector);
        if (!el) {
            throw new Error(`TrKixel init failed: missing element ${selector}`);
        }
        selectorCache.set(selector, el);
        return el;
    };

    REQUIRED_SELECTORS.forEach(select);

    const artCanvas = select("#artLayer");
    const artCtx = artCanvas.getContext("2d", { alpha: true });
    const cursorCanvas = select("#cursorLayer");
    const cursorCtx = cursorCanvas.getContext("2d");
    const canvasStack = select("#canvas-stack");
    const toast = select("#toast");
    const brushInput = select("#brushInput");
    const brushVal = select("#brushVal");
    const lInput = select("#lInput");
    const cInput = select("#cInput");
    const hInput = select("#hInput");
    const colorPreviewBox = select("#colorPreviewBox");
    const colorCodeDisplay = select("#colorCodeDisplay");
    const scaleSlider = select("#scaleSlider");
    const scaleNumber = select("#scaleNumber");
    const widthSlider = select("#widthSlider");
    const widthNumber = select("#widthNumber");
    const heightSlider = select("#heightSlider");
    const heightNumber = select("#heightNumber");
    const gridToggle = select("#gridToggle");
    const gridColorPicker = select("#gridColorPicker");
    const gridStyleSelect = select("#gridStyleSelect");
    const gridThicknessSlider = select("#gridThicknessSlider");
    const gridOpacitySlider = select("#gridOpacitySlider");
    const subGridStyleSelect = select("#subGridStyleSelect");
    const subGridThicknessSlider = select("#subGridThicknessSlider");
    const subGridOpacitySlider = select("#subGridOpacitySlider");
    const subGridToggle = select("#subGridToggle");
    const subGridColorPicker = select("#subGridColorPicker");
    const gridThicknessVal = select("#gridThicknessVal");
    const gridOpacityVal = select("#gridOpacityVal");
    const subGridThicknessVal = select("#subGridThicknessVal");
    const subGridOpacityVal = select("#subGridOpacityVal");
    const exportGridToggle = select("#exportGridToggle");
    const btnUndo = select("#btnUndo");
    const toolButtons = Array.from(rootElement.querySelectorAll(".tool-btn"));

    if (!artCtx || !cursorCtx) {
        throw new Error("Failed to initialize TrKixel canvases");
    }

    // --- Core engine ---

    const engine = createEngine();
    const browserAdapter = createBrowserCanvasAdapter();

    // --- Browser-only state ---

    const windowListeners = [];
    const addWindowListener = (event, handler, options) => {
        window.addEventListener(event, handler, options);
        windowListeners.push(() => window.removeEventListener(event, handler, options));
    };

    let hoveredCells = [];
    let isDrawing = false;
    let lastMouseX = 0;
    let lastMouseY = 0;

    let isPanning = false;
    let isBgPanning = false;
    let panStartX = 0;
    let panStartY = 0;
    let panOffsetX = 0;
    let panOffsetY = 0;
    let startPanOffsetX = 0;
    let startPanOffsetY = 0;
    let bgPanStartX = 0;
    let bgPanStartY = 0;
    let startBgX = 0;
    let startBgY = 0;
    let controlMode = "canvas";

    let tempSnapshot = null;
    let toastTimeout = null;

    let bgImage = {
        img: null,
        x: 0,
        y: 0,
        scale: 1,
        opacity: 0.5,
    };

    let zoomLevel = 1;

    // --- Helpers ---

    function redraw() {
        const config = engine.getConfig();
        const { triHeight, W_half } = engine.getDerived();
        fullRedraw(artCtx, artCanvas, engine.getGridData(), config, triHeight, W_half, bgImage, engine.getImageRegistry());
    }

    function redrawCursor() {
        const { triHeight, W_half } = engine.getDerived();
        drawCursor(cursorCtx, cursorCanvas, hoveredCells, engine.getTool(), triHeight, W_half);
    }

    function updateDimensions() {
        engine.updateConfig({});
        const config = engine.getConfig();

        artCanvas.width = config.width;
        artCanvas.height = config.height;
        cursorCanvas.width = config.width;
        cursorCanvas.height = config.height;

        canvasStack.style.width = `${config.width}px`;
        canvasStack.style.height = `${config.height}px`;
        redraw();
    }

    function updateCanvasTransform() {
        canvasStack.style.transform = `translate(${panOffsetX}px, ${panOffsetY}px) scale(${zoomLevel})`;
    }

    function showToast(message) {
        toast.innerText = message;
        toast.classList.add("show");
        if (toastTimeout) {
            clearTimeout(toastTimeout);
        }
        toastTimeout = window.setTimeout(() => toast.classList.remove("show"), 1500);
    }

    function triggerDownload(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.download = filename;
        link.href = url;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 100);
    }

    function updateUndoButton() {
        const canUndo = engine.canUndo();
        btnUndo.disabled = !canUndo;
        btnUndo.style.opacity = canUndo ? "1" : "0.5";
    }

    function undoAction() {
        if (engine.undo()) {
            redraw();
            updateUndoButton();
            showToast("Undo");
        } else {
            showToast("Nothing to Undo");
        }
    }

    function redoAction() {
        if (engine.redo()) {
            redraw();
            updateUndoButton();
            showToast("Redo");
        } else {
            showToast("Nothing to Redo");
        }
    }

    let updateColorUI = function (cssString) {
        const colorState = engine.getColor();
        colorPreviewBox.style.backgroundColor = cssString;
        colorPreviewBox.style.backgroundImage = "none";
        colorPreviewBox.style.backgroundColor = cssString;
        lInput.value = Math.round(colorState.l * 100);
        cInput.value = colorState.c;
        hInput.value = Math.round(colorState.h);

        if (cssString.startsWith("#")) {
            colorCodeDisplay.innerText = cssString;
        } else {
            colorCodeDisplay.innerText = `L:${Math.round(colorState.l * 100)} C:${colorState.c.toFixed(2)} H:${Math.round(colorState.h)}`;
        }

        if (engine.getTool() === "eraser" || engine.getTool() === "picker" || engine.getTool() === "subdivide") {
            setTool("pencil");
        }
    };

    function syncColorFromHex(hex) {
        engine.setColorFromHex(hex);
        updateColorUI(hex);
    }

    function updateColorFromSliders() {
        const L = parseFloat(lInput.value) / 100;
        const C = parseFloat(cInput.value);
        const H = parseFloat(hInput.value);

        engine.setColor(L, C, H);
        updateColorUI(engine.getCssColor());
    }

    function setTool(tool) {
        engine.setTool(tool);
        toolButtons.forEach((button) => button.classList.remove("active"));
        const activeButton = rootElement.querySelector(`#tool-${tool}`);
        if (activeButton) {
            activeButton.classList.add("active");
        }

        cursorCanvas.style.cursor = "crosshair";

        if (tool === "pencil" || tool === "eraser") {
            const bs = engine.getBrushSize();
            brushInput.value = bs;
            brushVal.innerText = bs;
        }

        redrawCursor();
    }

    function updateBrushSize(change) {
        const currentTool = engine.getTool();
        let newSize = currentTool === "picker" || currentTool === "bucket" ? engine.getStoredBrushSize() : engine.getBrushSize();
        newSize = clamp(newSize + change, 1, 5);

        if (newSize !== engine.getBrushSize()) {
            if (currentTool === "picker" || currentTool === "bucket") {
                engine.setStoredBrushSize(newSize);
                showToast(`Saved Brush Size: ${newSize}`);
            } else {
                engine.setBrushSize(newSize);
                brushInput.value = newSize;
                brushVal.innerText = newSize;
                redrawCursor();
                showToast(`Brush Size: ${newSize}`);
            }
        }
    }

    function scale(change) {
        const config = engine.getConfig();
        const newSize = clamp(config.triSide + change, 5, 200);
        if (newSize !== config.triSide) {
            engine.updateConfig({ triSide: newSize });
            scaleSlider.value = newSize;
            scaleNumber.value = newSize;
            updateDimensions();
            showToast(`Scale: ${newSize}px`);
        }
    }

    function performZoom(change) {
        const newZoom = clamp(zoomLevel + change, 0.1, 5);
        if (Math.abs(newZoom - zoomLevel) > 0.001) {
            zoomLevel = newZoom;
            updateCanvasTransform();
            showToast(`Zoom: ${(zoomLevel * 100).toFixed(0)}%`);
        }
    }

    // --- Click/draw handling ---

    function handleSingleClick() {
        if (hoveredCells.length === 0) return false;

        const currentTool = engine.getTool();
        const gridData = engine.getGridData();
        const currentFill = engine.getFill();
        let didChange = false;

        if (currentTool === "bucket") {
            const cell = hoveredCells[0];
            didChange = engine.fillAtCell(cell.r, cell.c);
        } else if (currentTool === "picker") {
            const cell = hoveredCells[0];
            const key = `${cell.r},${cell.c}`;
            const color = gridData[key];
            if (color) {
                let picked = color;
                if (typeof color === "object" && color.subdivided) {
                    const p = { x: lastMouseX, y: lastMouseY };
                    picked = engine.pickFromSubdivided(color, p, cell.r, cell.c);
                }

                if (picked) {
                    if (picked.startsWith("#")) {
                        syncColorFromHex(picked);
                    } else if (picked.startsWith("oklch")) {
                        const matches = picked.match(/oklch\(([^%]+)%\s+([\d.]+)\s+([\d.]+)\)/);
                        if (matches) {
                            engine.setColor(parseFloat(matches[1]) / 100, parseFloat(matches[2]), parseFloat(matches[3]));
                            updateColorUI(picked);
                        }
                    }
                    showToast("Color Picked");
                }
            }
        } else {
            const config = engine.getConfig();
            if (config.brushSize === 1 && (currentTool === "subdivide" || currentTool === "pencil" || currentTool === "eraser")) {
                const cell = hoveredCells[0];
                const key = `${cell.r},${cell.c}`;
                const p = { x: lastMouseX, y: lastMouseY };
                const newData = engine.processSubdivision(key, p, cell.r, cell.c, currentTool, currentFill);
                if (JSON.stringify(gridData[key]) !== JSON.stringify(newData)) {
                    gridData[key] = newData;
                    didChange = true;
                }
            } else {
                if (currentTool === "subdivide") {
                    hoveredCells.forEach((cell) => {
                        const key = `${cell.r},${cell.c}`;
                        if (!gridData[key] || typeof gridData[key] === "string") {
                            const base = gridData[key] || null;
                            gridData[key] = { subdivided: true, children: [base, base, base, base] };
                            didChange = true;
                        }
                    });
                } else {
                    didChange = engine.paintCells(hoveredCells);
                }
            }
        }

        if (didChange) {
            redraw();
        }
        return didChange;
    }

    // --- Subdivision hover detection ---

    function detectSubdivisionHover(cell, x, y) {
        const gridData = engine.getGridData();
        const key = `${cell.r},${cell.c}`;
        const data = gridData[key];
        if (data && data.subdivided) {
            const { triHeight, W_half } = engine.getDerived();
            const vertices = getTriangleVertices(cell.r, cell.c, triHeight, W_half);
            const [v0, v1, v2] = vertices;
            const m01 = { x: (v0.x + v1.x) / 2, y: (v0.y + v1.y) / 2 };
            const m12 = { x: (v1.x + v2.x) / 2, y: (v1.y + v2.y) / 2 };
            const m20 = { x: (v2.x + v0.x) / 2, y: (v2.y + v0.y) / 2 };

            const p = { x, y };
            const { u, v, w } = getBarycentric(p, v0, v1, v2);

            let subVertices;
            if (u > 0.5) {
                subVertices = [v0, m01, m20];
            } else if (v > 0.5) {
                subVertices = [m01, v1, m12];
            } else if (w > 0.5) {
                subVertices = [m20, m12, v2];
            } else {
                subVertices = [m01, m12, m20];
            }
            hoveredCells[0].subVertices = subVertices;
        }
    }

    // --- Drawing during drag ---

    function handleDrawingMove(x, y) {
        const currentTool = engine.getTool();
        const gridData = engine.getGridData();
        const config = engine.getConfig();
        const currentFill = engine.getFill();

        if (config.brushSize === 1 && (currentTool === "subdivide" || currentTool === "pencil" || currentTool === "eraser")) {
            const dx = x - lastMouseX;
            const dy = y - lastMouseY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const steps = Math.ceil(dist / 2);

            let didChange = false;
            for (let i = 0; i <= steps; i++) {
                const t = steps === 0 ? 0 : i / steps;
                const px = lastMouseX + dx * t;
                const py = lastMouseY + dy * t;
                const c = engine.pixelToGrid(px, py);
                if (c) {
                    const key = `${c.r},${c.c}`;
                    const newData = engine.processSubdivision(key, { x: px, y: py }, c.r, c.c, currentTool, currentFill);
                    if (JSON.stringify(gridData[key]) !== JSON.stringify(newData)) {
                        gridData[key] = newData;
                        didChange = true;
                    }
                }
            }
            if (didChange) redraw();
        } else {
            const cellsToPaint = engine.interpolateStroke(lastMouseX, lastMouseY, x, y);
            if (cellsToPaint.length > 0) {
                if (currentTool === "subdivide") {
                    let didChange = false;
                    cellsToPaint.forEach((c) => {
                        const key = `${c.r},${c.c}`;
                        if (!gridData[key] || typeof gridData[key] === "string") {
                            const base = gridData[key] || null;
                            gridData[key] = { subdivided: true, children: [base, base, base, base] };
                            didChange = true;
                        }
                    });
                    if (didChange) redraw();
                } else {
                    const didChange = engine.paintCells(cellsToPaint);
                    if (didChange) redraw();
                }
            }
        }
    }

    // --- Hover tracking ---

    function updateHoverFromPosition(x, y) {
        const currentTool = engine.getTool();
        const config = engine.getConfig();
        const cell = engine.pixelToGrid(x, y);

        if (cell) {
            const useSize = currentTool === "picker" || currentTool === "bucket" ? 1 : config.brushSize;
            let anchor = { r: cell.r, c: cell.c };
            if (useSize > 1) {
                anchor = engine.findBestCenterPixel(x, y, useSize) || anchor;
            }
            hoveredCells = engine.getTriangleCluster(anchor.r, anchor.c, useSize);

            if (useSize === 1 && hoveredCells.length === 1) {
                detectSubdivisionHover(cell, x, y);
            }
        } else {
            hoveredCells = [];
        }
        redrawCursor();
    }

    // --- Events ---

    function setupEvents() {
        cursorCanvas.addEventListener("mousedown", (e) => {
            if (e.button === 1) {
                e.preventDefault();
                if ((e.ctrlKey && e.altKey) || controlMode === "background") {
                    isBgPanning = true;
                    bgPanStartX = e.clientX;
                    bgPanStartY = e.clientY;
                    startBgX = bgImage.x;
                    startBgY = bgImage.y;
                    cursorCanvas.style.cursor = "move";
                } else {
                    isPanning = true;
                    panStartX = e.clientX;
                    panStartY = e.clientY;
                    startPanOffsetX = panOffsetX;
                    startPanOffsetY = panOffsetY;
                    cursorCanvas.style.cursor = "grabbing";
                }
                return;
            }

            const rect = cursorCanvas.getBoundingClientRect();
            lastMouseX = (e.clientX - rect.left) / zoomLevel;
            lastMouseY = (e.clientY - rect.top) / zoomLevel;

            tempSnapshot = engine.saveSnapshot();
            isDrawing = true;

            handleSingleClick();
        });

        addWindowListener("mouseup", (e) => {
            if (isPanning) {
                isPanning = false;
                cursorCanvas.style.cursor = "crosshair";
                return;
            }
            if (isBgPanning) {
                isBgPanning = false;
                cursorCanvas.style.cursor = "crosshair";
                return;
            }

            if (isDrawing) {
                isDrawing = false;
                const newState = JSON.stringify(engine.getGridData());
                if (newState !== tempSnapshot) {
                    engine.pushToHistory(tempSnapshot);
                    updateUndoButton();
                }
            }
        });

        cursorCanvas.addEventListener("mousemove", (e) => {
            if (isPanning) {
                const dx = e.clientX - panStartX;
                const dy = e.clientY - panStartY;
                panOffsetX = startPanOffsetX + dx;
                panOffsetY = startPanOffsetY + dy;
                updateCanvasTransform();
                return;
            }

            if (isBgPanning) {
                const dx = e.clientX - bgPanStartX;
                const dy = e.clientY - bgPanStartY;
                bgImage.x = startBgX + dx;
                bgImage.y = startBgY + dy;
                redraw();
                notifyBgChange();
                return;
            }

            const rect = cursorCanvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) / zoomLevel;
            const y = (e.clientY - rect.top) / zoomLevel;

            updateHoverFromPosition(x, y);

            const currentTool = engine.getTool();
            if (isDrawing && currentTool !== "bucket" && currentTool !== "picker") {
                handleDrawingMove(x, y);
            }

            lastMouseX = x;
            lastMouseY = y;
        });

        cursorCanvas.addEventListener("mouseleave", () => {
            hoveredCells = [];
            redrawCursor();
        });

        cursorCanvas.addEventListener("mouseenter", (e) => {
            if (isDrawing) {
                const rect = cursorCanvas.getBoundingClientRect();
                lastMouseX = (e.clientX - rect.left) / zoomLevel;
                lastMouseY = (e.clientY - rect.top) / zoomLevel;
            }
        });

        cursorCanvas.addEventListener(
            "touchstart",
            (e) => {
                e.preventDefault();
                if (e.touches.length === 2) {
                    isPanning = true;
                    isDrawing = false;
                    const t1 = e.touches[0];
                    const t2 = e.touches[1];
                    panStartX = (t1.clientX + t2.clientX) / 2;
                    panStartY = (t1.clientY + t2.clientY) / 2;
                    startPanOffsetX = panOffsetX;
                    startPanOffsetY = panOffsetY;
                    return;
                }

                if (e.touches.length > 0) {
                    const touch = e.touches[0];
                    const rect = cursorCanvas.getBoundingClientRect();
                    lastMouseX = (touch.clientX - rect.left) / zoomLevel;
                    lastMouseY = (touch.clientY - rect.top) / zoomLevel;

                    tempSnapshot = engine.saveSnapshot();
                    isDrawing = true;

                    const cell = engine.pixelToGrid(lastMouseX, lastMouseY);
                    if (cell) {
                        const currentTool = engine.getTool();
                        const config = engine.getConfig();
                        const useSize = currentTool === "picker" || currentTool === "bucket" ? 1 : config.brushSize;
                        let anchor = { r: cell.r, c: cell.c };
                        if (useSize > 1) {
                            anchor = engine.findBestCenter(cell.r, cell.c, useSize);
                        }
                        hoveredCells = engine.getTriangleCluster(anchor.r, anchor.c, useSize);
                    } else {
                        hoveredCells = [];
                    }

                    handleSingleClick();
                }
            },
            { passive: false },
        );

        cursorCanvas.addEventListener(
            "touchmove",
            (e) => {
                e.preventDefault();
                if (isPanning && e.touches.length === 2) {
                    const t1 = e.touches[0];
                    const t2 = e.touches[1];
                    const cx = (t1.clientX + t2.clientX) / 2;
                    const cy = (t1.clientY + t2.clientY) / 2;
                    const dx = cx - panStartX;
                    const dy = cy - panStartY;
                    panOffsetX = startPanOffsetX + dx;
                    panOffsetY = startPanOffsetY + dy;
                    updateCanvasTransform();
                    return;
                }

                if (e.touches.length > 0) {
                    const touch = e.touches[0];
                    const rect = cursorCanvas.getBoundingClientRect();
                    const x = (touch.clientX - rect.left) / zoomLevel;
                    const y = (touch.clientY - rect.top) / zoomLevel;

                    updateHoverFromPosition(x, y);

                    const currentTool = engine.getTool();
                    if (isDrawing && currentTool !== "bucket" && currentTool !== "picker") {
                        handleDrawingMove(x, y);
                    }
                    lastMouseX = x;
                    lastMouseY = y;
                }
            },
            { passive: false },
        );

        addWindowListener("touchend", (e) => {
            if (isPanning && e.touches.length < 2) {
                isPanning = false;
            }
            if (isDrawing) {
                isDrawing = false;
                const newState = JSON.stringify(engine.getGridData());
                if (newState !== tempSnapshot) {
                    engine.pushToHistory(tempSnapshot);
                    updateUndoButton();
                }
            }
        });

        addWindowListener("keydown", (e) => {
            if (e.ctrlKey) {
                if (e.key === "z" || e.key === "Z") {
                    e.preventDefault();
                    if (e.shiftKey) {
                        redoAction();
                    } else {
                        undoAction();
                    }
                } else if (e.key === "=" || e.key === "+") {
                    e.preventDefault();
                    if (e.shiftKey) {
                        scale(5);
                    } else {
                        performZoom(0.1);
                    }
                } else if (e.key === "-") {
                    e.preventDefault();
                    if (e.shiftKey) {
                        scale(-5);
                    } else {
                        performZoom(-0.1);
                    }
                } else if (e.key === "[") {
                    e.preventDefault();
                    updateBrushSize(-1);
                } else if (e.key === "]") {
                    e.preventDefault();
                    updateBrushSize(1);
                }
            } else {
                if (controlMode === "background") {
                    if (e.key === "ArrowUp") {
                        e.preventDefault();
                        bgImage.y -= 10;
                        redraw();
                        notifyBgChange();
                    } else if (e.key === "ArrowDown") {
                        e.preventDefault();
                        bgImage.y += 10;
                        redraw();
                        notifyBgChange();
                    } else if (e.key === "ArrowLeft") {
                        e.preventDefault();
                        bgImage.x -= 10;
                        redraw();
                        notifyBgChange();
                    } else if (e.key === "ArrowRight") {
                        e.preventDefault();
                        bgImage.x += 10;
                        redraw();
                        notifyBgChange();
                    }
                } else {
                    if (e.key === "ArrowUp") {
                        e.preventDefault();
                        panOffsetY -= 20;
                        updateCanvasTransform();
                    } else if (e.key === "ArrowDown") {
                        e.preventDefault();
                        panOffsetY += 20;
                        updateCanvasTransform();
                    } else if (e.key === "ArrowLeft") {
                        e.preventDefault();
                        panOffsetX -= 20;
                        updateCanvasTransform();
                    } else if (e.key === "ArrowRight") {
                        e.preventDefault();
                        panOffsetX += 20;
                        updateCanvasTransform();
                    }
                }
            }
        });

        addWindowListener(
            "wheel",
            (e) => {
                if (e.ctrlKey) {
                    e.preventDefault();
                    if (e.shiftKey) {
                        const delta = e.deltaY < 0 ? 1 : -1;
                        scale(delta * 5);
                    } else if (e.altKey) {
                        const delta = e.deltaY < 0 ? 0.1 : -0.1;
                        bgImage.scale = clamp(bgImage.scale + delta, 0.1, 5);
                        redraw();
                        notifyBgChange();
                        showToast(`BG Scale: ${bgImage.scale.toFixed(2)}`);
                    } else {
                        const delta = e.deltaY < 0 ? 0.1 : -0.1;
                        performZoom(delta);
                    }
                }
            },
            { passive: false },
        );

        const updateScale = (val) => {
            engine.updateConfig({ triSide: parseInt(val, 10) });
            scaleSlider.value = val;
            scaleNumber.value = val;
            updateDimensions();
        };
        scaleSlider.addEventListener("input", (e) => updateScale(e.target.value));
        scaleNumber.addEventListener("input", (e) => updateScale(e.target.value));

        brushInput.addEventListener("input", (e) => {
            const val = parseInt(e.target.value, 10);
            engine.setBrushSize(val);
            brushVal.innerText = val;
        });

        const updateWidth = (val) => {
            engine.updateConfig({ width: parseInt(val, 10) });
            widthSlider.value = val;
            widthNumber.value = val;
            updateDimensions();
        };
        widthSlider.addEventListener("input", (e) => updateWidth(e.target.value));
        widthNumber.addEventListener("input", (e) => updateWidth(e.target.value));

        const updateHeight = (val) => {
            engine.updateConfig({ height: parseInt(val, 10) });
            heightSlider.value = val;
            heightNumber.value = val;
            updateDimensions();
        };
        heightSlider.addEventListener("input", (e) => updateHeight(e.target.value));
        heightNumber.addEventListener("input", (e) => updateHeight(e.target.value));

        gridToggle.addEventListener("change", (e) => {
            engine.updateConfig({ showGrid: e.target.checked });
            redraw();
        });

        gridColorPicker.addEventListener("input", (e) => {
            let color = e.target.value;
            if (color.startsWith("var(")) {
                const varName = color.match(/var\(([^)]+)\)/)[1];
                color = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
            }
            engine.updateConfig({ gridColor: color });
            redraw();
        });

        gridStyleSelect.addEventListener("change", (e) => {
            engine.updateConfig({ gridStyle: e.target.value });
            redraw();
        });

        gridThicknessSlider.addEventListener("input", (e) => {
            let val = parseFloat(e.target.value);
            val = clamp(val, 0.1, 1.5);
            engine.updateConfig({ gridThickness: val });
            gridThicknessVal.innerText = val;
            redraw();
        });

        gridOpacitySlider.addEventListener("input", (e) => {
            const val = parseFloat(e.target.value);
            engine.updateConfig({ gridOpacity: val });
            gridOpacityVal.innerText = val;
            redraw();
        });

        subGridStyleSelect.addEventListener("change", (e) => {
            engine.updateConfig({ subGridStyle: e.target.value });
            redraw();
        });

        subGridThicknessSlider.addEventListener("input", (e) => {
            let val = parseFloat(e.target.value);
            val = clamp(val, 0.1, 1.5);
            engine.updateConfig({ subGridThickness: val });
            subGridThicknessVal.innerText = val;
            redraw();
        });

        subGridOpacitySlider.addEventListener("input", (e) => {
            const val = parseFloat(e.target.value);
            engine.updateConfig({ subGridOpacity: val });
            subGridOpacityVal.innerText = val;
            redraw();
        });

        subGridToggle.addEventListener("change", (e) => {
            engine.updateConfig({ showSubGrid: e.target.checked });
            redraw();
        });

        subGridColorPicker.addEventListener("input", (e) => {
            let color = e.target.value;
            if (color.startsWith("var(")) {
                const varName = color.match(/var\(([^)]+)\)/)[1];
                color = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
            }
            engine.updateConfig({ subGridColor: color });
            redraw();
        });

        lInput.addEventListener("input", updateColorFromSliders);
        cInput.addEventListener("input", updateColorFromSliders);
        hInput.addEventListener("input", updateColorFromSliders);
    }

    // --- Background ---

    function resetCanvas() {
        try {
            engine.pushToHistory(engine.saveSnapshot());
            engine.resetCanvas();
            bgImage = {
                img: null,
                x: 0,
                y: 0,
                scale: 1,
                opacity: 0.5,
            };
            redraw();
            updateUndoButton();
            notifyBgChange();
            showToast("Canvas & Background Cleared");
        } catch (e) {
            console.error("Reset Canvas Failed:", e);
            showToast("Error Clearing Canvas");
        }
    }

    function setBackgroundImage(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                bgImage.img = img;
                bgImage.x = 0;
                bgImage.y = 0;
                bgImage.scale = 1;
                redraw();
                notifyBgChange();
                showToast("Background Image Loaded");
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    function updateBackground(props) {
        if (props.x !== undefined) bgImage.x = props.x;
        if (props.y !== undefined) bgImage.y = props.y;
        if (props.scale !== undefined) bgImage.scale = props.scale;
        if (props.opacity !== undefined) bgImage.opacity = props.opacity;
        redraw();
    }

    function setControlMode(mode) {
        controlMode = mode;
        showToast(`Control Mode: ${mode === "background" ? "Background" : "Canvas"}`);
    }

    let onBgChangeCallback = null;
    function onBgChange(cb) {
        onBgChangeCallback = cb;
    }

    function notifyBgChange() {
        if (onBgChangeCallback) {
            onBgChangeCallback({ ...bgImage, hasImage: !!bgImage.img });
        }
    }

    function registerImage(id, imgElement) {
        engine.registerImage(id, imgElement);
    }

    function setCurrentImage(imageData) {
        if (!engine.getImageRegistry().has(imageData.id)) {
            engine.registerImage(imageData.id, imageData.element);
        }
        engine.setFill({
            type: "image",
            imageId: imageData.id,
            src: imageData.src,
        });

        colorPreviewBox.style.backgroundColor = "transparent";
        colorPreviewBox.style.backgroundImage = `url(${imageData.src})`;
        colorPreviewBox.style.backgroundSize = "cover";
        colorPreviewBox.style.backgroundPosition = "center";
        colorCodeDisplay.innerText = "Image";

        if (engine.getTool() === "eraser" || engine.getTool() === "picker" || engine.getTool() === "subdivide") {
            setTool("pencil");
        }
    }

    // --- Init ---

    function init() {
        updateDimensions();
        setupEvents();
        updateUndoButton();
        updateColorUI(engine.getCssColor());
        redraw();
    }

    init();

    // --- Public API (identical to original) ---

    return {
        select,
        updateDimensions,
        resetCanvas,
        exportImage: () => {
            const config = engine.getConfig();
            const { triHeight, W_half } = engine.getDerived();
            const canvas = renderToCanvas(engine, browserAdapter);
            if (exportGridToggle.checked) {
                const ctx = canvas.getContext("2d");
                drawGridLines(ctx, canvas, config, triHeight, W_half);
            }
            canvas.toBlob((blob) => {
                if (!blob) return;
                triggerDownload(blob, "tripixel-art.png");
                showToast("Image Saved!");
            }, "image/png");
        },
        exportSVG: () => {
            const svg = renderSVG(engine, { includeGrid: exportGridToggle.checked });
            const blob = new Blob([svg], { type: "image/svg+xml" });
            triggerDownload(blob, "tripixel-art.svg");
            showToast("SVG Saved!");
        },
        destroy: () => {
            windowListeners.forEach((dispose) => dispose());
            windowListeners.length = 0;
        },
        registerImage,
        setCurrentImage,
        setCurrentImage,
        onBgChange,
        onBgChange,
        updateBackground,
        setControlMode,
        setColor: (l, c, h) => {
            engine.setColor(l, c, h);
            updateColorUI(engine.getCssColor());
        },
        onColorChange: (cb) => {
            const originalUpdateColorUI = updateColorUI;
            updateColorUI = (cssString) => {
                originalUpdateColorUI(cssString);
                cb(engine.getColor());
            };
        },
        getState: () => engine.getState(),
        loadState: (state) => {
            const snapshot = engine.saveSnapshot();
            engine.loadState(state);
            engine.pushToHistory(snapshot);
            updateDimensions();
            updateUndoButton();
            redraw();
        },
        exportImageAsBlob: () => {
            const canvas = renderToCanvas(engine, browserAdapter);
            return browserAdapter.canvasToBlob(canvas);
        },
        exportSVGAsString: () => {
            return renderSVG(engine);
        },
        setTool,
        undoAction,
        redoAction,
        zoomIn: () => performZoom(0.1),
        zoomOut: () => performZoom(-0.1),
        resetZoom: () => {
            zoomLevel = 1;
            panOffsetX = 0;
            panOffsetY = 0;
            updateCanvasTransform();
            showToast('Zoom: 100%');
        },
    };
}
