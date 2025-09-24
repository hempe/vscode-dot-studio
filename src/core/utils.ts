import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class PathUtils {
    /**
     * Extracts file system path from VS Code URI or SolutionItem
     */
    static getPathFromItem(item: unknown, actionName: string): string | null {
        if (item instanceof vscode.Uri) {
            return item.fsPath;
        } else if (item && typeof item === 'object' && 'resourceUri' in item && item.resourceUri instanceof vscode.Uri) {
            return item.resourceUri.fsPath;
        } else {
            vscode.window.showErrorMessage(`Cannot ${actionName}: no valid path found`);
            return null;
        }
    }

    /**
     * Gets project name from project file path (removes extension)
     */
    static getProjectName(projectPath: string): string {
        return path.basename(projectPath, path.extname(projectPath));
    }

    /**
     * Ensures the target path is a directory, converting file paths to their parent directory
     */
    static ensureDirectory(targetPath: string): string {
        if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
            return path.dirname(targetPath);
        }
        return targetPath;
    }

    /**
     * Normalizes path separators for cross-platform compatibility
     */
    static normalizePath(filePath: string): string {
        return filePath.replace(/\\/g, '/');
    }

    /**
     * Gets relative path from solution directory
     */
    static getRelativePath(solutionDir: string, filePath: string): string {
        return path.relative(solutionDir, filePath).replace(/\\/g, '/');
    }
}

export class ValidationUtils {
    /**
     * Creates a name validator function for input boxes
     */
    static createNameValidator(itemType: string, allowSpaces: boolean = true): (value: string) => string | null {
        return (value: string) => {
            if (!value || value.trim() === '') {
                return `${itemType} name cannot be empty`;
            }
            if (value.includes('/') || value.includes('\\')) {
                return `${itemType} name cannot contain path separators`;
            }
            if (!allowSpaces && value.includes(' ')) {
                return `${itemType} name cannot contain spaces`;
            }
            // Additional validation for file names
            if (itemType.toLowerCase().includes('file') || itemType.toLowerCase().includes('folder')) {
                const invalidChars = /[<>:"|?*]/;
                if (invalidChars.test(value)) {
                    return `${itemType} name contains invalid characters`;
                }
            }
            return null;
        };
    }

    /**
     * Validates if a path exists and is accessible
     */
    static async validatePath(filePath: string): Promise<boolean> {
        try {
            await fs.promises.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Validates if a path is a valid project file
     */
    static isProjectFile(filePath: string): boolean {
        return /\.(csproj|vbproj|fsproj)$/.test(filePath);
    }

    /**
     * Validates if a path is a solution file
     */
    static isSolutionFile(filePath: string): boolean {
        return filePath.endsWith('.sln');
    }
}

export class TerminalUtils {
    /**
     * Creates and shows a terminal with optional command execution
     */
    static createAndShow(name: string, cwd: string, command?: string): vscode.Terminal {
        const terminal = vscode.window.createTerminal({ name, cwd });
        if (command) {
            terminal.sendText(command);
        }
        terminal.show();
        return terminal;
    }

    /**
     * Creates a terminal for dotnet operations
     */
    static createDotnetTerminal(operation: string, projectPath: string, command?: string): vscode.Terminal {
        const projectName = PathUtils.getProjectName(projectPath);
        const projectDir = path.dirname(projectPath);
        const terminalName = `${operation} - ${projectName}`;

        return this.createAndShow(terminalName, projectDir, command);
    }
}

export class ErrorUtils {
    /**
     * Shows error message with optional error details
     */
    static showError(message: string, error?: Error | unknown): void {
        const errorMsg = error ? `${message}: ${error}` : message;
        vscode.window.showErrorMessage(errorMsg);
        console.error(errorMsg, error);
    }

    /**
     * Shows warning message
     */
    static showWarning(message: string): void {
        vscode.window.showWarningMessage(message);
        console.warn(message);
    }

    /**
     * Shows info message
     */
    static showInfo(message: string): void {
        vscode.window.showInformationMessage(message);
        console.info(message);
    }
}

export class FileSystemUtils {
    /**
     * Gets files in directory with optional filtering
     */
    static async getFiles(dirPath: string, filterExtensions?: string[]): Promise<string[]> {
        try {
            const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
            return entries
                .filter(entry => entry.isFile())
                .map(entry => entry.name)
                .filter(name => {
                    if (!filterExtensions) return true;
                    return filterExtensions.some(ext => name.endsWith(ext));
                });
        } catch (error) {
            console.error(`Error reading directory ${dirPath}:`, error);
            return [];
        }
    }

    /**
     * Gets directories in path with optional filtering
     */
    static async getDirectories(dirPath: string, skipDirs?: string[]): Promise<string[]> {
        try {
            const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
            return entries
                .filter(entry => entry.isDirectory())
                .map(entry => entry.name)
                .filter(name => !skipDirs?.includes(name));
        } catch (error) {
            console.error(`Error reading directories in ${dirPath}:`, error);
            return [];
        }
    }

    /**
     * Recursively finds files with specific extensions
     */
    static async findFiles(rootPath: string, extensions: string[], maxDepth: number = 10): Promise<string[]> {
        const results: string[] = [];

        const searchDirectory = async (dirPath: string, depth: number) => {
            if (depth > maxDepth) return;

            try {
                const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

                for (const entry of entries) {
                    const fullPath = path.join(dirPath, entry.name);

                    if (entry.isFile()) {
                        if (extensions.some(ext => entry.name.endsWith(ext))) {
                            results.push(fullPath);
                        }
                    } else if (entry.isDirectory()) {
                        // Skip common directories that shouldn't be searched
                        const skipDirs = ['bin', 'obj', 'node_modules', '.git', '.vs', '.vscode'];
                        if (!skipDirs.includes(entry.name)) {
                            await searchDirectory(fullPath, depth + 1);
                        }
                    }
                }
            } catch (error) {
                console.error(`Error searching directory ${dirPath}:`, error);
            }
        };

        await searchDirectory(rootPath, 0);
        return results;
    }

    /**
     * Ensures a directory exists, creating it if necessary
     */
    static async ensureDirectoryExists(dirPath: string): Promise<void> {
        try {
            await fs.promises.access(dirPath);
        } catch {
            await fs.promises.mkdir(dirPath, { recursive: true });
        }
    }

    /**
     * Generates unique file name if file already exists
     */
    static generateUniqueFileName(dirPath: string, baseName: string, extension: string): string {
        let counter = 1;
        let fileName = `${baseName}${extension}`;
        let fullPath = path.join(dirPath, fileName);

        while (fs.existsSync(fullPath)) {
            fileName = `${baseName}${counter}${extension}`;
            fullPath = path.join(dirPath, fileName);
            counter++;
        }

        return fileName;
    }
}

export class InputUtils {
    /**
     * Shows input box with common configuration
     */
    static async showInputBox(
        prompt: string,
        placeholder?: string,
        validator?: (value: string) => string | null
    ): Promise<string | undefined> {
        return vscode.window.showInputBox({
            prompt,
            placeHolder: placeholder,
            validateInput: validator
        });
    }

    /**
     * Shows quick pick with common configuration
     */
    static async showQuickPick<T extends vscode.QuickPickItem>(
        items: T[],
        placeholder?: string,
        canPickMany: boolean = false
    ): Promise<T | T[] | undefined> {
        return vscode.window.showQuickPick(items, {
            placeHolder: placeholder,
            canPickMany
        }) as Promise<T | T[] | undefined>;
    }
}