import { dotnetSlnAdd } from '../../../../services/solution/dotnetSlnAdd';

describe('dotnet sln add without the referenced projects', () => {
    it('passes --include-references false', async () => {
        const calls: string[][] = [];
        await dotnetSlnAdd('/r/App.slnx', ['Web/Web.csproj'], ['--in-root'], '/r', async args => { calls.push(args); return { code: 0, output: '' }; });
        expect(calls).toEqual([['sln', '/r/App.slnx', 'add', 'Web/Web.csproj', '--in-root', '--include-references', 'false']]);
    });

    it('runs without the option on an SDK that does not know it (before .NET 10)', async () => {
        const calls: string[][] = [];
        await dotnetSlnAdd('/r/App.sln', ['Web/Web.csproj'], [], '/r', async args => {
            calls.push(args);
            return args.includes('--include-references') ? { code: 1, output: "Unrecognized command or argument '--include-references'." } : { code: 0, output: '' };
        });
        expect(calls[1]).toEqual(['sln', '/r/App.sln', 'add', 'Web/Web.csproj']);
    });

    it('says what dotnet said when the add fails', async () => {
        await expect(dotnetSlnAdd('/r/App.sln', ['X.csproj'], [], '/r', async () => ({ code: 1, output: 'Project X.csproj not found.' })))
            .rejects.toThrow('dotnet sln add failed: Project X.csproj not found.');
    });
});
