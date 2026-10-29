import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../core/logger';
import { Settings } from '../shared/settings';

const execFileAsync = promisify(execFile);
const log = logger('SlnxMigration');

const DECLINED_KEY = 'shinobi.slnxMigration.declined';

/** Where "Don't Ask Again" is remembered: per workspace, per solution file */
export class SlnxMigration {
    private static state: vscode.Memento | undefined;

    static initialize(state: vscode.Memento): void {
        this.state = state;
    }

    static isDeclined(solutionPath: string): boolean {
        return (this.state?.get<string[]>(DECLINED_KEY, []) ?? []).includes(solutionPath);
    }

    static async decline(solutionPath: string): Promise<void> {
        await this.state?.update(DECLINED_KEY, [...(this.state.get<string[]>(DECLINED_KEY, []) ?? []), solutionPath]);
    }
}

export interface SlnxMigrationDeps {
    /** Writes the .slnx next to the .sln (`dotnet sln migrate`) */
    migrate(solutionPath: string): Promise<void>;
    /** Opens a solution in the Solution Explorer */
    open(solutionPath: string): Promise<void>;
}

const migrateWithDotnet = async (solutionPath: string) => {
    await execFileAsync('dotnet', ['sln', solutionPath, 'migrate'], { cwd: path.dirname(solutionPath), timeout: 60000 });
};

/**
 * .slnx is the current solution format (the default since the .NET 10 SDK): offers to convert a .sln with
 * `dotnet sln migrate`, then to delete the .sln, and opens the .slnx
 */
export async function offerSlnxMigration(solutionPath: string, deps: Partial<SlnxMigrationDeps> & Pick<SlnxMigrationDeps, 'open'>): Promise<void> {
    const migrate = deps.migrate ?? migrateWithDotnet;
    if (path.extname(solutionPath).toLowerCase() !== '.sln' || SlnxMigration.isDeclined(solutionPath) || !Settings.offerSlnxConversion()) {
        return;
    }
    const slnxPath = solutionPath.replace(/\.sln$/i, '.slnx');
    if (fs.existsSync(slnxPath)) {
        return;
    }

    const name = path.basename(solutionPath);
    const convert = 'Convert';
    const notNow = 'Not Now';
    const never = "Don't Ask Again";
    const choice = await vscode.window.showInformationMessage(
        `${name} uses the old solution format. Convert it to .slnx, the format of Visual Studio 2022 17.13 and later and the .NET 10 SDK?`,
        convert, notNow, never);
    if (choice === never) {
        await SlnxMigration.decline(solutionPath);
    }
    if (choice !== convert) {
        return;
    }

    try {
        await migrate(solutionPath);
    } catch (error) {
        log.error(`Converting ${solutionPath} failed:`, error);
        const reason = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Converting ${name} failed (dotnet sln migrate needs the .NET SDK 9.0.200 or later): ${reason}`);
        return;
    }

    const remove = `Delete ${name}`;
    const keep = 'Keep Both';
    const answer = await vscode.window.showWarningMessage(
        `Created ${path.basename(slnxPath)}. Delete ${name}? Teammates on older Visual Studio versions (before 2022 17.13) still need it; ` +
        'with both files you are asked which solution to open each time.',
        { modal: true }, remove, keep);
    if (answer === remove) {
        await fs.promises.rm(solutionPath, { force: true });
    }
    await deps.open(slnxPath);
}
