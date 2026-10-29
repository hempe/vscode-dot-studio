import { NodeId, NodeIdService } from '../solution/nodeIdService';
import { ProjectChild } from '../../types';
import { SolutionService } from '../solution/solutionService';
import { activeFrameworkOf } from '../project/projectFramework';
import { packageDependencies, PackageGraph, readPackageGraph } from './packageGraph';

const graphOf = (projectPath: string): PackageGraph | undefined => readPackageGraph(projectPath, activeFrameworkOf(projectPath));

/** Nodes for the packages a package depends on */
function dependencyNodes(graph: PackageGraph, projectPath: string, parents: string[], id: string): ProjectChild[] {
    return packageDependencies(graph, id).map(dependency => ({
        type: 'transitivePackage',
        name: `${dependency.id} (${dependency.version})`,
        nodeId: NodeIdService.generateTransitivePackageId(projectPath, [...parents, id], dependency.id, dependency.version),
        hasChildren: packageDependencies(graph, dependency.id).length > 0,
    }));
}

/**
 * Children of Dependencies > Packages and of the packages in it, like Visual Studio: every package expands
 * to the packages it depends on, with the versions the last restore resolved (`obj/project.assets.json`).
 * Returns undefined for other nodes.
 */
export function packageChildren(node: NodeId): ProjectChild[] | undefined {
    if (node.type === 'dependencyCategory' && node.name === 'packages') {
        const direct = SolutionService.getActiveSolution()?.getProject(node.path)?.getDependenciesByCategory(node) ?? [];
        const graph = graphOf(node.path);
        return direct.map(child => {
            const parsed = NodeIdService.parse(child.nodeId);
            const id = parsed.type === 'dependency' ? parsed.name : child.name;
            return { ...child, hasChildren: !!graph && packageDependencies(graph, id).length > 0 };
        });
    }
    if (node.type === 'dependency' && node.category === 'packages') {
        const graph = graphOf(node.path);
        return graph ? dependencyNodes(graph, node.path, [], node.name) : [];
    }
    if (node.type === 'transitivePackage') {
        const graph = graphOf(node.path);
        return graph ? dependencyNodes(graph, node.path, node.parents, node.name) : [];
    }
    return undefined;
}
