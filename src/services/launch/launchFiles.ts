import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../../core/logger';
import { parseJsonc, removeArrayItems, upsertArrayItem } from '../../core/jsonc';
import { platformProperty } from '../configurationManager/configurationManager';
import { EMIT_GENERATED_FILES } from '../analyzers';
import { Settings } from '../settings';
import { solutionWorkspaceFolder } from '../workspaceFolders';

const log = logger('launchFiles');

/** Whether launch.json exists and cannot be parsed (VS Code reads it tolerantly, we do not edit it then) */
export function launchJsonHasSyntaxErrors(launchJsonPath: string): boolean {
    return fs.existsSync(launchJsonPath) && parseJsonc(fs.readFileSync(launchJsonPath, 'utf8')).errors.length > 0;
}

/** Whether launch.json starts a multi-project profile (the "Startup" compound) */
export function hasStartupProfileConfiguration(): boolean {
    const workspacePath = solutionWorkspaceFolder()?.uri.fsPath;
    return !!workspacePath && !!readStartupCompound(path.join(workspacePath, '.vscode', 'launch.json'));
}

/** Removes the "Startup" compound and the configurations it lists; a launch.json without it is left alone */
export function removeStartupProfileConfiguration(launchJsonPath = path.join(solutionWorkspaceFolder()?.uri.fsPath ?? '', '.vscode', 'launch.json')): void {
    if (!readStartupCompound(launchJsonPath)) {
        return;
    }
    const original = fs.readFileSync(launchJsonPath, 'utf8');
    const names = compoundConfigurationNames(parseJsonc(original).value);
    // Only the configurations we wrote (hidden entries of the compound): a user's own "Startup" compound lists the
    // user's own configurations, which stay
    const text = removeArrayItems(
        removeArrayItems(original, 'compounds', (item: any) => item?.name === 'Startup'),
        'configurations', (config: any) => names.includes(config?.name) && config?.presentation?.hidden === true);
    log.info(`Removing the startup profile from ${launchJsonPath}`);
    fs.writeFileSync(launchJsonPath, text, 'utf8');
}

/** The configuration names the "Startup" compound of a parsed launch.json lists */
export function compoundConfigurationNames(launchJson: any): string[] {
    const compound = Array.isArray(launchJson?.compounds) ? launchJson.compounds.find((item: any) => item?.name === 'Startup') : undefined;
    return Array.isArray(compound?.configurations)
        ? compound.configurations.map((item: any) => typeof item === 'string' ? item : item?.name).filter((name: unknown) => typeof name === 'string')
        : [];
}

/** The "Startup" compound of launch.json, if any (undefined too when the file has syntax errors) */
export function readStartupCompound(launchJsonPath: string): any {
    if (!fs.existsSync(launchJsonPath)) {
        return undefined;
    }
    const { value, errors } = parseJsonc(fs.readFileSync(launchJsonPath, 'utf8'));
    return errors.length > 0 || !Array.isArray(value?.compounds)
        ? undefined
        : value.compounds.find((item: any) => item?.name === 'Startup');
}

/**
 * Updates tasks.json with the StartupPreBuild task
 */
export async function updateTasksJson(tasksJsonPath: string, projectPath: string, configuration: string, framework?: string | undefined, platform?: string): Promise<void> {
    try {
        // Create the StartupPreBuild task
        const prebuildTask = {
            label: 'StartupPreBuild',
            command: 'dotnet',
            type: 'process',
            args: [
                'build',
                projectPath,
                ...(framework ? ['--framework', framework] : []),
                '--configuration', configuration,
                ...platformProperty(platform),
                '/property:GenerateFullPaths=true',
                '/consoleloggerparameters:NoSummary',
                ...(Settings.emitGeneratedFiles() ? [EMIT_GENERATED_FILES] : [])
            ],
            presentation: {
                reveal: 'silent'
            },
            problemMatcher: '$msCompile'
        };

        upsertJsoncArrayItem(
            tasksJsonPath,
            { version: '2.0.0', tasks: [] },
            'tasks',
            (task: any) => task?.label === 'StartupPreBuild',
            prebuildTask,
            'last'
        );
    } catch (error) {
        log.error('Error updating tasks.json:', error);
    }
}

/**
 * Writes `item` into the array `arrayKey` of a launch.json/tasks.json-style file, replacing the entry
 * matched by `isMatch`. Comments and all other content are kept; a file with syntax errors is left alone.
 */
export function upsertJsoncArrayItem(
    filePath: string,
    emptyFile: Record<string, unknown>,
    arrayKey: string,
    isMatch: (item: any) => boolean,
    item: unknown,
    position: 'first' | 'last'
): void {
    const fileName = path.basename(filePath);

    if (!fs.existsSync(filePath)) {
        log.info(`Creating ${filePath}`);
        fs.writeFileSync(filePath, JSON.stringify({ ...emptyFile, [arrayKey]: [item] }, null, 4) + '\n', 'utf8');
        return;
    }

    const text = fs.readFileSync(filePath, 'utf8');
    const { errors } = parseJsonc(text);
    if (errors.length > 0) {
        log.error(`Not updating ${filePath}, it has syntax errors:`, errors);
        vscode.window.showWarningMessage(`.vscode/${fileName} has syntax errors and was not updated. Fix them and select the startup project again.`);
        return;
    }

    const updated = upsertArrayItem(text, arrayKey, isMatch, item, position);
    if (updated === text) {
        log.info(`${fileName} already up to date`);
        return;
    }

    log.info(`Writing ${filePath}`);
    fs.writeFileSync(filePath, updated, 'utf8');
}

/** The "Startup" configuration currently in launch.json, if any */
export function readStartupConfig(launchJsonPath: string): any {
    if (!fs.existsSync(launchJsonPath)) {
        return undefined;
    }
    const { value } = parseJsonc(fs.readFileSync(launchJsonPath, 'utf8'));
    return value?.configurations?.find((config: any) => config?.name === 'Startup');
}
