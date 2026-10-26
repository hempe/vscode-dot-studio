// Run settings with real dotnet: a team's .runsettings (RunSettingsFilePath in Directory.Build.props) reaches NUnit
// tests through VSTest and MSTest runner tests through Microsoft.Testing.Platform's VSTest bridge
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { cannotRun } from '../../testSupport/cannotRun';

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

const nunitProject = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net10.0</TargetFramework><IsPackable>false</IsPackable></PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="18.0.1" />
    <PackageReference Include="NUnit" Version="4.3.2" />
    <PackageReference Include="NUnit3TestAdapter" Version="5.0.0" />
  </ItemGroup>
</Project>`;
const nunitTests = (ns: string) => `using NUnit.Framework;
namespace ${ns};
public class SettingsTests
{
    [Test] public void Param() => Assert.That(TestContext.Parameters["Env"], Is.EqualTo("team"));
    [Test] public void Variable() => Assert.That(System.Environment.GetEnvironmentVariable("TEAM_VAR"), Is.EqualTo("yes"));
}
`;
const files: Record<string, string> = {
    'Directory.Build.props': '<Project><PropertyGroup><RunSettingsFilePath>$(MSBuildThisFileDirectory)team.runsettings</RunSettingsFilePath></PropertyGroup></Project>',
    'team.runsettings': `<?xml version="1.0" encoding="utf-8"?>
<RunSettings>
  <RunConfiguration>
    <MaxCpuCount>0</MaxCpuCount>
    <EnvironmentVariables><TEAM_VAR>yes</TEAM_VAR></EnvironmentVariables>
  </RunConfiguration>
  <TestRunParameters><Parameter name="Env" value="team" /></TestRunParameters>
  <DataCollectionRunSettings><DataCollectors><DataCollector friendlyName="XPlat Code Coverage" /></DataCollectors></DataCollectionRunSettings>
</RunSettings>`,
    'A/A.csproj': nunitProject,
    'A/SettingsTests.cs': nunitTests('A'),
    'B/B.csproj': nunitProject,
    'B/SettingsTests.cs': nunitTests('B'),
    'MR/MR.csproj': `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net10.0</TargetFramework><OutputType>Exe</OutputType><ImplicitUsings>enable</ImplicitUsings><EnableMSTestRunner>true</EnableMSTestRunner></PropertyGroup>
  <ItemGroup><PackageReference Include="MSTest" Version="4.0.1" /></ItemGroup>
</Project>`,
    'MR/SettingsTests.cs': `namespace MR;
[TestClass]
public class SettingsTests
{
    public TestContext TestContext { get; set; } = null!;
    [TestMethod] public void Param() => Assert.AreEqual("team", TestContext.Properties["Env"]?.ToString());
    [TestMethod] public void Variable() => Assert.AreEqual("yes", Environment.GetEnvironmentVariable("TEAM_VAR"));
}
`,
};

describe('Test Explorer with a run settings file and dotnet', () => {
    jest.setTimeout(600000);
    let dir: string;

    beforeAll(() => {
        dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-runsettings-')));
        for (const [file, content] of Object.entries(files)) {
            fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
            fs.writeFileSync(path.join(dir, file), content);
        }
    });
    afterAll(() => {
        try {
            fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
        } catch {
            // a leftover temp folder must not fail the suite
        }
    });

    it('TestRunParameters and environment variables reach VSTest (NUnit) and MSTest runner tests', async () => {
        if (!hasDotnet || ['A', 'B', 'MR'].some(project => spawnSync('dotnet', ['restore', path.join(dir, project)]).status !== 0)) {
            cannotRun('dotnet or the test packages are not available');
            return;
        }
        const projects = ['A', 'B', 'MR'].map(name => path.join(dir, name, `${name}.csproj`));
        const explorer = new TestExplorer({ projects: () => projects });
        await explorer.refresh(true);

        const [run] = mock.controller.profiles;
        await run.handler({ include: undefined, exclude: [] }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => { } }) });
        const events: string[] = mock.runs[0].events;
        expect(events.filter(e => e.startsWith('failed') || e.startsWith('errored'))).toEqual([]);
        expect(events.filter(e => e.startsWith('passed')).sort()).toEqual(['passed Param', 'passed Param', 'passed Param', 'passed Variable', 'passed Variable', 'passed Variable']);
        explorer.dispose();
    });
});
