/** The `dotnet ef` actions of the Entity Framework menu */
export type EfAction = 'addMigration' | 'updateDatabase' | 'removeMigration';

export interface EfTarget {
    /** The project with the DbContext and the migrations */
    readonly project: string;
    /** The project that supplies the connection string and the services (the web app); undefined: the project itself */
    readonly startupProject?: string;
    /** The DbContext, when the project has several */
    readonly context?: string;
}

/** `dotnet` arguments of an action (run in the project's folder) */
export function efArgs(action: EfAction, target: EfTarget, migrationName?: string): string[] {
    const options = [
        '--project', target.project,
        ...(target.startupProject ? ['--startup-project', target.startupProject] : []),
        ...(target.context ? ['--context', target.context] : []),
    ];
    switch (action) {
        case 'addMigration': return ['ef', 'migrations', 'add', migrationName ?? '', ...options];
        case 'updateDatabase': return ['ef', 'database', 'update', ...options];
        case 'removeMigration': return ['ef', 'migrations', 'remove', ...options];
    }
}

/** Why a migration name cannot be used (it becomes a C# class name), or undefined */
export function migrationNameProblem(name: string): string | undefined {
    if (!name.trim()) {
        return 'Enter a name';
    }
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
        ? undefined
        : 'Use letters, digits and underscores, not starting with a digit (the name becomes a class name)';
}

/** The DbContext class names in the output of `dotnet ef dbcontext list` (build messages and the like are left out) */
export function parseDbContexts(output: string): string[] {
    return [...new Set(output.split(/\r?\n/).map(line => line.trim()).filter(line => /^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)*$/.test(line)))];
}

/**
 * Which project supplies the startup of the tools: a project that can start is its own; a library (the usual place of
 * the DbContext) uses the solution's startup project. `needed` says there is none to use.
 */
export function efStartup(project: string, isExecutable: boolean, solutionStartup: string | null): { startupProject?: string; needed: boolean } {
    if (isExecutable) {
        return { needed: false };
    }
    if (solutionStartup && solutionStartup !== project) {
        return { startupProject: solutionStartup, needed: false };
    }
    return { needed: true };
}
