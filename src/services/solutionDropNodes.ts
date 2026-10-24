import * as fs from 'fs';
import * as path from 'path';
import { Solution } from '../core/Solution';
import { DropAncestor, DropNode } from '../core/dropRules';
import { SolutionFileParser } from '../parsers/solutionFileParser';
import { NodeId, NodeIdService } from './nodeIdService';
import { UnloadedProjects } from './unloadedProjects';
import { NodeIdString } from '../types/nodeId';

const sameGuid = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toUpperCase() === b.toUpperCase();
const samePath = (a: string, b: string) => process.platform === 'win32'
    ? path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase()
    : path.normalize(a) === path.normalize(b);
const isInside = (dir: string, fileOrFolder: string) => {
    const relative = path.relative(dir, fileOrFolder);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const statOf = (file: string) => {
    try {
        return fs.statSync(file);
    } catch {
        return undefined;
    }
};

/** Parses an id from the webview; undefined for anything that is not a node id with a path */
function parseNodeId(nodeIdString: NodeIdString): NodeId | undefined {
    try {
        const node = NodeIdService.parse(nodeIdString);
        return node && typeof node === 'object' && typeof node.type === 'string' && typeof node.path === 'string' ? node : undefined;
    } catch {
        return undefined;
    }
}

/**
 * The drop rules' view of a node, made from the solution itself (paths, solution folders, NestedProjects) rather
 * than from the webview's tree, so a drop is checked against what is there. Ids are generated here for every node
 * alike (the rules only compare them; GUIDs upper-cased). Undefined for ids that do not parse and for nodes the
 * solution does not have: an unknown solution folder, project or solution item, a file or folder that is not on disk
 * (or is the other kind), and files outside every project folder, such as linked files.
 */
export function solutionDropNode(solution: Solution, nodeIdString: NodeIdString): DropNode | undefined {
    const model = solution.solutionFile;
    const node = parseNodeId(nodeIdString);
    if (!model || !node) {
        return undefined;
    }
    const solutionDir = path.dirname(solution.solutionPath);
    const parentGuidOf = (guid: string | undefined) => guid ? model.nestedProjects.find(n => sameGuid(n.childGuid, guid))?.parentGuid : undefined;
    const folderEntry = (guid: string | undefined) => model.projects.find(p => sameGuid(p.guid, guid) && SolutionFileParser.isSolutionFolder(p));
    const solutionFolder = (guid: string): DropAncestor | undefined => {
        const folder = folderEntry(guid);
        return folder && {
            nodeId: NodeIdService.generateSolutionFolderId(folder.name, solution.solutionPath, folder.guid.toUpperCase(), parentGuidOf(folder.guid)?.toUpperCase()),
            type: 'solutionFolder',
        };
    };
    const solutionNode: DropAncestor = { nodeId: NodeIdService.generateSolutionId(solution.solutionPath), type: 'solution' };
    /** The solution folders from `guid` up, then the solution */
    const chainFrom = (guid: string | undefined): DropAncestor[] => {
        const chain: DropAncestor[] = [];
        for (let current = guid, depth = 0; current && depth < 64; current = parentGuidOf(current), depth++) {
            const folder = solutionFolder(current);
            if (folder) {
                chain.push(folder);
            }
        }
        return [...chain, solutionNode];
    };
    const projectEntry = (projectPath: string) => model.projects.find(p =>
        !SolutionFileParser.isSolutionFolder(p) && samePath(path.resolve(solutionDir, p.path), projectPath));
    const projectId = (projectPath: string) => NodeIdService.generateProjectId(path.normalize(projectPath));
    /** The project whose folder holds the path, the innermost one */
    const projectFor = (fileOrFolder: string) => [...solution.projects.keys()]
        .filter(project => isInside(path.dirname(project), fileOrFolder))
        .sort((a, b) => path.dirname(b).length - path.dirname(a).length)[0];

    switch (node.type) {
        case 'solution':
            return samePath(node.path, solution.solutionPath) ? { ...solutionNode, ancestors: [] } : undefined;
        case 'solutionFolder': {
            const self = solutionFolder(node.guid);
            return self && { ...self, ancestors: chainFrom(parentGuidOf(node.guid)) };
        }
        case 'solutionItem': {
            const folder = folderEntry(node.guid);
            const itemPath = path.resolve(node.path);
            const listed = folder && SolutionFileParser.getSolutionItems(folder)
                .some(item => samePath(path.resolve(solutionDir, item.replace(/\\/g, path.sep).replace(/\//g, path.sep)), itemPath));
            return listed ? {
                nodeId: NodeIdService.generateSolutionItemId(path.basename(itemPath), folder.guid.toUpperCase(), itemPath),
                type: 'solutionItem',
                ancestors: chainFrom(folder.guid),
            } : undefined;
        }
        case 'project': {
            const entry = projectEntry(path.resolve(node.path));
            if (!entry) {
                return undefined;
            }
            // The path as the solution has it, as in the ancestors of its files
            const projectPath = path.resolve(solutionDir, entry.path);
            return {
                nodeId: projectId(projectPath),
                type: 'project',
                isUnloaded: UnloadedProjects.isUnloaded(solution.solutionPath, projectPath),
                ancestors: chainFrom(parentGuidOf(entry.guid)),
            };
        }
        case 'file':
        case 'folder': {
            const nodePath = path.resolve(node.path);
            const stat = statOf(nodePath);
            if (!stat || (node.type === 'file' ? !stat.isFile() : !stat.isDirectory())) {
                return undefined;
            }
            const projectPath = projectFor(nodePath);
            // Not in a project folder (a linked file), the project folder itself, or in an unloaded project (no tree)
            if (!projectPath || samePath(path.dirname(projectPath), nodePath) || samePath(projectPath, nodePath)
                || UnloadedProjects.isUnloaded(solution.solutionPath, projectPath)) {
                return undefined;
            }
            const projectDir = path.dirname(projectPath);
            const folders: DropAncestor[] = [];
            for (let dir = path.dirname(nodePath); dir.length > projectDir.length && dir !== path.dirname(dir); dir = path.dirname(dir)) {
                folders.push({ nodeId: NodeIdService.generateFolderId(dir), type: 'folder' });
            }
            return {
                nodeId: node.type === 'file' ? NodeIdService.generateFileId(nodePath) : NodeIdService.generateFolderId(nodePath),
                type: node.type,
                ancestors: [...folders, { nodeId: projectId(projectPath), type: 'project' }, ...chainFrom(parentGuidOf(projectEntry(projectPath)?.guid))],
            };
        }
        case 'dependencies':
        case 'dependencyCategory': {
            // A target for project references: the project above it keeps a project from referencing itself
            const entry = projectEntry(path.resolve(node.path));
            if (!entry || UnloadedProjects.isUnloaded(solution.solutionPath, path.resolve(solutionDir, entry.path))) {
                return undefined;
            }
            return {
                nodeId: nodeIdString,
                type: node.type,
                ...(node.type === 'dependencyCategory' ? { contextValue: node.name } : {}),
                ancestors: [{ nodeId: projectId(path.resolve(solutionDir, entry.path)), type: 'project' }, ...chainFrom(parentGuidOf(entry.guid))],
            };
        }
        default:
            // Analyzers, generated files and the like: no move and no target
            return { nodeId: nodeIdString, type: node.type, ancestors: [] };
    }
}
