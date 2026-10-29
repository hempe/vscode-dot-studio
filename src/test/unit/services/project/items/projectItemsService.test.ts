import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProjectItemsService, RETRY_DELAYS_MS } from '../../../../../services/project/items/projectItemsService';

const fixture = path.resolve(__dirname, '../../../../../__fixtures__/project-items/ItemsApp/ItemsApp.csproj');
const dir = path.dirname(fixture);
const output = (...files: string[]) => JSON.stringify({ Items: { Compile: files.map(file => ({ Identity: file, FullPath: path.join(dir, file) })) } });

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

/** An MSBuild runner whose runs end when the test says so; counts the runs of each project running at once */
const deferredRuns = () => {
    const pending: { resolve(value: string): void; reject(error: Error): void }[] = [];
    const running = new Map<string, number>();
    let calls = 0;
    let mostPerProject = 0;
    const run = (projectPath: string) => new Promise<string>((resolve, reject) => {
        calls++;
        running.set(projectPath, (running.get(projectPath) ?? 0) + 1);
        mostPerProject = Math.max(mostPerProject, running.get(projectPath)!);
        const done = () => running.set(projectPath, running.get(projectPath)! - 1);
        pending.push({ resolve: value => { done(); resolve(value); }, reject: error => { done(); reject(error); } });
    });
    return {
        run,
        finish: (value: string) => pending.shift()!.resolve(value),
        fail: (error: Error) => pending.shift()!.reject(error),
        get calls() { return calls; },
        get mostPerProject() { return mostPerProject; },
    };
};

