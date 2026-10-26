import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Whether another user can change the folder (writable by group or others, or owned by someone else): not safe to run files from */
export function writableByOthers(folder: string): boolean {
    if (process.platform === 'win32') {
        return false;
    }
    const stat = fs.statSync(folder);
    return (stat.mode & 0o022) !== 0 || (typeof process.getuid === 'function' && stat.uid !== process.getuid());
}

/**
 * A folder in the shared temp folder that only this user can use: named after the user, mode 700, and refused when it
 * exists but somebody else can write to it (a planted folder or link would let them choose what we write or run)
 */
export function privateTempDir(...parts: string[]): string {
    const root = path.join(os.tmpdir(), `shinobi-dotnet-${os.userInfo().username}`);
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    if (writableByOthers(root)) {
        throw new Error(`${root} can be changed by other users; remove it and try again`);
    }
    const dir = path.join(root, ...parts);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
}
