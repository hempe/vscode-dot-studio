/**
 * Whether a key event is Alt on its own (or Alt with a key) that would open VS Code's menu bar and so has to be cancelled.
 * Not AltGr (Windows reports it as Ctrl+Alt, `getModifierState('AltGraph')`), not Option characters on a Mac, and not anything
 * typed into an input: `@`, `#`, `[`, `{`, `\` need those keys on Swiss, German and many other layouts.
 */
export function blocksVsCodeMenu(event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'getModifierState'> & { target: EventTarget | null }): boolean {
    if (!event.altKey && event.key !== 'Alt') {
        return false;
    }
    const target = event.target as HTMLElement | null;
    const editable = !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    if (editable) {
        return false;
    }
    return !(event.getModifierState?.('AltGraph') || (event.ctrlKey && event.altKey));
}
