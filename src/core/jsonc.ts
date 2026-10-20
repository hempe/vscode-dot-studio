import { applyEdits, FormattingOptions, modify, parse, ParseError, printParseErrorCode } from 'jsonc-parser';
import { isDeepStrictEqual } from 'util';

/**
 * Helpers for VS Code's JSON-with-comments files (launch.json, tasks.json, launchSettings.json).
 * Edits go through jsonc-parser so comments, ordering and formatting of everything else are kept.
 */

export interface JsoncParseResult {
    value: any;
    /** Human-readable syntax errors; empty when the text is valid JSONC */
    errors: string[];
}

export function parseJsonc(text: string): JsoncParseResult {
    const parseErrors: ParseError[] = [];
    const value = parse(text, parseErrors, { allowTrailingComma: true, disallowComments: false });
    const errors = parseErrors.map(e => `${printParseErrorCode(e.error)} at offset ${e.offset}`);
    return { value, errors };
}

/** Uses the indentation and line endings already present in the text, 4 spaces otherwise */
function detectFormatting(text: string): FormattingOptions {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const indent = text.match(/^([ \t]+)\S/m)?.[1];
    if (indent?.startsWith('\t')) {
        return { insertSpaces: false, tabSize: 4, eol };
    }
    return { insertSpaces: true, tabSize: indent?.length ?? 4, eol };
}

/**
 * Replaces the first item of the top-level array `arrayKey` that matches `isMatch` with `item`,
 * or inserts `item` at the start or end of the array if none matches.
 * Returns the text unchanged if the matching item already equals `item`.
 */
export function upsertArrayItem(
    text: string,
    arrayKey: string,
    isMatch: (item: any) => boolean,
    item: unknown,
    position: 'first' | 'last'
): string {
    const { value } = parseJsonc(text);
    const array: unknown[] | undefined = Array.isArray(value?.[arrayKey]) ? value[arrayKey] : undefined;
    const formattingOptions = detectFormatting(text);

    if (!array) {
        return applyEdits(text, modify(text, [arrayKey], [item], { formattingOptions }));
    }

    const index = array.findIndex(isMatch);
    if (index >= 0) {
        if (isDeepStrictEqual(array[index], item)) {
            return text;
        }
        return applyEdits(text, modify(text, [arrayKey, index], item, { formattingOptions }));
    }

    const insertAt = position === 'first' ? 0 : array.length;
    return applyEdits(text, modify(text, [arrayKey, insertAt], item, { formattingOptions, isArrayInsertion: true }));
}

/** Removes every item of the top-level array `arrayKey` that matches `isMatch`; the text is unchanged when none does */
export function removeArrayItems(text: string, arrayKey: string, isMatch: (item: any) => boolean): string {
    const { value } = parseJsonc(text);
    const array: unknown[] = Array.isArray(value?.[arrayKey]) ? value[arrayKey] : [];
    const formattingOptions = detectFormatting(text);
    let result = text;
    // From the end, so the indexes of the items still to remove stay valid
    for (let index = array.length - 1; index >= 0; index--) {
        if (isMatch(array[index])) {
            result = applyEdits(result, modify(result, [arrayKey, index], undefined, { formattingOptions }));
        }
    }
    return result;
}
