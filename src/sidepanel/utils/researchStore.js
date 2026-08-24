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
 * Save graph state while preserving metadata written by the Graph Delta engine.
 * In project mode, the project graph is canonical and the active conversation
 * receives an exact mirror so DOM content scripts can keep using the legacy key.
 */
export async function saveResearchGraph(conversationId, nodes, edges, metadataPatch = {}) {
  if (!conversationId) return;

  const scope = await resolveResearchScope(conversationId);
  let existingMetadata = {};

  try {
    const result = await chrome.storage.local.get([scope.graphKey]);
    existingMetadata = result?.[scope.graphKey]?.metadata || {};
  } catch {
    // Preserve normal save behavior even if the read fails.
  }

  const now = Date.now();
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    conversationId: scope.type === 'conversation' ? conversationId : null,
    projectId: scope.projectId || null,
    nodes,
    edges,
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
    // Clearing while attached clears the canonical project graph as expected,
    // but keeps project membership intact.
    await saveResearchGraph(conversationId, [], [], {
      focusNodeId: null,
      selectedNodeId: null,
      lastDeltaAt: Date.now()
    });
    return;
  }
  await chrome.storage.local.remove(conversationGraphKey(conversationId));
}
