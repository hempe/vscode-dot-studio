import { cleanupSteps, unusedUsingsSeverityFor } from '../../../../services/codeCleanup/cleanupSteps';

describe('cleanupSteps', () => {
    it('runs the whole solution through its solution file, from its directory', () => {
        const { cwd, steps } = cleanupSteps({ kind: 'solution', path: '/work/App.sln' }, 'warn');
        expect(cwd).toBe('/work');
        expect(steps.map(s => s.args)).toEqual([
            ['format', 'whitespace', '/work/App.sln'],
            ['format', 'style', '/work/App.sln', '--diagnostics', 'IDE0005', '--severity', 'hidden'],
            ['format', 'style', '/work/App.sln', '--severity', 'warn'],
        ]);
    });

    it('runs a project through its project file', () => {
        const { cwd, steps } = cleanupSteps({ kind: 'project', path: '/work/Web/Web.csproj' }, 'error');
        expect(cwd).toBe('/work/Web');
        expect(steps[0].args).toEqual(['format', 'whitespace', '/work/Web/Web.csproj']);
        expect(steps[2].args).toEqual(['format', 'style', '/work/Web/Web.csproj', '--severity', 'error']);
    });

    it('labels the three steps in order', () => {
        const { steps } = cleanupSteps({ kind: 'project', path: '/w/P.csproj' }, 'warn');
        expect(steps.map(s => s.label)).toEqual(['Formatting', 'Removing unused usings', 'Applying code style fixes']);
    });

    it('limits a file to itself in the owning project, with a path relative to the project', () => {
        const { cwd, steps } = cleanupSteps({ kind: 'file', path: '/work/Web/Controllers/Home.cs', projectPath: '/work/Web/Web.csproj' }, 'warn');
        expect(cwd).toBe('/work/Web');
        expect(steps[0].args).toEqual(['format', 'whitespace', '/work/Web/Web.csproj', '--include', 'Controllers/Home.cs']);
        expect(steps[1].args).toEqual(['format', 'style', '/work/Web/Web.csproj', '--diagnostics', 'IDE0005', '--severity', 'hidden', '--include', 'Controllers/Home.cs']);
        expect(steps[2].args).toEqual(['format', 'style', '/work/Web/Web.csproj', '--severity', 'warn', '--include', 'Controllers/Home.cs']);
    });

    it('limits a folder with a trailing slash, also for nested folders and paths with spaces', () => {
        const { steps } = cleanupSteps({ kind: 'folder', path: '/work/My App/Some Folder/Sub', projectPath: '/work/My App/My App.csproj' }, 'info');
        expect(steps[0].args).toEqual(['format', 'whitespace', '/work/My App/My App.csproj', '--include', 'Some Folder/Sub/']);
        expect(steps[2].args.slice(-4)).toEqual(['--severity', 'info', '--include', 'Some Folder/Sub/']);
    });

    it('uses forward slashes for Windows paths', () => {
        const { steps } = cleanupSteps({ kind: 'file', path: 'C:\\w\\P\\Sub\\A.cs', projectPath: 'C:\\w\\P\\P.csproj' }, 'warn');
        expect(steps[0].args.slice(-2)).toEqual(['--include', 'Sub/A.cs']);
    });

    it('needs the owning project for files and folders', () => {
        expect(() => cleanupSteps({ kind: 'file', path: '/w/A.cs' }, 'warn')).toThrow(/project/i);
        expect(() => cleanupSteps({ kind: 'folder', path: '/w/Sub' }, 'warn')).toThrow(/project/i);
    });
});

describe('unused usings severity', () => {
    it('uses hidden on SDK 10 and newer, where IDE0005 is hidden by default', () => {
        expect(unusedUsingsSeverityFor('10.0.111')).toBe('hidden');
        expect(unusedUsingsSeverityFor('11.0.100-preview.1')).toBe('hidden');
    });

    it('uses info on older SDKs, which reject hidden', () => {
        expect(unusedUsingsSeverityFor('8.0.130')).toBe('info');
        expect(unusedUsingsSeverityFor('9.0.100')).toBe('info');
    });

    it('is passed on to the second step', () => {
        const { steps } = cleanupSteps({ kind: 'project', path: '/w/P.csproj' }, 'warn', 'info');
        expect(steps[1].args).toEqual(['format', 'style', '/w/P.csproj', '--diagnostics', 'IDE0005', '--severity', 'info']);
    });
});
