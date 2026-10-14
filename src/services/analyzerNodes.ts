import * as path from 'path';
import { NodeId, NodeIdService } from './nodeIdService';
import { ProjectChild } from '../types';
import { analyzerAssemblies, generatedFiles, queryAnalyzers, sourceGenerators } from './analyzers';
import { BuildConfiguration } from './buildConfiguration';
import { SolutionService } from './solutionService';

/** The framework whose analyzers and generated files are shown: the active one, if the project targets it */
function frameworkOf(projectPath: string): string | undefined {
    const solution = SolutionService.getActiveSolution();
    const frameworks = solution?.getProject(projectPath)?.frameworks ?? [];
    if (frameworks.length <= 1) {
        return undefined;
    }
    const active = solution?.getActiveFramework();
    return active && frameworks.includes(active) ? active : frameworks[0];
}

async function generatedDirOf(projectPath: string): Promise<string | undefined> {
    return (await queryAnalyzers(projectPath, BuildConfiguration.active, frameworkOf(projectPath))).generatedDir;
}

/**
 * Children of Dependencies > Analyzers and below, like Visual Studio: the analyzer assemblies, the source
 * generators of an assembly and the files a generator wrote in the last build.
 * Returns undefined for other nodes.
 */
export async function analyzerChildren(node: NodeId): Promise<ProjectChild[] | undefined> {
    if (node.type === 'dependencyCategory' && node.name === 'analyzers') {
        const { analyzers, generatedDir } = await queryAnalyzers(node.path, BuildConfiguration.active, frameworkOf(node.path));
        return analyzerAssemblies(analyzers, generatedDir).map(analyzer => ({
            type: 'analyzer',
            name: analyzer.name,
            nodeId: NodeIdService.generateAnalyzerId(node.path, analyzer.name),
            hasChildren: analyzer.hasGenerated,
        }));
    }
    if (node.type === 'analyzer') {
        const generatedDir = await generatedDirOf(node.path);
        return (generatedDir ? sourceGenerators(generatedDir, node.name) : []).map(generator => ({
            type: 'sourceGenerator',
            name: generator,
            nodeId: NodeIdService.generateSourceGeneratorId(node.path, node.name, generator),
            hasChildren: true,
        }));
    }
    if (node.type === 'sourceGenerator') {
        const generatedDir = await generatedDirOf(node.path);
        return (generatedDir ? generatedFiles(generatedDir, node.analyzer, node.name) : []).map(file => ({
            type: 'generatedFile',
            name: path.basename(file),
            nodeId: NodeIdService.generateGeneratedFileId(file),
        }));
    }
    return undefined;
}
