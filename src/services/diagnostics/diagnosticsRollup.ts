import * as path from 'path';
import { NodeId, NodeIdService } from '../solution/nodeIdService';
import { DiagnosticCounts, DiagnosticMarkers, NodeMarker, ProjectNode } from '../../types';
import { NodeIdString } from '../../types/nodeId';

/** Per-file diagnostic counts, keyed by `normalizePath(filePath)` */
export type FileCounts = ReadonlyMap<string, DiagnosticCounts>;

const ZERO: DiagnosticCounts = { errors: 0, warnings: 0, infos: 0 };

/** Normalises a file path for use as a `FileCounts` key; Windows paths are case-insensitive */
export function normalizePath(filePath: string, platform: NodeJS.Platform = process.platform): string {
    const normalized = path.normalize(filePath);
    return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/**
 * Rolls per-file diagnostic counts up the Solution Explorer tree.
 * Files include their nested child files, folders and projects sum every file below their
 * directory (so collapsed, unloaded nodes are covered), solution folders and the solution
 * sum their children.
 */
export function computeMarkers(nodes: readonly ProjectNode[], fileCounts: FileCounts, linkedOf: LinkedFilesOf = () => []): DiagnosticMarkers {
    const markers: Record<NodeIdString, NodeMarker> = {};
    for (const node of nodes) {
        visit(node, fileCounts, markers, linkedOf, undefined);
    }
    return markers;
}

/** The files a project links from outside its folder: where they are on disk and where the tree shows them */
export type LinkedFilesOf = (projectPath: string) => readonly { fullPath: string; virtualPath: string }[];

function visit(node: ProjectNode, fileCounts: FileCounts, markers: Record<NodeIdString, NodeMarker>, linkedOf: LinkedFilesOf, projectPath: string | undefined): DiagnosticCounts {
    const nodeId = NodeIdService.tryParse(node.nodeId);
    const owner = nodeId?.type === 'project' ? nodeId.path : projectPath;
    const childSum = (node.children ?? [])
        .map(child => visit(child, fileCounts, markers, linkedOf, owner))
        .reduce(add, ZERO);

    const counts = countsFor(nodeId, childSum, fileCounts, owner ? linkedOf(owner) : []);
    const marker = toMarker(counts);
    if (marker) {
        markers[node.nodeId] = marker;
    }
    return counts;
}

function countsFor(nodeId: NodeId | undefined, childSum: DiagnosticCounts, fileCounts: FileCounts, linked: readonly { fullPath: string; virtualPath: string }[]): DiagnosticCounts {
    switch (nodeId?.type) {
        case 'file':
        case 'solutionItem':
            return add(fileCounts.get(normalizePath(nodeId.path)) ?? ZERO, childSum);
        case 'folder':
            return add(sumUnder(nodeId.path, fileCounts), sumLinked(nodeId.path, linked, fileCounts));
        case 'project':
            return add(sumUnder(path.dirname(nodeId.path), fileCounts), sumLinked(path.dirname(nodeId.path), linked, fileCounts));
        case 'solutionFolder':
        case 'solution':
            return childSum;
        default:
            return ZERO;
    }
}

/** The files linked into the folder from elsewhere: their counts belong to the folder (and its project) that shows them */
function sumLinked(directory: string, linked: readonly { fullPath: string; virtualPath: string }[], fileCounts: FileCounts): DiagnosticCounts {
    const prefix = normalizePath(directory + path.sep);
    let sum = ZERO;
    for (const item of linked) {
        // A link to a file inside the project's own folder is counted by the folder sum already
        if (normalizePath(item.virtualPath).startsWith(prefix) && !normalizePath(item.fullPath).startsWith(prefix)) {
            sum = add(sum, fileCounts.get(normalizePath(item.fullPath)) ?? ZERO);
        }
    }
    return sum;
}

function sumUnder(directory: string, fileCounts: FileCounts): DiagnosticCounts {
    const prefix = normalizePath(directory + path.sep);
    let sum = ZERO;
    for (const [file, counts] of fileCounts) {
        if (file.startsWith(prefix)) {
            sum = add(sum, counts);
        }
    }
    return sum;
}

function add(a: DiagnosticCounts, b: DiagnosticCounts): DiagnosticCounts {
    return { errors: a.errors + b.errors, warnings: a.warnings + b.warnings, infos: a.infos + b.infos };
}

function toMarker(counts: DiagnosticCounts): NodeMarker | undefined {
    const severity = counts.errors ? 'error' : counts.warnings ? 'warning' : counts.infos ? 'info' : undefined;
    return severity && { severity, ...counts };
}
