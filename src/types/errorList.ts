/** One row of the Error List */
export interface ErrorListRow {
    readonly id: string;
    readonly severity: 'error' | 'warning' | 'info';
    readonly code?: string;
    /** Documentation of the code */
    readonly codeUrl?: string;
    readonly message: string;
    readonly project: string;
    /** Relative to the project */
    readonly file: string;
    readonly filePath: string;
    /** 1-based */
    readonly line: number;
    readonly column: number;
}

export interface ErrorListSummary {
    readonly errors: number;
    readonly warnings: number;
    readonly infos: number;
}

/** Which severities are shown; the same settings drive the Solution Explorer markers */
export interface ErrorListFilter {
    readonly errors: boolean;
    readonly warnings: boolean;
    readonly infos: boolean;
}

/** Extension → webview */
export type ErrorListMessage =
    | { readonly type: 'rows'; readonly rows: ErrorListRow[]; readonly filter: ErrorListFilter; readonly summary: ErrorListSummary; readonly hasSolution: boolean };

/** Webview → extension */
export type ErrorListRequest =
    | { readonly type: 'ready' }
    | { readonly type: 'open'; readonly filePath: string; readonly line: number; readonly column: number }
    | { readonly type: 'toggle'; readonly severity: keyof ErrorListFilter }
    | { readonly type: 'openUrl'; readonly url: string };
