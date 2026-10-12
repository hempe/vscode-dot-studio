import * as path from 'path';
import { NodeId, NodeIdService } from './nodeIdService';
import { DiagnosticCounts, DiagnosticMarkers, NodeMarker, ProjectNode } from '../types';
import { NodeIdString } from '../types/nodeId';

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
export function computeMarkers(nodes: readonly ProjectNode[], fileCounts: FileCounts): DiagnosticMarkers {
    const markers: Record<NodeIdString, NodeMarker> = {};
    for (const node of nodes) {
        visit(node, fileCounts, markers);
    }
    return markers;
}

function visit(node: ProjectNode, fileCounts: FileCounts, markers: Record<NodeIdString, NodeMarker>): DiagnosticCounts {
    const childSum = (node.children ?? [])
        .map(child => visit(child, fileCounts, markers))
        .reduce(add, ZERO);

    const counts = countsFor(parseNodeId(node.nodeId), childSum, fileCounts);
    const marker = toMarker(counts);
    if (marker) {
        markers[node.nodeId] = marker;
    }
    return counts;
}

function countsFor(nodeId: NodeId | undefined, childSum: DiagnosticCounts, fileCounts: FileCounts): DiagnosticCounts {
    switch (nodeId?.type) {
        case 'file':
        case 'solutionItem':
            return add(fileCounts.get(normalizePath(nodeId.path)) ?? ZERO, childSum);
        case 'folder':
            return sumUnder(nodeId.path, fileCounts);
        case 'project':
            return sumUnder(path.dirname(nodeId.path), fileCounts);
        case 'solutionFolder':
        case 'solution':
            return childSum;
        default:
            return ZERO;
    }
}

function parseNodeId(nodeId: NodeIdString): NodeId | undefined {
    try {
        return NodeIdService.parse(nodeId);
    } catch {
        return undefined;
    }
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
