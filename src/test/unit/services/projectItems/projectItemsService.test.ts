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

    test('invalidate makes the next evaluation run again', async () => {
        const run = jest.fn().mockResolvedValueOnce(output('A.cs')).mockResolvedValueOnce(output('B.cs'));
        const service = new ProjectItemsService(run);
        await service.evaluate(fixture);
        service.invalidate(fixture);
        expect(service.get(fixture)).toBeUndefined();
        const again = await service.evaluate(fixture);
        expect(again?.isIncluded(path.join(dir, 'B.cs'))).toBe(true);
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

    test('a failing MSBuild gives undefined, is not retried until invalidated, and does not throw', async () => {
        const run = jest.fn().mockRejectedValue(new Error('no sdk'));
        const service = new ProjectItemsService(run);
        expect(await service.evaluate(fixture)).toBeUndefined();
        expect(await service.evaluate(fixture)).toBeUndefined();
        expect(run).toHaveBeenCalledTimes(1);
        service.invalidate(fixture);
        await service.evaluate(fixture);
        expect(run).toHaveBeenCalledTimes(2);
    });

    test('tells listeners when a project was evaluated', async () => {
        const service = new ProjectItemsService(jest.fn().mockResolvedValue(output('A.cs')));
        const listener = jest.fn();
        service.onDidEvaluate(listener);
        await service.evaluate(fixture);
        expect(listener).toHaveBeenCalledWith(fixture);
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
    }, 120000);
});
