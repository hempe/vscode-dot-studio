import * as fs from 'fs';
import * as path from 'path';

/**
 * "Add Existing Item...": copies the files into the folder, as Visual Studio does. SDK-style projects
 * include files by their location, so the copy is all it takes. A file of the same name is only replaced
 * when `confirmReplace` agrees; files that already are in the folder stay as they are.
 * Returns the paths of the files that are now in the folder.
 */
export async function copyExistingItems(
    files: readonly string[],
    targetDir: string,
    confirmReplace: (fileName: string) => Promise<boolean>
): Promise<string[]> {
    const added: string[] = [];
    for (const file of files) {
        const fileName = path.basename(file);
        const destination = path.join(targetDir, fileName);
        if (path.resolve(file) === path.resolve(destination)) {
            added.push(destination);
            continue;
        }
        if (fs.existsSync(destination) && !await confirmReplace(fileName)) {
            continue;
        }
        await fs.promises.copyFile(file, destination);
        added.push(destination);
    }
    return added;
}
