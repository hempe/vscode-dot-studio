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
    readonly isTemporary?: boolean;
    readonly isEditing?: boolean;
}

export interface SolutionData {
    readonly projects: ProjectNode[];
    readonly frameworks: string[];
    readonly activeFramework?: string;
}

export type Mutable<T> = {
    -readonly [P in keyof T]: T[P];
};
