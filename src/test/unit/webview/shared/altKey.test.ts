// Alt is cancelled to keep VS Code's menu bar closed, but AltGr and Option characters must reach the rename input (review A3-2)
import { blocksVsCodeMenu } from '../../../../webview/shared/altKey';

const event = (init: Partial<{ altKey: boolean; ctrlKey: boolean; key: string; target: Element | null; altGraph: boolean }>) => ({
    altKey: false, ctrlKey: false, key: 'a', target: document.body as EventTarget | null,
    getModifierState: (name: string) => name === 'AltGraph' && !!init.altGraph, ...init,
});

describe('blocksVsCodeMenu', () => {
    it('blocks Alt on its own and Alt with a key outside an input', () => {
        expect(blocksVsCodeMenu(event({ key: 'Alt', altKey: true }))).toBe(true);
        expect(blocksVsCodeMenu(event({ key: 'f', altKey: true }))).toBe(true);
    });

    it('lets other keys through', () => {
        expect(blocksVsCodeMenu(event({ key: 'a' }))).toBe(false);
    });

    it('lets AltGr characters through (Windows reports Ctrl+Alt)', () => {
        expect(blocksVsCodeMenu(event({ key: '@', altKey: true, ctrlKey: true }))).toBe(false);
        expect(blocksVsCodeMenu(event({ key: '@', altKey: true, altGraph: true }))).toBe(false);
    });

    it('lets everything into an input, textarea or contenteditable (Option characters on a Mac)', () => {
        expect(blocksVsCodeMenu(event({ key: '[', altKey: true, target: document.createElement('input') }))).toBe(false);
        expect(blocksVsCodeMenu(event({ key: '[', altKey: true, target: document.createElement('textarea') }))).toBe(false);
        const editable = document.createElement('div');
        Object.defineProperty(editable, 'isContentEditable', { value: true });
        expect(blocksVsCodeMenu(event({ key: '[', altKey: true, target: editable }))).toBe(false);
    });
});