describe('ProjectItemsService', () => {
    test('caches the result and runs MSBuild once for concurrent requests', async () => {
        const run = jest.fn().mockResolvedValue(output('A.cs'));
        const service = new ProjectItemsService(run);
        const [first, second] = await Promise.all([service.evaluate(fixture), service.evaluate(fixture)]);
        expect(first).toBe(second);
        expect(service.get(fixture)?.isIncluded(path.join(dir, 'A.cs'))).toBe(true);
        await service.evaluate(fixture);
        expect(run).toHaveBeenCalledTimes(1);
    });

    test('invalidate keeps the last result visible until the new evaluation lands, then replaces it', async () => {
        let finish!: (value: string) => void;
        const run = jest.fn()
            .mockResolvedValueOnce(output('A.cs'))
            .mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
        const service = new ProjectItemsService(run);
        await service.evaluate(fixture);
        service.invalidate(fixture);
        expect(service.get(fixture)?.isIncluded(path.join(dir, 'A.cs'))).toBe(true);
        const again = service.evaluate(fixture);
        const shared = service.evaluate(fixture);
        expect(service.get(fixture)?.isIncluded(path.join(dir, 'A.cs'))).toBe(true);
        await settle();
        finish(output('B.cs'));
        expect(await again).toBe(await shared);
        expect((await again)?.isIncluded(path.join(dir, 'B.cs'))).toBe(true);
        expect(service.get(fixture)?.isIncluded(path.join(dir, 'B.cs'))).toBe(true);
        expect(run).toHaveBeenCalledTimes(2);
    });

    test('an evaluation that was running when the project changed is not published: its one re-run is, for every caller', async () => {
        const runs = deferredRuns();
        const service = new ProjectItemsService(runs.run);
        const listener = jest.fn();
        service.onDidEvaluate(listener);
        const before = service.evaluate(fixture);
        await settle();
        service.invalidate(fixture);
        const after = service.evaluate(fixture);
        runs.finish(output('Stale.cs'));
        await settle();
        expect(service.get(fixture)).toBeUndefined();
        expect(listener).not.toHaveBeenCalled();
        runs.finish(output('Fresh.cs'));
        expect(await before).toBe(await after);
        expect((await after)?.isIncluded(path.join(dir, 'Fresh.cs'))).toBe(true);
        expect(service.get(fixture)?.isIncluded(path.join(dir, 'Stale.cs'))).toBe(false);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(service.version(fixture)).toBe(1);
        expect(runs.calls).toBe(2);
    });

    test('a stale evaluation finishing late does not overwrite the last good result', async () => {
        const runs = deferredRuns();
        const service = new ProjectItemsService(runs.run);
        const first = service.evaluate(fixture);
        await settle();
        runs.finish(output('A.cs'));
        await first;
        service.invalidate(fixture);
        const stale = service.evaluate(fixture);
        await settle();
        service.invalidate(fixture);
        const fresh = service.evaluate(fixture);
        runs.finish(output('Stale.cs'));
        await settle();
        expect(service.get(fixture)?.isIncluded(path.join(dir, 'A.cs'))).toBe(true);
        expect(service.get(fixture)?.isIncluded(path.join(dir, 'Stale.cs'))).toBe(false);
        runs.finish(output('Fresh.cs'));
        await Promise.all([stale, fresh]);
        expect(service.get(fixture)?.isIncluded(path.join(dir, 'Fresh.cs'))).toBe(true);
        expect(runs.calls).toBe(3);
    });

    test('100 changes during a run start exactly one more MSBuild, never two at once, and all callers get its result', async () => {
        const runs = deferredRuns();
        const service = new ProjectItemsService(runs.run);
        const first = service.evaluate(fixture);
        await settle();
        const callers = Array.from({ length: 100 }, () => {
            service.invalidate(fixture);
            return service.evaluate(fixture);
        });
        expect(runs.calls).toBe(1);
        runs.finish(output('Stale.cs'));
        await settle();
        expect(runs.calls).toBe(2);
        runs.finish(output('Fresh.cs'));
        const results = await Promise.all([first, ...callers]);
        expect(new Set(results).size).toBe(1);
        expect(results[0]?.isIncluded(path.join(dir, 'Fresh.cs'))).toBe(true);
        expect(runs.calls).toBe(2);
        expect(runs.mostPerProject).toBe(1);
    });

    test('changes while a project waits for a free slot do not add a run', async () => {
        const runs = deferredRuns();
        const service = new ProjectItemsService(runs.run, 1);
        const other = path.join(dir, 'Other.csproj');
        const busy = service.evaluate(other);
        const waiting = service.evaluate(fixture);
        await settle();
        for (let i = 0; i < 10; i++) {
            service.invalidate(fixture);
            void service.evaluate(fixture);
        }
        runs.finish(output('A.cs'));
        await busy;
        await settle();
        runs.finish(output('B.cs'));
        expect((await waiting)?.isIncluded(path.join(dir, 'B.cs'))).toBe(true);
        expect(runs.calls).toBe(2);
    });

    test('a change during a failing run still gives its one re-run', async () => {
        const runs = deferredRuns();
        const service = new ProjectItemsService(runs.run);
        const result = service.evaluate(fixture);
        await settle();
        service.invalidate(fixture);
        runs.fail(new Error('half-saved csproj'));
        await settle();
        expect(runs.calls).toBe(2);
        runs.finish(output('A.cs'));
        expect((await result)?.isIncluded(path.join(dir, 'A.cs'))).toBe(true);
    });

    test('a failure after a change keeps the last good result', async () => {
        const runs = deferredRuns();
        const service = new ProjectItemsService(runs.run);
        const first = service.evaluate(fixture);
        await settle();
        runs.finish(output('A.cs'));
        await first;
        service.invalidate(fixture);
        const again = service.evaluate(fixture);
        await settle();
        service.invalidate(fixture);
        runs.finish(output('Stale.cs'));
        await settle();
        runs.fail(new Error('timeout'));
        expect((await again)?.isIncluded(path.join(dir, 'A.cs'))).toBe(true);
        expect(service.get(fixture)?.isIncluded(path.join(dir, 'Stale.cs'))).toBe(false);
        expect(runs.calls).toBe(3);
    });

    test('a failing re-evaluation keeps the last good result', async () => {
        const run = jest.fn().mockResolvedValueOnce(output('A.cs')).mockRejectedValueOnce(new Error('broken csproj'));
        const service = new ProjectItemsService(run);
        await service.evaluate(fixture);
        const version = service.version(fixture);
        service.invalidate(fixture);
        const result = await service.evaluate(fixture);
        expect(result?.isIncluded(path.join(dir, 'A.cs'))).toBe(true);
        expect(service.get(fixture)?.isIncluded(path.join(dir, 'A.cs'))).toBe(true);
        expect(service.version(fixture)).toBe(version);
        expect(run).toHaveBeenCalledTimes(2);
    });

    test('the version changes only when the cached result changes', async () => {
        const run = jest.fn()
            .mockResolvedValueOnce(output('A.cs'))
            .mockResolvedValueOnce(output('A.cs'))
            .mockResolvedValueOnce(output('A.cs', 'B.cs'));
        const service = new ProjectItemsService(run);
        const initial = service.version(fixture);
        await service.evaluate(fixture);
        const first = service.version(fixture);
        expect(first).not.toBe(initial);
        service.invalidate(fixture);
        await service.evaluate(fixture);
        expect(service.version(fixture)).toBe(first);
        service.invalidate(fixture);
        await service.evaluate(fixture);
        expect(service.version(fixture)).not.toBe(first);
    });

    test('a failing MSBuild gives undefined and does not throw; it is not retried before the first delay', async () => {
        let clock = 1000;
        const run = jest.fn().mockRejectedValue(new Error('no sdk'));
        const service = new ProjectItemsService(run, 2, () => clock);
        expect(await service.evaluate(fixture)).toBeUndefined();
        clock += RETRY_DELAYS_MS[0] - 1;
        expect(await service.evaluate(fixture)).toBeUndefined();
        expect(service.get(fixture)).toBeUndefined();
        expect(run).toHaveBeenCalledTimes(1);
        service.invalidate(fixture);
        expect(await service.evaluate(fixture)).toBeUndefined();
        expect(run).toHaveBeenCalledTimes(2);
    });

    test('a failed evaluation is retried once its delay has passed, and the list it then gets is published', async () => {
        let clock = 1000;
        const run = jest.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue(output('A.cs'));
        const service = new ProjectItemsService(run, 2, () => clock);
        expect(await service.evaluate(fixture)).toBeUndefined();
        expect(service.retryDue(fixture)).toBe(false);
        clock += RETRY_DELAYS_MS[0];
        expect(service.retryDue(fixture)).toBe(true);
        expect((await service.evaluate(fixture))?.isIncluded(path.join(dir, 'A.cs'))).toBe(true);
        expect(service.version(fixture)).toBe(1);
        expect(service.retryDue(fixture)).toBe(false);
        expect(service.retryDelay(fixture)).toBeUndefined();
        await service.evaluate(fixture);
        expect(run).toHaveBeenCalledTimes(2);
    });

    test('the delays grow with each failure in a row; after the last one the project no longer retries by itself', async () => {
        let clock = 1000;
        const service = new ProjectItemsService(jest.fn().mockRejectedValue(new Error('timeout')), 2, () => clock);
        expect(service.retryDelay(fixture)).toBeUndefined();
        const delays: (number | undefined)[] = [];
        await service.evaluate(fixture);
        for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
            delays.push(service.retryDelay(fixture));
            clock += service.retryDelay(fixture)!;
            await service.evaluate(fixture);
        }
        expect(delays).toEqual([...RETRY_DELAYS_MS]);
        expect(service.retryDelay(fixture)).toBeUndefined();
        // Asked for again (a folder expanded), it still runs MSBuild once the last delay has passed
        clock += RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
        expect(service.retryDue(fixture)).toBe(true);
    });

    test('a failure that keeps the last good list is retried too, and the retry replaces the list', async () => {
        let clock = 1000;
        const run = jest.fn()
            .mockResolvedValueOnce(output('A.cs'))
            .mockRejectedValueOnce(new Error('timeout'))
            .mockResolvedValueOnce(output('B.cs'));
        const service = new ProjectItemsService(run, 2, () => clock);
        await service.evaluate(fixture);
        service.invalidate(fixture);
        expect((await service.evaluate(fixture))?.isIncluded(path.join(dir, 'A.cs'))).toBe(true);
        expect(service.retryDelay(fixture)).toBe(RETRY_DELAYS_MS[0]);
        clock += RETRY_DELAYS_MS[0];
        expect((await service.evaluate(fixture))?.isIncluded(path.join(dir, 'B.cs'))).toBe(true);
        expect(run).toHaveBeenCalledTimes(3);
    });

    test('evaluatedAt is when the MSBuild run of the published list started: the re-run after a change, not the outdated run', async () => {
        const runs = deferredRuns();
        let clock = 1000;
        const service = new ProjectItemsService(runs.run, 2, () => clock);
        expect(service.evaluatedAt(fixture)).toBeUndefined();
        const result = service.evaluate(fixture);
        await settle();
        clock = 2000;
        service.invalidate(fixture);
        runs.finish(output('Stale.cs'));
        await settle();
        clock = 3000;
        runs.finish(output('Fresh.cs'));
        await result;
        expect(service.evaluatedAt(fixture)).toBe(2000);
    });

    test('evaluatedAt moves on when an evaluation confirms the same list, and stays when one fails', async () => {
        let clock = 1000;
        const run = jest.fn()
            .mockResolvedValueOnce(output('A.cs'))
            .mockResolvedValueOnce(output('A.cs'))
            .mockRejectedValueOnce(new Error('broken csproj'));
        const service = new ProjectItemsService(run, 2, () => clock);
        await service.evaluate(fixture);
        const version = service.version(fixture);
        clock = 5000;
        service.invalidate(fixture);
        await service.evaluate(fixture);
        expect(service.evaluatedAt(fixture)).toBe(5000);
        expect(service.version(fixture)).toBe(version);
        clock = 9000;
        service.invalidate(fixture);
        await service.evaluate(fixture);
        expect(service.evaluatedAt(fixture)).toBe(5000);
    });

    test('tells listeners when a project was evaluated', async () => {
        const service = new ProjectItemsService(jest.fn().mockResolvedValue(output('A.cs')));
        const listener = jest.fn();
        service.onDidEvaluate(listener);
        await service.evaluate(fixture);
        expect(listener).toHaveBeenCalledWith(fixture);
    });

    test('a throwing listener does not make the evaluation reject and later listeners still run', async () => {
        const service = new ProjectItemsService(jest.fn().mockResolvedValue(output('A.cs')));
        const later = jest.fn();
        service.onDidEvaluate(() => { throw new Error('listener failed'); });
        service.onDidEvaluate(later);
        const items = await service.evaluate(fixture);
        expect(items?.isIncluded(path.join(dir, 'A.cs'))).toBe(true);
        expect(later).toHaveBeenCalledWith(fixture);
    });

    test('the disposable of onDidEvaluate stops the notifications', async () => {
        const service = new ProjectItemsService(jest.fn().mockResolvedValue(output('A.cs')));
        const listener = jest.fn();
        service.onDidEvaluate(listener).dispose();
        await service.evaluate(fixture);
        expect(listener).not.toHaveBeenCalled();
    });

    test('never runs more MSBuild processes at once than the limit, and runs them all', async () => {
        let running = 0;
        let most = 0;
        const finishers: (() => void)[] = [];
        const run = jest.fn().mockImplementation(() => new Promise<string>(resolve => {
            running++;
            most = Math.max(most, running);
            finishers.push(() => { running--; resolve(output('A.cs')); });
        }));
        const service = new ProjectItemsService(run, 2);
        const projects = [1, 2, 3, 4, 5].map(i => path.join(dir, `P${i}.csproj`));
        const all = Promise.all(projects.map(project => service.evaluate(project)));
        const settle = () => new Promise(resolve => setTimeout(resolve, 0));
        await settle();
        expect(run).toHaveBeenCalledTimes(2);
        while (finishers.length > 0) {
            finishers.shift()!();
            await settle();
        }
        await all;
        expect(run).toHaveBeenCalledTimes(5);
        expect(most).toBe(2);
    });

    test('a failing run frees its slot', async () => {
        const run = jest.fn().mockRejectedValueOnce(new Error('no sdk')).mockResolvedValue(output('A.cs'));
        const service = new ProjectItemsService(run, 1);
        await service.evaluate(path.join(dir, 'P1.csproj'));
        expect(await service.evaluate(path.join(dir, 'P2.csproj'))).toBeDefined();
    });

    const hasDotnet = spawnSync('dotnet', ['--version']).status === 0;
    (hasDotnet ? test : test.skip)('real MSBuild: Remove, DefaultItemExcludes and Link are followed', async () => {
        const items = await new ProjectItemsService().evaluate(fixture);
        expect(items).toBeDefined();
        expect(items!.isIncluded(path.join(dir, 'Program.cs'))).toBe(true);
        expect(items!.isIncluded(path.join(dir, 'notes.txt'))).toBe(true);
        expect(items!.isIncluded(path.join(dir, 'Legacy', 'Old.cs'))).toBe(false);
        expect(items!.isIncluded(path.join(dir, 'Excluded', 'Skip.cs'))).toBe(false);
        expect(items!.linkedFilesIn(path.join(dir, 'Linked')).map(item => path.basename(item.fullPath))).toEqual(['Shared.cs']);
    }, 150000);

    (hasDotnet ? test : test.skip)('real MSBuild: a half-saved project file fails, and the retry after the delay reads the saved one', async () => {
        // realpath: on Windows os.tmpdir() can be an 8.3 short path (RUNNER~1) while MSBuild reports the long one
        const scratch = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'items-retry-')));
        try {
            const project = path.join(scratch, 'App.csproj');
            const saved = '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net8.0</TargetFramework>\n  </PropertyGroup>\n</Project>\n';
            fs.writeFileSync(path.join(scratch, 'A.cs'), 'class A { }\n');
            fs.writeFileSync(project, saved.slice(0, 60));
            let clock = 1000;
            const service = new ProjectItemsService(undefined, 2, () => clock);
            expect(await service.evaluate(project)).toBeUndefined();
            fs.writeFileSync(project, saved);
            expect(await service.evaluate(project)).toBeUndefined();
            clock += RETRY_DELAYS_MS[0];
            expect((await service.evaluate(project))?.isIncluded(path.join(scratch, 'A.cs'))).toBe(true);
        } finally {
            fs.rmSync(scratch, { recursive: true, force: true });
        }
    }, 150000);

    describe('packages from the same evaluation', () => {
        const withPackages = (version: string) => JSON.stringify({
            Properties: { ManagePackageVersionsCentrally: 'true', DirectoryPackagesPropsPath: path.join(dir, 'Directory.Packages.props') },
            Items: {
                Compile: [{ Identity: 'A.cs', FullPath: path.join(dir, 'A.cs') }],
                PackageReference: [{ Identity: 'Serilog', FullPath: path.join(dir, 'Serilog'), DefiningProjectFullPath: fixture }],
                PackageVersion: [{ Identity: 'Serilog', Version: version, DefiningProjectFullPath: path.join(dir, 'Directory.Packages.props') }],
            },
        });

        test('one MSBuild run gives the items and the packages', async () => {
            const run = jest.fn().mockResolvedValue(withPackages('3.1.1'));
            const service = new ProjectItemsService(run);
            expect((await service.evaluatePackages(fixture))?.references).toEqual([
                { id: 'Serilog', version: '3.1.1', source: 'central', versionFile: path.join(dir, 'Directory.Packages.props') },
            ]);
            expect(service.get(fixture)?.isIncluded(path.join(dir, 'A.cs'))).toBe(true);
            expect(service.get(fixture)?.isIncluded(path.join(dir, 'Serilog'))).toBe(false);
            expect(run).toHaveBeenCalledTimes(1);
        });

        test('packagesVersion changes when only the packages changed (a Directory.Packages.props edit), not otherwise', async () => {
            const run = jest.fn().mockResolvedValueOnce(withPackages('3.1.1')).mockResolvedValueOnce(withPackages('3.1.1')).mockResolvedValueOnce(withPackages('4.0.0'));
            const service = new ProjectItemsService(run);
            await service.evaluate(fixture);
            const first = service.packagesVersion(fixture);
            const items = service.version(fixture);
            service.invalidate(fixture);
            await service.evaluate(fixture);
            expect(service.packagesVersion(fixture)).toBe(first);
            service.invalidate(fixture);
            await service.evaluate(fixture);
            expect(service.packagesVersion(fixture)).toBe(first + 1);
            expect(service.version(fixture)).toBe(items);
            expect(service.packages(fixture)?.references[0].version).toBe('4.0.0');
        });

        test('a failing run keeps the last packages', async () => {
            const run = jest.fn().mockResolvedValueOnce(withPackages('3.1.1')).mockRejectedValueOnce(new Error('timeout'));
            const service = new ProjectItemsService(run);
            await service.evaluate(fixture);
            service.invalidate(fixture);
            await service.evaluate(fixture);
            expect(service.packages(fixture)?.references[0].version).toBe('3.1.1');
        });

        test('an outdated run publishes no packages: only the re-run after a change does', async () => {
            const runs = deferredRuns();
            const service = new ProjectItemsService(runs.run);
            const result = service.evaluate(fixture);
            await settle();
            service.invalidate(fixture);
            runs.finish(withPackages('3.1.1'));
            await settle();
            expect(service.packages(fixture)).toBeUndefined();
            runs.finish(withPackages('4.0.0'));
            await result;
            expect(service.packages(fixture)?.references[0].version).toBe('4.0.0');
            expect(service.packagesVersion(fixture)).toBe(1);
            expect(runs.mostPerProject).toBe(1);
        });
    });
});
