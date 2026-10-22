/**
 * Backend Logger - For use in Node.js extension host code
 */
import { inspect } from 'util';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Where logs go once the extension runs: VS Code's "Shinobi .NET Studio" log channel (a `vscode.LogOutputChannel`) */
export interface LogSink {
    trace(message: string): void;
    debug(message: string): void;
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}

let sink: LogSink | undefined;

/**
 * Sends all logs to the channel (VS Code adds the time and level, and filters by "Developer: Set Log Level");
 * without one, they go to the console (tests, the menu generator script)
 */
export function setLogSink(logSink: LogSink | undefined): void {
    sink = logSink;
}

const describeArg = (arg: unknown) => typeof arg === 'string' ? arg
    : arg instanceof Error ? (arg.stack ?? `${arg.name}: ${arg.message}`)
        : inspect(arg, { depth: 4, breakLength: 160 });

export interface Logger {
    debug(message: string, ...args: any[]): void;
    info(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
    shotgun(message: string, ...args: any[]): void;
}

class BackendConsoleLogger implements Logger {
    constructor(private readonly name: string) { }

    private static levelMap: Record<LogLevel, string> = {
        debug: "DBG",
        info: "INF",
        warn: "WRN",
        error: "ERR",
    };

    private formatMessage(level: LogLevel, message: string): string {
        const now = new Date();
        const timestamp = now.toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        });
        const ms = now.getMilliseconds().toString().padStart(3, "0");

        const lvl = BackendConsoleLogger.levelMap[level];
        return `C# ${timestamp}.${ms} [${lvl}] ${this.name}: ${message}`;
    }

    /** `[Name] message details` for the log channel */
    private channelMessage(message: string, args: any[]): string {
        return [`[${this.name}] ${message}`, ...args.map(describeArg)].join(' ');
    }

    debug(message: string, ...args: any[]): void {
        sink ? sink.debug(this.channelMessage(message, args)) : console.debug(this.formatMessage("debug", message), ...args);
    }

    info(message: string, ...args: any[]): void {
        sink ? sink.info(this.channelMessage(message, args)) : console.log(this.formatMessage("info", message), ...args);
    }

    warn(message: string, ...args: any[]): void {
        sink ? sink.warn(this.channelMessage(message, args)) : console.warn(this.formatMessage("warn", message), ...args);
    }

    error(message: string, ...args: any[]): void {
        sink ? sink.error(this.channelMessage(message, args)) : console.error(this.formatMessage("error", message), ...args);
    }

    // DO NOT REMOVE - shotgun logging is used for debugging complex issues
    // Even if not currently used, keep this method for future debugging sessions
    shotgun(message: string, ...args: any[]): void {
        sink ? sink.trace(this.channelMessage(`🔫 SHOTGUN ${message}`, args)) : console.log(`🔫 SHOTGUN [${this.name}]: ${message}`, ...args);
    }
}
/**
 * Creates a logger instance for backend (Node.js extension host) code
 */
export function logger(name: string): Logger {
    return new BackendConsoleLogger(name);
}