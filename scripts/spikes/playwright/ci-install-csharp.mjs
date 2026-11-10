// Installs Microsoft's C# extension (and the .NET runtime extension it depends on) into ~/.vscode/extensions, where launch(ws, { csharp: true })
// links it from, with the CLI of the VS Code in CODE_EXECUTABLE (CI: ci-download-vscode.mjs).
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveCliArgsFromVSCodeExecutablePath } from '@vscode/test-electron';

const [cli] = resolveCliArgsFromVSCodeExecutablePath(process.env.CODE_EXECUTABLE);
execFileSync(cli, ['--install-extension', 'ms-dotnettools.csharp', '--extensions-dir', join(homedir(), '.vscode', 'extensions')],
    { stdio: 'inherit', shell: process.platform === 'win32' });
