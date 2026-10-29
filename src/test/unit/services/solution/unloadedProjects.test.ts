import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { solutionFilterContent, UnloadedProjects } from '../../../../services/solution/unloadedProjects';

class Memento {
    private values = new Map<string, unknown>();
    get<T>(key: string): T | undefined { return this.values.get(key) as T | undefined; }
    async update(key: string, value: unknown) { this.values.set(key, value); }
}

describe('UnloadedProjects', () => {
    const dir = path.join(os.tmpdir(), 'shinobi-unloaded-test');
    const solution = path.join(dir, 'App.slnx');
    const web = path.join(dir, 'src', 'Web', 'Web.csproj');
    const core = path.join(dir, 'src', 'Core', 'Core.csproj');

    beforeEach(() => UnloadedProjects.initialize(new Memento() as never));
    afterEach(() => fs.rmSync(path.dirname(UnloadedProjects.filterPath(solution)), { recursive: true, force: true }));

    it('remembers unloaded projects per solution until they are reloaded', async () => {
        await UnloadedProjects.setUnloaded(solution, web, true);
        expect(UnloadedProjects.isUnloaded(solution, web)).toBe(true);
        expect(UnloadedProjects.isUnloaded(solution, core)).toBe(false);
        expect(UnloadedProjects.isUnloaded(path.join(dir, 'Other.slnx'), web)).toBe(false);

        await UnloadedProjects.setUnloaded(solution, web, false);
        expect(UnloadedProjects.list(solution)).toEqual([]);
    });

    it('notifies when a project is unloaded or reloaded', async () => {
        const changed = jest.fn();
        const subscription = UnloadedProjects.onDidChange(changed);
        await UnloadedProjects.setUnloaded(solution, web, true);
        await UnloadedProjects.setUnloaded(solution, web, false);
        expect(changed).toHaveBeenCalledTimes(2);
        subscription.dispose();
    });

    it('builds the solution itself while nothing is unloaded', () => {
        expect(UnloadedProjects.buildTarget(solution, [web, core])).toBe(solution);
    });

    it('builds through a solution filter without the unloaded projects', async () => {
        await UnloadedProjects.setUnloaded(solution, web, true);
        const target = UnloadedProjects.buildTarget(solution, [web, core]);

        expect(target).toBe(UnloadedProjects.filterPath(solution));
        expect(target.endsWith('.slnf')).toBe(true);
        expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toEqual({ solution: { path: solution, projects: ['src/Core/Core.csproj'] } });
    });
});

describe('solutionFilterContent', () => {
    it('lists the projects relative to the solution with forward slashes', () => {
        const solution = path.join(path.sep, 'repo', 'App.sln');
        const content = solutionFilterContent(solution, [path.join(path.sep, 'repo', 'src', 'A', 'A.csproj')]);
        expect(JSON.parse(content).solution.projects).toEqual(['src/A/A.csproj']);
    });
});
