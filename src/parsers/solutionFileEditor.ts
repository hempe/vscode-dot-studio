import { PROJECT_TYPE_GUIDS } from '../types/solution';
import { logger } from '../core/logger';

const log = logger('SolutionFileEditor');

/**
 * Line-based edits of a .sln file's text (the counterpart of SolutionXFileEditor for .slnx): each takes the lines of
 * the file and returns the new lines. Pure: no file access, no solution model.
 */
export class SolutionFileEditor {
    /**
     * Adds a nested project entry to the NestedProjects section
     */
    static addNestedProjectEntry(lines: string[], childGuid: string, parentGuid: string): string[] {
        const nestedEntry = `\t\t${childGuid} = ${parentGuid}`;

        // Find existing NestedProjects section
        let nestedProjectsStartIndex = -1;
        let nestedProjectsEndIndex = -1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line === 'GlobalSection(NestedProjects) = preSolution') {
                nestedProjectsStartIndex = i;
            } else if (nestedProjectsStartIndex !== -1 && line === 'EndGlobalSection') {
                nestedProjectsEndIndex = i;
                break;
            }
        }

        if (nestedProjectsStartIndex !== -1) {
            // NestedProjects section exists, add our entry before EndGlobalSection
            return [
                ...lines.slice(0, nestedProjectsEndIndex),
                nestedEntry,
                ...lines.slice(nestedProjectsEndIndex)
            ];
        } else {
            // No NestedProjects section exists, create it before EndGlobal
            let endGlobalIndex = -1;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].trim() === 'EndGlobal') {
                    endGlobalIndex = i;
                    break;
                }
            }

            if (endGlobalIndex !== -1) {
                return [
                    ...lines.slice(0, endGlobalIndex),
                    '\tGlobalSection(NestedProjects) = preSolution',
                    nestedEntry,
                    '\tEndGlobalSection',
                    ...lines.slice(endGlobalIndex)
                ];
            } else {
                // No EndGlobal found, append at the end
                return [
                    ...lines,
                    'Global',
                    '\tGlobalSection(NestedProjects) = preSolution',
                    nestedEntry,
                    '\tEndGlobalSection',
                    'EndGlobal'
                ];
            }
        }
    }

    /**
     * Points the child's `NestedProjects` entry at `parentGuid`, or removes it (the solution root); a section left
     * empty goes too, as Visual Studio writes none
     */
    static setNestedParent(lines: string[], childGuid: string, parentGuid: string | undefined): string[] {
        const start = lines.findIndex(line => line.trim() === 'GlobalSection(NestedProjects) = preSolution');
        const end = start === -1 ? -1 : lines.findIndex((line, i) => i > start && line.trim() === 'EndGlobalSection');
        const entry = end === -1 ? -1 : lines.findIndex((line, i) => i > start && i < end
            && line.split('=')[0].trim().toUpperCase() === childGuid.toUpperCase());
        if (entry === -1) {
            return parentGuid ? SolutionFileEditor.addNestedProjectEntry(lines, childGuid, parentGuid) : lines;
        }
        if (parentGuid) {
            return lines.map((line, i) => i === entry ? line.replace(/=\s*\{[^}]*\}\s*$/, `= ${parentGuid}`) : line);
        }
        const without = lines.filter((_, i) => i !== entry);
        // Only the section's first and last line are left
        return end - start === 2 ? without.filter((_, i) => i !== start && i !== start + 1) : without;
    }

    /** The `Project(...)` line and the `EndProject` line of a solution folder */
    static solutionFolderBlock(lines: string[], folderGuid: string): { start: number; end: number } {
        const start = lines.findIndex(line => line.trim().startsWith(`Project("${PROJECT_TYPE_GUIDS.SOLUTION_FOLDER}")`)
            && line.toUpperCase().includes(folderGuid.toUpperCase()));
        const end = start === -1 ? -1 : lines.findIndex((line, i) => i > start && line.trim() === 'EndProject');
        if (end === -1) {
            throw new Error(`Could not find the block of solution folder "${folderGuid}"`);
        }
        return { start, end };
    }

    /**
     * Moves a solution item's line from one solution folder's `ProjectSection(SolutionItems)` to another's, keeping its
     * text (Visual Studio writes `\`); a section left empty goes
     */
    static moveSolutionItemLines(lines: string[], fromGuid: string, toGuid: string, itemPath: string): string[] {
        const block = SolutionFileEditor.solutionFolderBlock(lines, fromGuid);
        const key = (text: string) => text.replace(/\\/g, '/').toLowerCase();
        const index = lines.findIndex((line, i) => i > block.start && i < block.end && line.includes('=')
            && key(line.split('=')[0].trim()) === key(itemPath));
        if (index === -1) {
            throw new Error(`Solution item "${itemPath}" not found in its solution folder`);
        }
        const item = lines[index].split('=')[0].trim();
        let without = lines.filter((_, i) => i !== index);
        if (without[index - 1]?.trim() === 'ProjectSection(SolutionItems) = preProject' && without[index]?.trim() === 'EndProjectSection') {
            without = without.filter((_, i) => i !== index - 1 && i !== index);
        }
        return SolutionFileEditor.addSolutionItemToFolder(without, toGuid, item);
    }

    /**
     * Removes a solution folder Project/EndProject block from the solution file lines
     */
    static removeSolutionFolderProject(lines: string[], folderName: string, folderGuid: string): string[] {
        const solutionFolderTypeGuid = '{2150E333-8FDC-42A3-9474-1A3956D46DE8}';
        let startIndex = -1;
        let endIndex = -1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Look for the Project line for this solution folder
            if (line.includes(`Project("${solutionFolderTypeGuid}")`) &&
                line.includes(`"${folderName}"`) &&
                line.toLowerCase().includes(folderGuid.toLowerCase())) {
                startIndex = i;
            }

            // Look for the corresponding EndProject line
            if (startIndex !== -1 && line === 'EndProject') {
                endIndex = i;
                break;
            }
        }

        if (startIndex !== -1 && endIndex !== -1) {
            // Remove the Project/EndProject block
            return [
                ...lines.slice(0, startIndex),
                ...lines.slice(endIndex + 1)
            ];
        }

        return lines;
    }

    /**
     * Removes a project by its GUID from the solution file lines
     */
    static removeProjectByGuid(lines: string[], projectGuid: string): string[] {
        let startIndex = -1;
        let endIndex = -1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Look for the Project line that contains this GUID
            if (line.startsWith('Project(') && line.toLowerCase().includes(projectGuid.toLowerCase())) {
                startIndex = i;
            }

            // Look for the corresponding EndProject line
            if (startIndex !== -1 && line === 'EndProject') {
                endIndex = i;
                break;
            }
        }

        if (startIndex !== -1 && endIndex !== -1) {
            // Remove the Project/EndProject block
            return [
                ...lines.slice(0, startIndex),
                ...lines.slice(endIndex + 1)
            ];
        }

        return lines;
    }

    /**
     * Removes the project's lines of the ProjectConfigurationPlatforms section
     */
    static removeProjectConfigurationLines(lines: string[], projectGuid: string): string[] {
        const prefix = `${projectGuid.toLowerCase()}.`;
        let inSection = false;
        return lines.filter(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith('GlobalSection(ProjectConfigurationPlatforms)')) {
                inSection = true;
            } else if (trimmed === 'EndGlobalSection') {
                inSection = false;
            } else if (inSection && trimmed.toLowerCase().startsWith(prefix)) {
                return false;
            }
            return true;
        });
    }

    /**
     * Removes all NestedProjects entries that reference the given folder GUID
     */
    static removeNestedProjectEntries(lines: string[], folderGuid: string): string[] {
        // Find NestedProjects section
        let nestedProjectsStartIndex = -1;
        let nestedProjectsEndIndex = -1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line === 'GlobalSection(NestedProjects) = preSolution') {
                nestedProjectsStartIndex = i;
            } else if (nestedProjectsStartIndex !== -1 && line === 'EndGlobalSection') {
                nestedProjectsEndIndex = i;
                break;
            }
        }

        if (nestedProjectsStartIndex === -1 || nestedProjectsEndIndex === -1) {
            // No NestedProjects section found
            return lines;
        }

        // Filter out entries that reference the folder GUID (as parent or child)
        const newLines = [...lines];
        const entriesToRemove: number[] = [];

        for (let i = nestedProjectsStartIndex + 1; i < nestedProjectsEndIndex; i++) {
            const line = lines[i];
            if (line.toLowerCase().includes(folderGuid.toLowerCase())) {
                entriesToRemove.push(i);
            }
        }

        // Remove entries in reverse order to maintain indices
        for (let i = entriesToRemove.length - 1; i >= 0; i--) {
            newLines.splice(entriesToRemove[i], 1);
        }

        return newLines;
    }

    /**
     * Adds a solution item to a solution folder's Project block
     */
    static addSolutionItemToFolder(lines: string[], folderGuid: string, relativePath: string): string[] {
        const solutionFolderTypeGuid = '{2150E333-8FDC-42A3-9474-1A3956D46DE8}';
        let projectStartIndex = -1;
        let projectEndIndex = -1;

        // Find the Project/EndProject block for this solution folder
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Look for the Project line for this solution folder
            if (line.includes(`Project("${solutionFolderTypeGuid}")`) &&
                line.includes(folderGuid)) {
                projectStartIndex = i;
            }

            // Look for the corresponding EndProject line
            if (projectStartIndex !== -1 && line === 'EndProject') {
                projectEndIndex = i;
                break;
            }
        }

        if (projectStartIndex === -1 || projectEndIndex === -1) {
            throw new Error(`Could not find Project block for solution folder "${folderGuid}"`);
        }

        // Check if there are already ProjectSection(SolutionItems) in this folder
        let solutionItemsStartIndex = -1;
        let solutionItemsEndIndex = -1;

        for (let i = projectStartIndex + 1; i < projectEndIndex; i++) {
            const line = lines[i].trim();
            if (line === 'ProjectSection(SolutionItems) = preProject') {
                solutionItemsStartIndex = i;
            } else if (solutionItemsStartIndex !== -1 && line === 'EndProjectSection') {
                solutionItemsEndIndex = i;
                break;
            }
        }

        const newLines = [...lines];

        if (solutionItemsStartIndex !== -1 && solutionItemsEndIndex !== -1) {
            // ProjectSection exists, add the item to it
            const itemLine = `\t\t${relativePath} = ${relativePath}`;
            newLines.splice(solutionItemsEndIndex, 0, itemLine);
        } else {
            // No ProjectSection exists, create one with the item
            const sectionLines = [
                '\tProjectSection(SolutionItems) = preProject',
                `\t\t${relativePath} = ${relativePath}`,
                '\tEndProjectSection'
            ];

            // Insert before EndProject
            newLines.splice(projectEndIndex, 0, ...sectionLines);
        }

        return newLines;
    }

    static removeSolutionItemFromFile(lines: string[], relativePath: string): string[] {
        const newLines = [...lines];
        let removedItemIndex = -1;

        // Find and remove the specific solution item line
        for (let i = 0; i < newLines.length; i++) {
            const line = newLines[i].trim();
            // The item line is `path = path` and Visual Studio writes the path with backslashes
            const key = (text: string) => text.replace(/\\/g, '/').toLowerCase();
            const [left, right] = line.split(' = ');
            if (right !== undefined && key(left) === key(relativePath) && key(right) === key(relativePath)) {
                removedItemIndex = i;
                newLines.splice(i, 1);
                break;
            }
        }

        if (removedItemIndex === -1) {
            log.warn(`Solution item "${relativePath}" not found in solution file`);
            return newLines;
        }

        // Check if the ProjectSection(SolutionItems) is now empty and remove it if so
        // Find the ProjectSection that contained this item
        let sectionStartIndex = -1;
        let sectionEndIndex = -1;

        // Search backwards from where the item was to find the section start
        for (let i = removedItemIndex - 1; i >= 0; i--) {
            const line = newLines[i].trim();
            if (line === 'ProjectSection(SolutionItems) = preProject') {
                sectionStartIndex = i;
                break;
            } else if (line === 'EndProject' || line.startsWith('Project(')) {
                // We've gone too far back
                break;
            }
        }

        // Search forwards from where the item was to find the section end
        if (sectionStartIndex !== -1) {
            for (let i = removedItemIndex; i < newLines.length; i++) {
                const line = newLines[i].trim();
                if (line === 'EndProjectSection') {
                    sectionEndIndex = i;
                    break;
                } else if (line === 'EndProject' || line.startsWith('Project(')) {
                    // We've gone too far forward
                    break;
                }
            }
        }

        // If we found the section boundaries, check if it's empty and remove it
        if (sectionStartIndex !== -1 && sectionEndIndex !== -1) {
            let hasItems = false;
            for (let i = sectionStartIndex + 1; i < sectionEndIndex; i++) {
                const line = newLines[i].trim();
                if (line.includes(' = ') && !line.startsWith('ProjectSection') && !line.startsWith('EndProjectSection')) {
                    hasItems = true;
                    break;
                }
            }

            // If no items remain in the section, remove the entire section
            if (!hasItems) {
                newLines.splice(sectionStartIndex, sectionEndIndex - sectionStartIndex + 1);
            }
        }

        return newLines;
    }
}
