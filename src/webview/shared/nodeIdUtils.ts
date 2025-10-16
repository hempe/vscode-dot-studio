/**
 * Browser-safe utilities for working with NodeId strings in webview context
 * These utilities work with the string representation without compression
 */

export type NodeIdString = string;

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
    return key;
}

/**
 * Simple path extraction from nodeId for webview use
 * This is a temporary helper that works with the string format
 * The actual parsing should happen on the extension side
 */
export function extractPathFromNodeId(nodeId: NodeIdString): string | null {
    // For temporary compatibility, we'll extract paths from the string representation
    // This assumes the nodeId string contains path information
    // TODO: Remove this once all path extraction moves to extension side
    try {
        // Check if it's a simple path-like string (old format)
        if (typeof nodeId === 'string' && nodeId.includes('/') && !nodeId.includes('H4sI')) {
            return nodeId; // Return as-is for old format
        }

        // For compressed format, we can't decode it in the browser (no zlib)
        // Return null and let the component handle it differently
        return null;
    } catch {
        return null;
    }
}

/**
 * Temporary compatibility functions for webview use
 * These should be replaced with extension-side message handling
 */

export function parseNodeId(nodeId: NodeIdString): any {
    // TODO: This should be handled by extension side
    // For now, return a simple object that won't break the webview
    return {
        folderPath: extractPathFromNodeId(nodeId),
        solutionPath: extractPathFromNodeId(nodeId),
        projectPath: extractPathFromNodeId(nodeId),
    };
}

export function generateTemporaryId(parentPath: string, nodeType: string): NodeIdString {
    // TODO: This should be handled by extension side
    // For now, generate a simple temporary ID
    return `temp:${nodeType}:${parentPath}:${Date.now()}`;
}