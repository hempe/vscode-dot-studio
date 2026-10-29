import * as path from 'path';
import { ProjectFileEditor as Xml } from '../../parsers/projectFileEditor';
import { pathKey } from './projectItems';

/** MSBuild's `%XX` escapes in an item's text */
export const unescapeMsbuild = (value: string) => value.replace(/%([0-9A-Fa-f]{2})/g, (_all, hex: string) => String.fromCharCode(parseInt(hex, 16)));

/** The file an Include written in the project file stands for */
export const resolveItem = (projectDir: string, value: string) =>
    path.resolve(projectDir, unescapeMsbuild(Xml.unescape(value)).trim().replace(/[\\/]/g, path.sep));

/** Whether two paths name the same file (case and separators as the file system treats them) */
export const sameFile = (a: string, b: string) => pathKey(path.normalize(a)) === pathKey(path.normalize(b));

/** Whether `relative` (from path.relative) points below the folder it is relative to */
export const isBelow = (relative: string) =>
    relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
