import { render } from '@testing-library/react';
import { TreeNode } from '../../../../../webview/solution-view/components/TreeNode/TreeNode';
import { IconThemeContext } from '../../../../../webview/solution-view/components/TreeNode/IconThemeContext';
import { NodeIdString } from '../../../../../types/nodeId';
import { ProjectNode } from '../../../../../types';
import { IconThemePayload } from '../../../../../types/iconTheme';

const theme: IconThemePayload = {
    icons: {
        _cs: { svg: 'https://theme/cs.svg' },
        _json: { fontCharacter: '\\E055', fontColor: '#cbcb41', fontId: 'seti', fontSize: '120%' },
        _folder: { svg: 'https://theme/folder.svg' },
    },
    fonts: [{ id: 'seti', src: 'https://theme/seti.woff' }],
    folder: '_folder',
    fileNames: {}, fileExtensions: { cs: '_cs', json: '_json' }, folderNames: {}, folderNamesExpanded: {},
    languageFileNames: {}, languageFileExtensions: {},
};

const props = {
    level: 0,
    onProjectAction: jest.fn(),
    onToggleExpand: jest.fn(),
    onNodeClick: jest.fn(),
    onNodeFocus: jest.fn(),
    onRenameConfirm: jest.fn(),
    onRenameCancel: jest.fn(),
};

const node = (type: ProjectNode['type'], name: string): ProjectNode => ({ type, name, nodeId: `${type}-${name}` as NodeIdString });

function renderWithTheme(n: ProjectNode, value: IconThemePayload | null = theme) {
    return render(<IconThemeContext.Provider value={value}><TreeNode {...props} node={n} /></IconThemeContext.Provider>);
}

describe('TreeNode theme icons', () => {
    test('an SVG theme icon renders as an image', () => {
        const { container } = renderWithTheme(node('file', 'Program.cs'));
        expect(container.querySelector('.node-icon img')).toHaveAttribute('src', 'https://theme/cs.svg');
    });

    test('a font theme icon renders its glyph in the theme font', () => {
        const { container } = renderWithTheme(node('solutionItem', 'appsettings.json'));
        const glyph = container.querySelector('.node-icon .theme-glyph') as HTMLElement;
        expect(glyph.textContent).toBe(String.fromCodePoint(0xE055));
        expect(glyph.style.fontFamily).toBe('theme-icon-seti');
        expect(glyph.style.color).toBe('rgb(203, 203, 65)');
        expect((glyph.firstElementChild as HTMLElement).style.fontSize).toBe('120%');
    });

    test('folders and solution folders use the theme folder icon', () => {
        for (const type of ['folder', 'solutionFolder'] as const) {
            const { container, unmount } = renderWithTheme(node(type, 'Models'));
            expect(container.querySelector('.node-icon img')).toHaveAttribute('src', 'https://theme/folder.svg');
            unmount();
        }
    });

    test('projects keep the built-in icon', () => {
        const { container } = renderWithTheme(node('project', 'Api.csproj'));
        expect(container.querySelector('.node-icon img, .node-icon .theme-glyph')).toBeNull();
    });

    test('without a theme the built-in icon renders', () => {
        const { container } = renderWithTheme(node('file', 'Program.cs'), null);
        expect(container.querySelector('.node-icon img, .node-icon .theme-glyph')).toBeNull();
    });
});
