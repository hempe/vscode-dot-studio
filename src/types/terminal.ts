export interface TerminalCommand {
    name: string;
    command: string;
    workingDirectory?: string;
}

export interface CommandResult {
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number | null;
}