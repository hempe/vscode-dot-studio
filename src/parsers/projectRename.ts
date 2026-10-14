import * as path from 'path';

// Text edits for renaming a project file, like Visual Studio's project rename: the solution entry keeps
// its GUID and solution folder, and other projects' references follow. Paths compare with `/`.

const normalize = (filePath: string) => filePath.replace(/\\/g, '/').toLowerCase();

/** Renames the project's entry in a .sln: its name and path; backslashes stay backslashes */
export function renameProjectInSln(content: string, oldRelativePath: string, newRelativePath: string, newName: string): string {
    const projectLine = /^(\s*Project\("\{[^}]+\}"\)\s*=\s*)"[^"]*",\s*"([^"]*)"(,\s*"\{[^}]+\}".*)$/gm;
    return content.replace(projectLine, (line, start: string, projectPath: string, rest: string) => {
        if (normalize(projectPath) !== normalize(oldRelativePath)) {
            return line;
        }
        const written = projectPath.includes('\\') ? newRelativePath.replace(/\//g, '\\') : newRelativePath;
        return `${start}"${newName}", "${written}"${rest}`;
    });
}

/** Renames the project's Path in a .slnx */
export function renameProjectInSlnx(content: string, oldRelativePath: string, newRelativePath: string): string {
    return content.replace(/(<Project\b[^>]*\bPath\s*=\s*")([^"]*)(")/g, (match, start: string, projectPath: string, end: string) =>
        normalize(projectPath) === normalize(oldRelativePath)
            ? `${start}${projectPath.includes('\\') ? newRelativePath.replace(/\//g, '\\') : newRelativePath}${end}`
            : match);
}

/** Points the ProjectReferences of a project (in `projectDir`) at the renamed project file, keeping their separators */
export function retargetProjectReferences(projectXml: string, projectDir: string, oldProjectPath: string, newProjectPath: string): string {
    return projectXml.replace(/(<ProjectReference\b[^>]*\bInclude\s*=\s*")([^"]*)(")/g, (match, start: string, include: string, end: string) => {
        if (normalize(path.resolve(projectDir, include.replace(/\\/g, '/'))) !== normalize(oldProjectPath)) {
            return match;
        }
        const renamed = include.replace(/[^\\/]+$/, path.basename(newProjectPath));
        return `${start}${renamed}${end}`;
    });
}
