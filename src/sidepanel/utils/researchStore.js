/**
 * Local persistence for Research Blackboard v0.1.
 *
 * v0.1 deliberately uses chrome.storage.local instead of introducing a new
 * database dependency. The schema is versioned so it can later migrate to
 * project-level IndexedDB without changing the UI contract.
 */
const SCHEMA_VERSION = 1;
const KEY_PREFIX = 'researchBlackboard:';

function keyForConversation(conversationId) {
  return `${KEY_PREFIX}${conversationId}`;
}

export async function loadResearchGraph(conversationId) {
  if (!conversationId) return { schemaVersion: SCHEMA_VERSION, nodes: [], edges: [] };

  try {
    const key = keyForConversation(conversationId);
    const result = await chrome.storage.local.get([key]);
    const stored = result?.[key];

    if (!stored || !Array.isArray(stored.nodes) || !Array.isArray(stored.edges)) {
      return { schemaVersion: SCHEMA_VERSION, nodes: [], edges: [] };
    }

    return {
      schemaVersion: stored.schemaVersion || SCHEMA_VERSION,
      nodes: stored.nodes,
      edges: stored.edges
    };
  } catch (error) {
    console.warn('[ResearchBlackboard] load failed:', error?.message);
    return { schemaVersion: SCHEMA_VERSION, nodes: [], edges: [] };
  }
}

export async function saveResearchGraph(conversationId, nodes, edges) {
  if (!conversationId) return;

  const key = keyForConversation(conversationId);
  await chrome.storage.local.set({
    [key]: {
      schemaVersion: SCHEMA_VERSION,
      conversationId,
      nodes,
      edges,
      updatedAt: Date.now()
    }
  });
}

export async function clearResearchGraph(conversationId) {
  if (!conversationId) return;
  await chrome.storage.local.remove(keyForConversation(conversationId));
}
