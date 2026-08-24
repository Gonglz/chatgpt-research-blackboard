/**
 * Local persistence for Research Blackboard.
 *
 * v0.2 still uses chrome.storage.local, but now persists graph metadata used by
 * the automatic Graph Delta engine (applied assistant messages + focus).
 */
const SCHEMA_VERSION = 2;
const KEY_PREFIX = 'researchBlackboard:';

function keyForConversation(conversationId) {
  return `${KEY_PREFIX}${conversationId}`;
}

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

export async function loadResearchGraph(conversationId) {
  if (!conversationId) return emptyGraph();

  try {
    const key = keyForConversation(conversationId);
    const result = await chrome.storage.local.get([key]);
    const stored = result?.[key];

    if (!stored || !Array.isArray(stored.nodes) || !Array.isArray(stored.edges)) {
      return emptyGraph();
    }

    return {
      schemaVersion: stored.schemaVersion || 1,
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
  } catch (error) {
    console.warn('[ResearchBlackboard] load failed:', error?.message);
    return emptyGraph();
  }
}

/**
 * Save graph state while preserving metadata written by the Graph Delta engine.
 * Existing callers may omit metadataPatch safely.
 */
export async function saveResearchGraph(conversationId, nodes, edges, metadataPatch = {}) {
  if (!conversationId) return;

  const key = keyForConversation(conversationId);
  let existingMetadata = {};

  try {
    const result = await chrome.storage.local.get([key]);
    existingMetadata = result?.[key]?.metadata || {};
  } catch {
    // Preserve normal save behavior even if the read fails.
  }

  await chrome.storage.local.set({
    [key]: {
      schemaVersion: SCHEMA_VERSION,
      conversationId,
      nodes,
      edges,
      metadata: {
        appliedDeltaMessageIds: [],
        focusNodeId: null,
        lastDeltaAt: null,
        ...existingMetadata,
        ...metadataPatch
      },
      updatedAt: Date.now()
    }
  });
}

export async function clearResearchGraph(conversationId) {
  if (!conversationId) return;
  await chrome.storage.local.remove(keyForConversation(conversationId));
}
