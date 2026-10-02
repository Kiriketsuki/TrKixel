import { save, message } from '@tauri-apps/plugin-dialog';
import { writeFile, writeTextFile } from '@tauri-apps/plugin-fs';

export async function exportPNG(engine) {
    const path = await save({
        filters: [{ name: 'PNG Image', extensions: ['png'] }],
        defaultPath: 'trkixel.png',
    });
    if (!path) return;

    const blob = await engine.exportImageAsBlob();
    const arrayBuffer = await blob.arrayBuffer();
    try {
        await writeFile(path, new Uint8Array(arrayBuffer));
    } catch (err) {
        await message(`Could not export PNG: ${err}`, { title: 'Export Failed', kind: 'error' });
    }
}

export async function exportSVG(engine) {
    const path = await save({
        filters: [{ name: 'SVG Image', extensions: ['svg'] }],
        defaultPath: 'trkixel.svg',
    });
    if (!path) return;

    const svgString = engine.exportSVGAsString();
    try {
        await writeTextFile(path, svgString);
    } catch (err) {
        await message(`Could not export SVG: ${err}`, { title: 'Export Failed', kind: 'error' });
    }
}
