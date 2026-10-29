/** A running process as the operating system lists it */
export interface ProcessEntry {
    pid: number;
    ppid: number;
    /** The executable: the first word of the command line on Linux and macOS, the image path on Windows */
    command: string;
    /** The whole command line, including the executable */
    args: string;
}

/** Parses `ps -ww -eo pid=,ppid=,args=` (Linux and macOS): `  1234  1000 /usr/bin/dotnet /srv/App.dll --urls x` */
export function parsePsOutput(output: string): ProcessEntry[] {
    const entries: ProcessEntry[] = [];
    for (const line of output.split(/\r?\n/)) {
        const match = /^\s*(\d+)\s+(\d+)\s+(.*?)\s*$/.exec(line);
        if (!match) {
            continue;
        }
        const args = match[3];
        if (!args) {
            continue;
        }
        entries.push({ pid: Number(match[1]), ppid: Number(match[2]), command: args.split(/\s+/)[0], args });
    }
    return entries;
}

interface WindowsProcess {
    ProcessId?: number;
    ParentProcessId?: number;
    Name?: string | null;
    ExecutablePath?: string | null;
    CommandLine?: string | null;
}

/**
 * Parses `Get-CimInstance Win32_Process | Select ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress`.
 * One process is a single object, several are an array; system processes have no command line.
 */
export function parseWindowsProcesses(output: string): ProcessEntry[] {
    const text = output.replace(/^﻿/, '').trim();
    if (!text) {
        return [];
    }
    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch {
        return [];
    }
    const items = (Array.isArray(json) ? json : [json]) as WindowsProcess[];
    const entries: ProcessEntry[] = [];
    for (const item of items) {
        if (!item || typeof item.ProcessId !== 'number') {
            continue;
        }
        const command = item.ExecutablePath || item.Name || '';
        entries.push({
            pid: item.ProcessId,
            ppid: typeof item.ParentProcessId === 'number' ? item.ParentProcessId : 0,
            command,
            args: item.CommandLine || command,
        });
    }
    return entries;
}
