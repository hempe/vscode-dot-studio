import * as vscode from 'vscode';
import { logger } from '../core/logger';

const log = logger('CSharpExtensionCheck');

/**
 * C# extensions that provide the `coreclr` debugger and the C# language server.
 * Either one works; package.json can't express "one of", so this is checked at runtime.
 */
export const CSHARP_EXTENSIONS = {
    /** Microsoft's, only licensed for Microsoft VS Code (no subscription needed) */
    microsoft: 'ms-dotnettools.csharp',
    /** Open source fork with netcoredbg, available on Open VSX (VSCodium, Cursor, ...) */
    openSource: 'muhammad-sammy.csharp',
} as const;

const DISMISSED_KEY = 'shinobi.csharpExtensionCheck.dismissed';

export function hasCSharpExtension(): boolean {
    return Object.values(CSHARP_EXTENSIONS).some(id => vscode.extensions.getExtension(id) !== undefined);
}

/** The extension to suggest: Microsoft's in VS Code, the open source one in other editors */
export function recommendedCSharpExtension(): string {
    return vscode.env.uriScheme === 'vscode' || vscode.env.uriScheme === 'vscode-insiders'
        ? CSHARP_EXTENSIONS.microsoft
        : CSHARP_EXTENSIONS.openSource;
}

/** Warns (once, until dismissed) when no C# extension is installed and offers to install one */
export async function checkCSharpExtension(context: vscode.ExtensionContext): Promise<void> {
    if (hasCSharpExtension() || context.globalState.get<boolean>(DISMISSED_KEY)) {
        return;
    }

    const id = recommendedCSharpExtension();
    log.info(`No C# extension installed, recommending ${id}`);

    const install = `Install ${id}`;
    const dismiss = "Don't Show Again";
    const choice = await vscode.window.showWarningMessage(
        'A C# extension is needed to debug projects and update namespaces. ' +
        `Install ${CSHARP_EXTENSIONS.microsoft} or ${CSHARP_EXTENSIONS.openSource}.`,
        install,
        dismiss
    );

    if (choice === install) {
        await vscode.commands.executeCommand('workbench.extensions.installExtension', id);
    } else if (choice === dismiss) {
        await context.globalState.update(DISMISSED_KEY, true);
    }
}

/** Solutions already warned about in this window */
const omniSharpWarnedFor = new Set<string>();

/**
 * OmniSharp (muhammad-sammy.csharp's own default) cannot load .slnx files. package.json makes the
 * Roslyn language server the default (`configurationDefaults`), so this only fires when OmniSharp was
 * chosen in the settings; it offers to switch the workspace to Roslyn, which ships with the same extension.
 */
export async function checkOmniSharpForSlnx(solutionPath: string): Promise<void> {
    if (!solutionPath.toLowerCase().endsWith('.slnx') || omniSharpWarnedFor.has(solutionPath)) {
        return;
    }

    const config = vscode.workspace.getConfiguration('dotnet');
    // undefined without a C# extension, false for Microsoft's (Roslyn is its default)
    if (config.get<boolean>('server.useOmnisharp') !== true) {
        return;
    }

    omniSharpWarnedFor.add(solutionPath);
    log.info(`OmniSharp is enabled but the solution is .slnx: ${solutionPath}`);

    const useRoslyn = 'Use Roslyn';
    const choice = await vscode.window.showWarningMessage(
        'OmniSharp cannot load .slnx solutions, so C# IntelliSense will not work. ' +
        'Switch this workspace to the Roslyn language server ("dotnet.server.useOmnisharp": false)?',
        useRoslyn
    );
    if (choice !== useRoslyn) {
        return;
    }

    await config.update('server.useOmnisharp', false, vscode.ConfigurationTarget.Workspace);

    const reload = 'Reload Window';
    if (await vscode.window.showInformationMessage('Reload the window to start the Roslyn language server.', reload) === reload) {
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
}
