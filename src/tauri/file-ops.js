import { open, save, message } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { getCurrentPath, setCurrentPath, markClean, getPalette, setPalette } from './state.js';
import { stateToEngineConfig, isFileFormatConfig, engineConfigToState } from '../core/config-utils.js';

export async function openFile(engine) {
    const path = await open({
        filters: [{ name: 'TrKixel Canvas', extensions: ['json'] }],
        multiple: false,
    });
    if (!path) return;

    let content;
    try {
        content = await readTextFile(path);
    } catch (err) {
        await message(`Could not read file: ${err}`, { title: 'Open Failed', kind: 'error' });
        return;
    }

    let state;
    try {
        state = JSON.parse(content);
        if (!state || typeof state !== 'object' || !state.gridData) {
            throw new Error('Missing required fields (gridData)');
        }
    } catch (err) {
        await message(`Invalid TrKixel file: ${err.message}`, { title: 'Open Failed', kind: 'error' });
        return;
    }

    if (isFileFormatConfig(state.config)) {
        state.config = stateToEngineConfig(state);
    }
    engine.loadState(state);
    setPalette(state.palette);
    setCurrentPath(path);
    markClean();
}

export async function saveFile(engine) {
    const path = getCurrentPath();
    if (!path) {
        return saveFileAs(engine);
    }
    const state = engine.getState();
    state.config = engineConfigToState(state.config);
    state.palette = getPalette();
    try {
        await writeTextFile(path, JSON.stringify(state, null, 2));
    } catch (err) {
        await message(`Could not save file: ${err}`, { title: 'Save Failed', kind: 'error' });
        return;
    }
    markClean();
}

export async function saveFileAs(engine) {
    const path = await save({
        filters: [{ name: 'TrKixel Canvas', extensions: ['json'] }],
        defaultPath: 'untitled.trkixel.json',
    });
    if (!path) return;

    const state = engine.getState();
    state.config = engineConfigToState(state.config);
    state.palette = getPalette();
    try {
        await writeTextFile(path, JSON.stringify(state, null, 2));
    } catch (err) {
        await message(`Could not save file: ${err}`, { title: 'Save Failed', kind: 'error' });
        return;
    }
    setCurrentPath(path);
    markClean();
}
