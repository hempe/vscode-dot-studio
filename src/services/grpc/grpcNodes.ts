import { NodeId, NodeIdService } from '../solution/nodeIdService';
import { ProjectChild } from '../../types';
import { pathKey } from '../project/items/projectItems';
import { ProjectItemsService } from '../project/items/projectItemsService';
import { GRPC_URL_REFERENCE } from '../../core/contextMenus';
import { referenceLabel } from './protobufReferences';

/**
 * The project's gRPC references for Connected Services, one node per `.proto` (from the last evaluation), sorted by
 * label. References added from a URL carry a context value for their Update item.
 */
export function grpcReferenceNodes(projectPath: string): ProjectChild[] {
    const seen = new Set<string>();
    return [...(ProjectItemsService.instance.get(projectPath)?.protobuf ?? [])]
        .filter(item => !seen.has(pathKey(item.fullPath)) && !!seen.add(pathKey(item.fullPath)))
        .sort((a, b) => referenceLabel(a).localeCompare(referenceLabel(b)))
        .map(item => ({
            type: 'grpcReference',
            name: referenceLabel(item),
            nodeId: NodeIdService.generateGrpcReferenceId(projectPath, item.fullPath),
            hasChildren: false,
            ...(item.sourceUrl ? { contextValue: GRPC_URL_REFERENCE } : {}),
        }));
}

/** Children of the Connected Services node of a project without that folder on disk; undefined for other nodes */
export function grpcChildren(node: NodeId): ProjectChild[] | undefined {
    return node.type === 'connectedServices' ? grpcReferenceNodes(node.path) : undefined;
}
