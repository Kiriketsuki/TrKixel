import { DEFAULT_CONFIG } from "../logic/autotrixel/constants.js";
import { clamp, hexToOklchVals } from "../logic/autotrixel/utils.js";
import {
    pixelToGrid,
    getTriangleCluster,
    findBestCenter,
    findBestCenterPixel,
    getTriangleVertices,
    getBarycentric,
} from "../logic/autotrixel/geometry.js";
import { batchPaintCells, fillBucket, interpolateStroke } from "../logic/autotrixel/actions.js";

const MAX_HISTORY = 10;

export function createEngine(options = {}) {
    const config = { ...DEFAULT_CONFIG, ...options };

    let gridData = {};
    let historyQueue = [];
    let redoQueue = [];

    let currentTool = "pencil";
    let brushSize = 1;
    let storedBrushSize = 1;

    let colorState = { l: 0.6, c: 0.15, h: 200 };
    let currentCssColor = "oklch(60% 0.15 200)";
    let currentFill = currentCssColor;

    const imageRegistry = new Map();

    let triHeight, W_half;

    function recalcDerived() {
        triHeight = (config.triSide * Math.sqrt(3)) / 2;
        W_half = config.triSide / 2;
        config.widthTriangles = Math.ceil(config.width / W_half);
        config.heightTriangles = Math.ceil(config.height / triHeight);
    }

    recalcDerived();

    // --- Undo ---

    function saveSnapshot() {
        return JSON.stringify(gridData);
    }

    function pushToHistory(snapshot) {
        historyQueue.push(snapshot);
        if (historyQueue.length > MAX_HISTORY) {
            historyQueue.shift();
        }
        redoQueue = [];
    }

    function undo() {
        if (historyQueue.length === 0) return false;
        const current = saveSnapshot();
        const previous = historyQueue.pop();
        gridData = JSON.parse(previous);
        redoQueue.push(current);
        if (redoQueue.length > MAX_HISTORY) {
            redoQueue.shift();
        }
        return true;
    }

    function redo() {
        if (redoQueue.length === 0) return false;
        const current = saveSnapshot();
        const next = redoQueue.pop();
        gridData = JSON.parse(next);
        historyQueue.push(current);
        if (historyQueue.length > MAX_HISTORY) {
            historyQueue.shift();
        }
        return true;
    }

    // --- Subdivision ---

    function processSubdivision(key, p, r, c, tool, color) {
        let data = gridData[key];

        if (tool === "subdivide" && data && data.subdivided) return data;
        if (tool === "subdivide" && data && data.type === "image") return data;

        const vertices = getTriangleVertices(r, c, triHeight, W_half);

        const updateRecursive = (node, p, v0, v1, v2) => {
            if (!node || typeof node !== "object" || !node.subdivided) {
                if (tool === "subdivide") {
                    const baseColor = node || null;
                    return { subdivided: true, children: [baseColor, baseColor, baseColor, baseColor] };
                } else {
                    return tool === "eraser" ? null : color;
                }
            }

            if (node.subdivided) {
                const m01 = { x: (v0.x + v1.x) / 2, y: (v0.y + v1.y) / 2 };
                const m12 = { x: (v1.x + v2.x) / 2, y: (v1.y + v2.y) / 2 };
                const m20 = { x: (v2.x + v0.x) / 2, y: (v2.y + v0.y) / 2 };

                const { u, v, w } = getBarycentric(p, v0, v1, v2);

                let childIndex = 3;
                let nextV0, nextV1, nextV2;

                if (u > 0.5) {
                    childIndex = 0;
                    nextV0 = v0;
                    nextV1 = m01;
                    nextV2 = m20;
                } else if (v > 0.5) {
                    childIndex = 1;
                    nextV0 = m01;
                    nextV1 = v1;
                    nextV2 = m12;
                } else if (w > 0.5) {
                    childIndex = 2;
                    nextV0 = m20;
                    nextV1 = m12;
                    nextV2 = v2;
                } else {
                    childIndex = 3;
                    nextV0 = m01;
                    nextV1 = m12;
                    nextV2 = m20;
                }

                const newChildren = [...node.children];
                newChildren[childIndex] = updateRecursive(newChildren[childIndex], p, nextV0, nextV1, nextV2);
                return { ...node, children: newChildren };
            }
            return node;
        };

        return updateRecursive(data, p, vertices[0], vertices[1], vertices[2]);
    }

    function pickFromSubdivided(data, point, r, c) {
        const vertices = getTriangleVertices(r, c, triHeight, W_half);

        const pickRecursive = (node, p, v0, v1, v2) => {
            if (typeof node === "string") return node;
            if (!node) return null;
            if (node.subdivided) {
                const m01 = { x: (v0.x + v1.x) / 2, y: (v0.y + v1.y) / 2 };
                const m12 = { x: (v1.x + v2.x) / 2, y: (v1.y + v2.y) / 2 };
                const m20 = { x: (v2.x + v0.x) / 2, y: (v2.y + v0.y) / 2 };
                const { u, v, w } = getBarycentric(p, v0, v1, v2);

                let childIndex = 3;
                let nextV0, nextV1, nextV2;

                if (u > 0.5) {
                    childIndex = 0;
                    nextV0 = v0;
                    nextV1 = m01;
                    nextV2 = m20;
                } else if (v > 0.5) {
                    childIndex = 1;
                    nextV0 = m01;
                    nextV1 = v1;
                    nextV2 = m12;
                } else if (w > 0.5) {
                    childIndex = 2;
                    nextV0 = m20;
                    nextV1 = m12;
                    nextV2 = v2;
                } else {
                    childIndex = 3;
                    nextV0 = m01;
                    nextV1 = m12;
                    nextV2 = m20;
                }

                return pickRecursive(node.children[childIndex], p, nextV0, nextV1, nextV2);
            }
            return null;
        };

        return pickRecursive(data, point, vertices[0], vertices[1], vertices[2]);
    }

    // --- Public API ---

    return {
        // Config
        getConfig() {
            return { ...config };
        },
        updateConfig(partial) {
            Object.assign(config, partial);
            recalcDerived();
        },
        getDerived() {
            return { triHeight, W_half };
        },

        // Grid data (internal ref for rendering — use getState() for serialization)
        getGridData() {
            return gridData;
        },
        setGridData(data) {
            gridData = data;
        },

        // Serialization
        /**
         * Returns a serializable snapshot of the engine state.
         * Note: `palette` is always `[]` — the engine does not manage palette state.
         * Callers (Tauri shell, CLI) must inject the palette from their own
         * application state before persisting to disk.
         */
        getState() {
            return {
                version: 1,
                config: { ...config },
                gridData: JSON.parse(JSON.stringify(gridData)),
                palette: [],
            };
        },
        loadState(state) {
            if (state.config) {
                Object.assign(config, state.config);
            }
            gridData = state.gridData ? JSON.parse(JSON.stringify(state.gridData)) : {};
            recalcDerived();
        },

        // Undo / Redo
        saveSnapshot,
        pushToHistory,
        undo,
        redo,
        canUndo() {
            return historyQueue.length > 0;
        },
        canRedo() {
            return redoQueue.length > 0;
        },

        // Tool
        getTool() {
            return currentTool;
        },
        setTool(tool) {
            currentTool = tool;
            if (tool === "pencil" || tool === "eraser") {
                brushSize = storedBrushSize;
                config.brushSize = storedBrushSize;
            }
        },
        getBrushSize() {
            return config.brushSize;
        },
        setBrushSize(size) {
            const clamped = clamp(size, 1, 5);
            config.brushSize = clamped;
            brushSize = clamped;
            storedBrushSize = clamped;
        },
        getStoredBrushSize() {
            return storedBrushSize;
        },
        setStoredBrushSize(size) {
            storedBrushSize = clamp(size, 1, 5);
        },

        // Color
        getColor() {
            return { ...colorState };
        },
        getCssColor() {
            return currentCssColor;
        },
        setColor(l, c, h) {
            colorState = { l, c, h };
            currentCssColor = `oklch(${Math.round(l * 100)}% ${c} ${Math.round(h)})`;
            currentFill = currentCssColor;
        },
        setColorFromHex(hex) {
            const vals = hexToOklchVals(hex);
            colorState = { l: vals.l, c: vals.c, h: vals.h };
            currentCssColor = hex;
            currentFill = hex;
        },
        getFill() {
            return currentFill;
        },
        setFill(fill) {
            currentFill = fill;
        },

        // Image registry
        registerImage(id, imageObj) {
            imageRegistry.set(id, imageObj);
        },
        getImageRegistry() {
            return imageRegistry;
        },

        // Operations
        paintCells(cells) {
            return batchPaintCells(cells, currentTool, gridData, currentFill);
        },
        fillAtCell(r, c) {
            return fillBucket(r, c, currentFill, gridData, config);
        },
        interpolateStroke(x0, y0, x1, y1) {
            return interpolateStroke(x0, y0, x1, y1, currentTool, config, triHeight, W_half);
        },
        processSubdivision(key, p, r, c, tool, color) {
            return processSubdivision(key, p, r, c, tool || currentTool, color || currentFill);
        },
        pickFromSubdivided(data, point, r, c) {
            return pickFromSubdivided(data, point, r, c);
        },
        subdivideCell(r, c) {
            const key = `${r},${c}`;
            const data = gridData[key];
            if (data && data.subdivided) return false;
            if (data && data.type === "image") return false;
            const base = (typeof data === "string" ? data : null) || null;
            gridData[key] = { subdivided: true, children: [base, base, base, base] };
            return true;
        },

        // Geometry delegates
        pixelToGrid(x, y) {
            return pixelToGrid(x, y, triHeight, W_half, config);
        },
        getTriangleCluster(r, c, size) {
            return getTriangleCluster(r, c, size !== undefined ? size : config.brushSize, config);
        },
        findBestCenter(r, c, size) {
            return findBestCenter(r, c, size !== undefined ? size : config.brushSize, config);
        },
        findBestCenterPixel(x, y, size) {
            return findBestCenterPixel(x, y, size !== undefined ? size : config.brushSize, config, triHeight, W_half);
        },
        getTriangleVertices(r, c) {
            return getTriangleVertices(r, c, triHeight, W_half);
        },
        getBarycentric,

        // Reset
        resetCanvas() {
            gridData = {};
            historyQueue = [];
            redoQueue = [];
        },
    };
}
