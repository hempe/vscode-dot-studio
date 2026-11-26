import * as fs from 'fs';
import * as path from 'path';

interface Memento {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): Thenable<void>;
}

const KEY = 'shinobi.pendingOpen';

/** A solution or project file opened without a folder: the window reopens on its folder and opens that file there (global state, read once) */
export async function recordPendingOpen(state: Memento, folder: string, file: string): Promise<void> {
    await state.update(KEY, { folder: path.normalize(folder), file });
}

/** The file recorded for this folder, once; undefined for another folder or when the file is gone */
export async function takePendingOpen(state: Memento, folder: string): Promise<string | undefined> {
    const pending = state.get<{ folder: string; file: string }>(KEY);
    if (!pending || pending.folder !== path.normalize(folder)) {
        return undefined;
    }
    await state.update(KEY, undefined);
    return fs.existsSync(pending.file) ? pending.file : undefined;
}
