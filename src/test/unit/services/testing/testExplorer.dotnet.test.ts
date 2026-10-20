// The Test Explorer end to end with real dotnet: xUnit v3 and MSTest runner projects, built, discovered and run
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

jest.mock('vscode', () => {
    class Collection {
        private readonly map = new Map<string, any>();
        constructor(private readonly owner?: any) { }
        add(item: any) { item.parent = this.owner; this.map.set(item.id, item); }
        delete(id: string) { this.map.delete(id); }
        get(id: string) { return this.map.get(id); }
        replace(items: any[]) { this.map.clear(); items.forEach(item => this.add(item)); }
        forEach(callback: (item: any) => void) { [...this.map.values()].forEach(callback); }
        get size() { return this.map.size; }
    }
    class TestMessage {
        location: unknown;
        constructor(public message: string) { }
        static diff(message: string, expected: string, actual: string) { return Object.assign(new TestMessage(message), { expectedOutput: expected, actualOutput: actual }); }
    }
    const runs: any[] = [];
    const controller: any = {
        items: new Collection(),
        profiles: [] as any[],
        createTestItem: (id: string, label: string, uri?: unknown) => {
            const item: any = { id, label, uri };
            item.children = new Collection(item);
            return item;
        },
        createRunProfile: (label: string, kind: number, handler: Function) => controller.profiles.push({ label, kind, handler }),
        createTestRun: () => {
            const events: string[] = [];
            const run = {
                events, messages: new Map<string, any>(),
                enqueued: (item: any) => events.push(`enqueued ${item.label}`),
                started: (item: any) => events.push(`started ${item.label}`),
                passed: (item: any) => events.push(`passed ${item.label}`),
                skipped: (item: any) => events.push(`skipped ${item.label}`),
                failed: (item: any, message: any) => { events.push(`failed ${item.label}`); run.messages.set(item.label, message); },
                errored: (item: any, message: any) => { events.push(`errored ${item.label}`); run.messages.set(item.label, message); },
                appendOutput: () => { },
                end: () => events.push('end'),
            };
            runs.push(run);
            return run;
        },
        dispose: () => { },
    };
    const disposable = { dispose: () => { } };
    return {
        controller, runs, TestMessage,
        tests: { createTestController: () => controller },
        TestRunProfileKind: { Run: 1, Debug: 2 },
        Uri: { file: (p: string) => ({ fsPath: p }) },
        Range: class { constructor(public startLine: number, public startCharacter: number, public endLine: number, public endCharacter: number) { } },
        Location: class { constructor(public uri: unknown, public range: unknown) { } },
        tasks: { onDidEndTaskProcess: () => disposable },
        debug: { onDidStartDebugSession: () => disposable },
        workspace: { workspaceFolders: undefined, getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
        commands: { executeCommand: async () => undefined },
    };
}, { virtual: true });

import * as vscode from 'vscode';
import { TestExplorer } from '../../../../services/testing/testExplorer';

const mock = vscode as any;
const hasDotnet = spawnSync('dotnet', ['--version']).status === 0;

const projects: Record<string, string> = {
    'X3/X3.csproj': `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net10.0</TargetFramework><OutputType>Exe</OutputType><ImplicitUsings>enable</ImplicitUsings></PropertyGroup>
  <ItemGroup><PackageReference Include="xunit.v3" Version="3.2.2" /><Using Include="Xunit" /></ItemGroup>
</Project>`,
    'X3/MathTests.cs': `namespace X3.Math;
public class MathTests
{
    [Fact] public void Adds() => Assert.Equal(2, 1 + 1);
    [Fact] public void Fails() => Assert.Equal(3, 1 + 1);
    [Theory, InlineData(1), InlineData(2)] public void Positive(int x) => Assert.True(x > 0);
}
`,
    'MR/MR.csproj': `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net10.0</TargetFramework><OutputType>Exe</OutputType><ImplicitUsings>enable</ImplicitUsings><EnableMSTestRunner>true</EnableMSTestRunner></PropertyGroup>
  <ItemGroup><PackageReference Include="MSTest" Version="4.0.1" /></ItemGroup>
</Project>`,
    'MR/MathTests.cs': `namespace MR;
[TestClass]
public class MathTests
{
    [TestMethod] public void Adds() => Assert.AreEqual(2, 1 + 1);
    [TestMethod, DataRow(1), DataRow(2)] public void Positive(int x) => Assert.IsTrue(x > 0);
}
`,
};

describe('Test Explorer with dotnet', () => {
    jest.setTimeout(600000);
    let dir: string;

    beforeAll(() => {
        dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-tests-')));
        for (const [file, content] of Object.entries(projects)) {
            fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
            fs.writeFileSync(path.join(dir, file), content);
        }
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('builds, discovers and runs xUnit v3 and MSTest runner tests', async () => {
        if (!hasDotnet || spawnSync('dotnet', ['restore', path.join(dir, 'X3')]).status !== 0 || spawnSync('dotnet', ['restore', path.join(dir, 'MR')]).status !== 0) {
            console.warn('dotnet or the test packages are not available, skipping');
            return;
        }
        const explorer = new TestExplorer({ projects: () => [path.join(dir, 'X3/X3.csproj'), path.join(dir, 'MR/MR.csproj')] });
        await explorer.refresh(true);

        const labels = (items: any): string[] => { const all: string[] = []; items.forEach((i: any) => all.push(i.label, ...labels(i.children))); return all; };
        expect(labels(mock.controller.items)).toEqual(expect.arrayContaining(['X3', 'X3.Math', 'MathTests', 'Adds', 'Fails', 'Positive', 'x: 1', 'MR', '1', '2']));

        const [run] = mock.controller.profiles;
        await run.handler({ include: undefined, exclude: [] }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => { } }) });
        const events = mock.runs[0].events;
        expect(events.filter((e: string) => e.startsWith('failed'))).toEqual(['failed Fails']);
        expect(events.filter((e: string) => e.startsWith('passed'))).toHaveLength(6);
        explorer.dispose();
    });
});
