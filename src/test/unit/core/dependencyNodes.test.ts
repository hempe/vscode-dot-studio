jest.mock('vscode', () => ({}), { virtual: true });

import { dependencyCategories, dependencyNodes, dependencyLabel, ProjectDependency } from '../../../core/dependencyNodes';
import { NodeIdService } from '../../../services/nodeIdService';

const project = '/w/App/App.csproj';
const dependencies: ProjectDependency[] = [
    { name: 'Serilog', version: '3.1.1', type: 'PackageReference' },
    { name: 'Newtonsoft.Json', version: '13.0.2', type: 'PackageReference', versionSource: 'override' },
    { name: 'Core', type: 'ProjectReference' },
];

describe('dependency nodes', () => {
    it('always lists the five categories, with children where there is something', () => {
        const categories = dependencyCategories(project, dependencies, ['Microsoft.NETCore.App']);
        expect(categories.map(category => `${category.name}:${category.hasChildren}`)).toEqual(['Analyzers:true', 'Frameworks:true', 'Packages:true', 'Projects:true', 'Assemblies:false']);
        expect(categories.map(category => category.contextValue)).toEqual(['analyzers', 'frameworks', 'packages', 'projects', 'assemblies']);
        expect(dependencyCategories(project, [], []).filter(category => category.hasChildren).map(category => category.name)).toEqual(['Analyzers']);
    });

    it('lists the packages of the packages category with their version labels', () => {
        const node = NodeIdService.parse(NodeIdService.generateDependencyCategoryId(project, 'packages'));
        const nodes = dependencyNodes(project, dependencies, [], node);
        expect(nodes.map(child => child.name)).toEqual(['Serilog (3.1.1)', 'Newtonsoft.Json (13.0.2, override)']);
        expect(nodes.every(child => child.type === 'dependency' && child.hasChildren === false)).toBe(true);
    });

    it('lists projects, shared frameworks, and nothing for an unknown category or a node that is not a category', () => {
        const category = (name: string) => NodeIdService.parse(NodeIdService.generateDependencyCategoryId(project, name));
        expect(dependencyNodes(project, dependencies, [], category('projects')).map(child => child.name)).toEqual(['Core']);
        expect(dependencyNodes(project, dependencies, ['Microsoft.AspNetCore.App'], category('frameworks')).map(child => `${child.type}:${child.name}`)).toEqual(['frameworkReference:Microsoft.AspNetCore.App']);
        expect(dependencyNodes(project, dependencies, [], category('assemblies'))).toEqual([]);
        expect(dependencyNodes(project, dependencies, [], category('nothing'))).toEqual([]);
        expect(dependencyNodes(project, dependencies, [], NodeIdService.parse(NodeIdService.generateProjectId(project)))).toEqual([]);
    });

    it('labels a global package', () => {
        expect(dependencyLabel({ name: 'X', version: '8.0.0', versionSource: 'global' })).toBe('X (8.0.0, global)');
        expect(dependencyLabel({ name: 'Y' })).toBe('Y');
    });
});
