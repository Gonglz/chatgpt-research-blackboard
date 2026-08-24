/**
 * Scoped persistence for Research Blackboard.
 *
 * A conversation normally owns its local graph. When attached to a Research
 * Project, the project graph becomes canonical and a conversation-local mirror
 * is maintained for content-script compatibility (selection/highlight capture).
 */
import {
  conversationGraphKey,
  resolveResearchScope
} from '../../shared/researchScope';

const SCHEMA_VERSION = 2;

function emptyGraph() {
  return {
    schemaVersion: SCHEMA_VERSION,
    nodes: [],
    edges: [],
    metadata: {
      appliedDeltaMessageIds: [],
      focusNodeId: null,
      lastDeltaAt: null
    }
  };
}

function appendSource(list, source) {
  const items = Array.isArray(list) ? [...list] : [];
  const duplicate = items.some((item) => item?.conversationId === source.conversationId && item?.messageId === source.messageId);
  if (!duplicate) items.push(source);
  return items.slice(-40);
}

function normalizeStored(stored) {
  if (!stored || !Array.isArray(stored.nodes) || !Array.isArray(stored.edges)) return emptyGraph();
  return {
    schemaVersion: stored.schemaVersion || 1,
    projectId: stored.projectId || null,
    nodes: stored.nodes,
    edges: stored.edges,
    metadata: {
      appliedDeltaMessageIds: Array.isArray(stored.metadata?.appliedDeltaMessageIds)
        ? stored.metadata.appliedDeltaMessageIds
        : [],
      focusNodeId: stored.metadata?.focusNodeId || null,
      lastDeltaAt: stored.metadata?.lastDeltaAt || null,
      ...(stored.metadata || {})
    }
  };
}

export async function loadResearchGraph(conversationId) {
  if (!conversationId) return emptyGraph();

  try {
    const scope = await resolveResearchScope(conversationId);
    const result = await chrome.storage.local.get([scope.graphKey]);
    const stored = result?.[scope.graphKey];
    const normalized = normalizeStored(stored);
    normalized.projectId = scope.projectId || normalized.projectId || null;
    normalized.metadata = {
      ...(normalized.metadata || {}),
      researchScope: scope.type,
      projectId: scope.projectId || null
    };
    return normalized;
  } catch (error) {
    console.warn('[ResearchBlackboard] load failed:', error?.message);
    return emptyGraph();
  }
}

/**
 * Save graph state while preserving Graph Delta metadata. In project mode the
 * project graph is canonical; only newly-created nodes/edges receive provenance
 * from the current conversation, while existing provenance is preserved.
 */
export async function saveResearchGraph(conversationId, nodes, edges, metadataPatch = {}) {
  if (!conversationId) return;

  const scope = await resolveResearchScope(conversationId);
  let existingMetadata = {};
  let existingNodes = [];
  let existingEdges = [];

  try {
    const result = await chrome.storage.local.get([scope.graphKey]);
    const existing = result?.[scope.graphKey] || null;
    existingMetadata = existing?.metadata || {};
    existingNodes = Array.isArray(existing?.nodes) ? existing.nodes : [];
    existingEdges = Array.isArray(existing?.edges) ? existing.edges : [];
  } catch {
    // Preserve normal save behavior even if the read fails.
  }

  const now = Date.now();
  let nextNodes = nodes;
  let nextEdges = edges;

  if (scope.type === 'project') {
    const previousNodes = new Map(existingNodes.map((node) => [node.id, node]));
    nextNodes = (nodes || []).map((node) => {
      const previous = previousNodes.get(node.id);
      if (previous) {
        return {
          ...node,
          data: {
            ...node.data,
            sources: node.data?.sources || previous.data?.sources || []
          }
        };
      }
      return {
        ...node,
        data: {
          ...node.data,
          sources: appendSource(node.data?.sources, {
            conversationId,
            messageId: node.data?.messageId || null,
            role: node.data?.messageRole || null,
            preview: node.data?.messagePreview || '',
            addedAt: now
          })
        }
      };
    });

    const previousEdges = new Map(existingEdges.map((edge) => [edge.id, edge]));
    nextEdges = (edges || []).map((edge) => {
      const previous = previousEdges.get(edge.id);
      if (previous) {
        return {
          ...edge,
          data: {
            ...edge.data,
            sources: edge.data?.sources || previous.data?.sources || []
          }
        };
      }
      return {
        ...edge,
        data: {
          ...edge.data,
          sources: appendSource(edge.data?.sources, { conversationId, messageId: null, addedAt: now })
        }
      };
    });
  }

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    conversationId: scope.type === 'conversation' ? conversationId : null,
    projectId: scope.projectId || null,
    nodes: nextNodes,
    edges: nextEdges,
    metadata: {
      appliedDeltaMessageIds: [],
      focusNodeId: null,
      lastDeltaAt: null,
      ...existingMetadata,
      ...metadataPatch,
      researchScope: scope.type,
      projectId: scope.projectId || null
    },
    updatedAt: now
  };

  const writes = { [scope.graphKey]: payload };
  if (scope.type === 'project') {
    writes[conversationGraphKey(conversationId)] = {
      ...payload,
      conversationId,
      metadata: {
        ...(payload.metadata || {}),
        projectMirrorOf: scope.projectId,
        projectMirrorAt: now
      }
    };
  }

  await chrome.storage.local.set(writes);
}

export async function clearResearchGraph(conversationId) {
  if (!conversationId) return;
  const scope = await resolveResearchScope(conversationId);
  if (scope.type === 'project') {
    await saveResearchGraph(conversationId, [], [], {
      focusNodeId: null,
      selectedNodeId: null,
      lastDeltaAt: Date.now()
    });
    return;
  }
  await chrome.storage.local.remove(conversationGraphKey(conversationId));
}
