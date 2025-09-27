/**
 * Frontend Logger - For use in webview/React code
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
    debug(message: string, ...args: any[]): void;
    info(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
}

class WebviewConsoleLogger implements Logger {
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

        const lvl = WebviewConsoleLogger.levelMap[level];
        return `C# ${timestamp}.${ms} [${lvl}] ${this.name}: ${message}`;
    }

    debug(message: string, ...args: any[]): void {
        console.debug(this.formatMessage("debug", message), ...args);
    }

    info(message: string, ...args: any[]): void {
        console.log(this.formatMessage("info", message), ...args);
    }

    warn(message: string, ...args: any[]): void {
        console.warn(this.formatMessage("warn", message), ...args);
    }

    error(message: string, ...args: any[]): void {
        console.error(this.formatMessage("error", message), ...args);
    }
}

/**
 * Creates a logger instance for frontend (webview/React) code
 */
export function logger(name: string): Logger {
    return new WebviewConsoleLogger(name);
}