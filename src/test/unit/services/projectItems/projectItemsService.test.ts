import { spawnSync } from 'child_process';
import * as path from 'path';
import { ProjectItemsService } from '../../../../services/projectItems/projectItemsService';

const fixture = path.resolve(__dirname, '../../../../__fixtures__/project-items/ItemsApp/ItemsApp.csproj');
const dir = path.dirname(fixture);
const output = (...files: string[]) => JSON.stringify({ Items: { Compile: files.map(file => ({ Identity: file, FullPath: path.join(dir, file) })) } });

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
        finish(output('B.cs'));
        expect(await again).toBe(await shared);
        expect((await again)?.isIncluded(path.join(dir, 'B.cs'))).toBe(true);
        expect(service.get(fixture)?.isIncluded(path.join(dir, 'B.cs'))).toBe(true);
        expect(run).toHaveBeenCalledTimes(2);
    });

    test('an evaluation that was running when the project changed does not fill the cache', async () => {
        let finish!: (value: string) => void;
        const run = jest.fn()
            .mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }))
            .mockResolvedValueOnce(output('Fresh.cs'));
        const service = new ProjectItemsService(run);
        const stale = service.evaluate(fixture);
        service.invalidate(fixture);
        const fresh = await service.evaluate(fixture);
        finish(output('Stale.cs'));
        await stale;
        expect(fresh?.isIncluded(path.join(dir, 'Fresh.cs'))).toBe(true);
        expect(service.get(fixture)?.isIncluded(path.join(dir, 'Fresh.cs'))).toBe(true);
    });

    test('a stale evaluation finishing late does not overwrite the last good result', async () => {
        let finish!: (value: string) => void;
        let finishFresh!: (value: string) => void;
        const run = jest.fn()
            .mockResolvedValueOnce(output('A.cs'))
            .mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }))
            .mockImplementationOnce(() => new Promise<string>(resolve => { finishFresh = resolve; }));
        const service = new ProjectItemsService(run);
        await service.evaluate(fixture);
        service.invalidate(fixture);
        const stale = service.evaluate(fixture);
        service.invalidate(fixture);
        const fresh = service.evaluate(fixture);
        finish(output('Stale.cs'));
        await stale;
        expect(service.get(fixture)?.isIncluded(path.join(dir, 'A.cs'))).toBe(true);
        expect(service.get(fixture)?.isIncluded(path.join(dir, 'Stale.cs'))).toBe(false);
        finishFresh(output('Fresh.cs'));
        await fresh;
        expect(service.get(fixture)?.isIncluded(path.join(dir, 'Fresh.cs'))).toBe(true);
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

    test('a failing MSBuild gives undefined, is not retried until invalidated, and does not throw', async () => {
        const run = jest.fn().mockRejectedValue(new Error('no sdk'));
        const service = new ProjectItemsService(run);
        expect(await service.evaluate(fixture)).toBeUndefined();
        expect(await service.evaluate(fixture)).toBeUndefined();
        expect(run).toHaveBeenCalledTimes(1);
        service.invalidate(fixture);
        expect(await service.evaluate(fixture)).toBeUndefined();
        expect(service.get(fixture)).toBeUndefined();
        expect(run).toHaveBeenCalledTimes(2);
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
});
