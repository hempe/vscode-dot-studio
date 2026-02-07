/**
 * Browser-safe utilities for working with NodeId strings in webview context
 * These utilities work with the string representation without compression
 */

import { NodeIdString } from "../../types/nodeId";

/**
 * Converts a NodeIdString to a React key (they're both strings in browser context)
 */
export function nodeIdToKey(nodeId: NodeIdString): string {
    return nodeId;
}

/**
 * Converts a React key back to NodeIdString (they're both strings in browser context)
 */
export function keyToNodeId(key: string): NodeIdString {
    return key as NodeIdString;
}