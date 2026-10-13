import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { defaultProjectLocation, findProjectFile, frameworkChoices, isValidProjectName, mostCommonFramework } from '../../../../services/templates/newProject';

const classlibHelp = `Class Library (C#)
Template options:
  -f, --framework <choice>     The target framework for the project.
                               Type: choice
                                 net10.0         Target net10.0
                                 netstandard2.1  Target netstandard2.1
                                 netstandard2.0  Target netstandard2.0
                                 net8.0          Target net8.0
                               Default: net10.0
  --langVersion <langVersion>  Sets the LangVersion property in the created project file
                               Type: text
`;

describe('new project defaults', () => {
    const sln = path.join('/repo');

    it('puts the project where most projects live', () => {
        const projects = ['/repo/src/A/A.csproj', '/repo/src/B/B.csproj', '/repo/tests/T/T.csproj'];
        expect(defaultProjectLocation(sln, projects, 'New')).toBe(path.join('src', 'New'));
    });

    it('next to the solution when projects are there, or there are none', () => {
        expect(defaultProjectLocation(sln, ['/repo/A/A.csproj', '/repo/B/B.csproj'], 'New')).toBe('New');
        expect(defaultProjectLocation(sln, [], 'New')).toBe('New');
    });

    it('takes the most common framework, the newest on ties', () => {
        expect(mostCommonFramework([['net8.0'], ['net10.0'], ['net8.0', 'netstandard2.0']])).toBe('net8.0');
        expect(mostCommonFramework([['net8.0'], ['net10.0']])).toBe('net10.0');
        expect(mostCommonFramework([])).toBeUndefined();
    });

    it('reads the framework choices from the template help', () => {
        expect(frameworkChoices(classlibHelp)).toEqual(['net10.0', 'netstandard2.1', 'netstandard2.0', 'net8.0']);
        expect(frameworkChoices('Template options:\n  (No options)')).toEqual([]);
    });

    it('validates names', () => {
        expect(isValidProjectName('Cirrus.Voucher.PayLoop')).toBe(true);
        expect(isValidProjectName('My_App2')).toBe(true);
        expect(isValidProjectName('')).toBe(false);
        expect(isValidProjectName('a/b')).toBe(false);
        expect(isValidProjectName('2App')).toBe(false);
    });

    it('finds the project file a template created', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'newproj-'));
        expect(findProjectFile(dir)).toBeUndefined();
        fs.writeFileSync(path.join(dir, 'Lib.fsproj'), '<Project />');
        expect(findProjectFile(dir)).toBe(path.join(dir, 'Lib.fsproj'));
        fs.rmSync(dir, { recursive: true });
    });
});
