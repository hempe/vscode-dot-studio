import { NodeId, NodeIdService } from '../services/solution/nodeIdService';
import type { ProjectChild } from '../types';
import type { PackageVersionSource } from '../services/nuget/types';

export interface ProjectDependency {
    name: string;
    version?: string;
    type?: 'PackageReference' | 'ProjectReference' | 'Reference' | 'FrameworkReference' | undefined;
    /** Packages: where the version comes from; undefined until MSBuild has evaluated the project */
    versionSource?: PackageVersionSource;
    /** Packages: the file the version is written in */
    versionFile?: string;
    /** Packages: the PackageReference is written in a props file (Directory.Build.props), not in the project file */
    inherited?: true;
}

/** The tree's name of a reference: `Serilog (3.1.1)`, `Newtonsoft.Json (13.0.2, override)`, `X (8.0.0, global)` */
export function dependencyLabel(dependency: ProjectDependency): string {
    const source = dependency.versionSource === 'override' || dependency.versionSource === 'global' ? dependency.versionSource : undefined;
    const details = [dependency.version, source].filter(Boolean).join(', ');
    return details ? `${dependency.name} (${details})` : dependency.name;
}


/** The categories under a project's Dependencies node. Always all of them, so the context menus can add to an empty one. */
export function dependencyCategories(projectPath: string, dependencies: readonly ProjectDependency[], frameworkNames: readonly string[]): ProjectChild[] {
    const count = (type: ProjectDependency['type']) => dependencies.filter(dependency => dependency.type === type).length;
    const category = (name: string, key: string, hasChildren: boolean): ProjectChild => ({
        type: 'dependencyCategory',
        name,
        nodeId: NodeIdService.generateDependencyCategoryId(projectPath, key),
        contextValue: key,
        hasChildren,
    });
    return [
        // Listed by MSBuild when expanded; every SDK project has some
        category('Analyzers', 'analyzers', true),
        // The shared frameworks, implicit ones included (from MSBuild; the explicit ones of the project file until it answers)
        category('Frameworks', 'frameworks', frameworkNames.length > 0),
        category('Packages', 'packages', count('PackageReference') > 0),
        category('Projects', 'projects', count('ProjectReference') > 0),
        category('Assemblies', 'assemblies', count('Reference') > 0),
    ];
}

const CATEGORY_TYPES: Readonly<Record<string, ProjectDependency['type']>> = {
    packages: 'PackageReference',
    projects: 'ProjectReference',
    assemblies: 'Reference',
};

/** The children of one dependency category node: its packages, projects, assemblies or shared frameworks */
export function dependencyNodes(projectPath: string, dependencies: readonly ProjectDependency[], frameworkNames: readonly string[], category: NodeId): ProjectChild[] {
    if (category.type !== 'dependencyCategory') {
        return [];
    }
    if (category.name === 'frameworks') {
        return frameworkNames.map(name => ({
            type: 'frameworkReference' as const,
            name,
            nodeId: NodeIdService.generateFrameworkReferenceId(projectPath, name),
            hasChildren: false,
        }));
    }
    const type = CATEGORY_TYPES[category.name];
    return type
        ? dependencies.filter(dependency => dependency.type === type).map(dependency => ({
            type: 'dependency' as const,
            name: dependencyLabel(dependency),
            nodeId: NodeIdService.generateDependencyId(projectPath, category.name, dependency.name, dependency.version),
            hasChildren: false,
        }))
        : [];
}
