import * as path from 'path';

jest.mock('vscode', () => ({ window: { createOutputChannel: () => ({ appendLine: () => { } }) } }), { virtual: true });

const projects = new Map<string, unknown>();
jest.mock('../../../../services/solutionService', () => ({
    SolutionService: { getActiveSolution: () => ({ projects }) },
}));

import { projectForPath } from '../../../../services/templates/templateService';

const root = path.resolve('/repo');
const at = (...parts: string[]) => path.join(root, ...parts);

describe('projectForPath', () => {
    beforeEach(() => projects.clear());

    test('picks the project with the deepest folder, not the longest project file path', () => {
        projects.set(at('Web', 'AVeryLongProjectFileNameForTheWebProject.csproj'), {});
        projects.set(at('Web', 'Tools', 'T.csproj'), {});
        expect(projectForPath(at('Web', 'Tools', 'Helper.cs'))).toBe(at('Web', 'Tools', 'T.csproj'));
        expect(projectForPath(at('Web', 'Program.cs'))).toBe(at('Web', 'AVeryLongProjectFileNameForTheWebProject.csproj'));
    });

    test('a folder whose name starts with two dots is inside the project', () => {
        projects.set(at('Web', 'Web.csproj'), {});
        expect(projectForPath(at('Web', '..data', 'x.txt'))).toBe(at('Web', 'Web.csproj'));
        expect(projectForPath(at('Other', 'x.txt'))).toBeUndefined();
    });
});
