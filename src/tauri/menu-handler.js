import { listen } from '@tauri-apps/api/event';
import { isDirty, markDirty, markClean, setCurrentPath } from './state.js';
import { openFile, saveFile, saveFileAs } from './file-ops.js';
import { exportPNG, exportSVG } from './export-ops.js';

export async function initMenuHandler(engine) {
    await listen('menu-event', async (event) => {
        const action = event.payload;

        switch (action) {
            case 'new':
                if (isDirty()) {
                    const confirmed = confirm('You have unsaved changes. Start a new canvas anyway?');
                    if (!confirmed) return;
                }
                engine.resetCanvas();
                setCurrentPath(null);
                markClean();
                break;

            case 'open':
                await openFile(engine);
                break;

            case 'save':
                await saveFile(engine);
                break;

            case 'save-as':
                await saveFileAs(engine);
                break;

            case 'export-png':
                await exportPNG(engine);
                break;

            case 'export-svg':
                await exportSVG(engine);
                break;

            case 'undo':
                engine.undoAction();
                markDirty();
                break;

            case 'redo':
                engine.redoAction();
                markDirty();
                break;

            case 'zoom-in':
                engine.zoomIn();
                break;

            case 'zoom-out':
                engine.zoomOut();
                break;

            case 'zoom-reset':
                engine.resetZoom();
                break;
        }
    });
}
