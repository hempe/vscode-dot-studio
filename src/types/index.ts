/**
 * Extension-side type definitions
 * These use the extension's branded NodeIdString type
 */

import { Dependency } from "../parsers/projectFileParser";
import { NodeId } from "../services/nodeIdService";
import { NodeIdString } from "./nodeId";

export type NodeType = NodeId['type'];

/**
 * Extension-side ProjectChild interface using extension's NodeIdString
 */
export interface ProjectChild {
    readonly type: NodeType;
    readonly name: string;
    readonly nodeId: NodeIdString;
    readonly hasChildren?: boolean;
    readonly expanded?: boolean;
    readonly children?: ProjectChild[];
    readonly isLoaded?: boolean;
    /** Distinguishes nodes of the same type for context menus, e.g. the dependency category */
    readonly contextValue?: string;
}

/**
 * Extension-side ProjectNode interface using extension's NodeIdString
 */
export interface ProjectNode {
    // is this needed?
    readonly type: NodeType;
    readonly name: string;
    children?: ProjectNode[];
    expanded?: boolean;
    readonly isSolutionFolder?: boolean;
    readonly projectDependencies?: Dependency[];
    readonly frameworks?: string[];
    readonly typeGuid?: string;
    readonly isLoaded?: boolean;
    hasChildren?: boolean;
    readonly isLoading?: boolean;
    readonly isStartupProject?: boolean;
    readonly nodeId: NodeIdString;
    /** File name of solution and project nodes (`Api.csproj`), whose `name` has no extension */
    readonly fileName?: string;
    readonly isTemporary?: boolean;
    readonly isEditing?: boolean;
    /** Distinguishes nodes of the same type for context menus, e.g. the dependency category */
    readonly contextValue?: string;
}

export interface SolutionData {
    readonly projects: ProjectNode[];
    readonly frameworks: string[];
    readonly activeFramework?: string;
}

/** Diagnostic counts of a file, or rolled up for a tree node */
export interface DiagnosticCounts {
    readonly errors: number;
    readonly warnings: number;
    readonly infos: number;
}

/** Error/warning/info marker of a Solution Explorer node; `severity` is the most severe non-zero count */
export interface NodeMarker extends DiagnosticCounts {
    readonly severity: 'error' | 'warning' | 'info';
}

/** Markers keyed by node ID; nodes without diagnostics are absent */
export type DiagnosticMarkers = Readonly<Record<NodeIdString, NodeMarker>>;

export type Mutable<T> = {
    -readonly [P in keyof T]: T[P];
};
