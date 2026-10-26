const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * Why `name` cannot be the name of a file or folder created or renamed from the Solution Explorer, or undefined when it
 * can. Strict on every system (like Visual Studio) so a solution made on Linux or macOS also opens on Windows, and a
 * name never leaves the folder it is typed for.
 */
export function itemNameProblem(name: string): string | undefined {
    if (!name.trim()) {
        return 'The name is empty.';
    }
    if (name === '.' || name === '..') {
        return `"${name}" is not a valid name.`;
    }
    if (/[\\/]/.test(name)) {
        return 'A name cannot contain / or \\.';
    }
    if (/[<>:"|?*\u0000-\u001f]/.test(name)) {
        return 'A name cannot contain any of the characters < > : " | ? *.';
    }
    if (/[. ]$/.test(name)) {
        return 'A name cannot end with a dot or a space.';
    }
    if (RESERVED.test(name)) {
        return `"${name}" is a reserved name on Windows.`;
    }
    return undefined;
}
