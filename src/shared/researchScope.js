export const CONVERSATION_GRAPH_PREFIX = 'researchBlackboard:';
export const PROJECT_GRAPH_PREFIX = 'researchProjectGraph:';
export const CONVERSATION_PROJECT_PREFIX = 'researchConversationProject:';
export const PROJECT_INDEX_KEY = 'researchProjects:index';
export const PROJECT_META_PREFIX = 'researchProject:';

export function conversationGraphKey(conversationId) {
  return `${CONVERSATION_GRAPH_PREFIX}${conversationId}`;
}

export function projectGraphKey(projectId) {
  return `${PROJECT_GRAPH_PREFIX}${projectId}`;
}

export function conversationProjectKey(conversationId) {
  return `${CONVERSATION_PROJECT_PREFIX}${conversationId}`;
}

export function projectMetaKey(projectId) {
  return `${PROJECT_META_PREFIX}${projectId}`;
}

export async function resolveResearchScope(conversationId) {
  if (!conversationId) {
    return {
      type: 'conversation',
      id: null,
      conversationId: null,
      projectId: null,
      graphKey: null,
      mirrorKey: null
    };
  }

  try {
    const mappingKey = conversationProjectKey(conversationId);
    const result = await chrome.storage.local.get([mappingKey]);
    const projectId = result?.[mappingKey] || null;
    if (projectId) {
      return {
        type: 'project',
        id: projectId,
        conversationId,
        projectId,
        graphKey: projectGraphKey(projectId),
        mirrorKey: conversationGraphKey(conversationId)
      };
    }
  } catch {
    // Fall back to conversation-local research state.
  }

  return {
    type: 'conversation',
    id: conversationId,
    conversationId,
    projectId: null,
    graphKey: conversationGraphKey(conversationId),
    mirrorKey: conversationGraphKey(conversationId)
  };
}

export async function loadScopedGraphRecord(conversationId) {
  const scope = await resolveResearchScope(conversationId);
  if (!scope.graphKey) return { scope, graph: null };
  const result = await chrome.storage.local.get([scope.graphKey]);
  return { scope, graph: result?.[scope.graphKey] || null };
}

export async function writeScopedGraphRecord(conversationId, graph, { mirror = true } = {}) {
  const scope = await resolveResearchScope(conversationId);
  if (!scope.graphKey) return scope;

  const updatedAt = Number(graph?.updatedAt) || Date.now();
  const payload = {
    ...graph,
    conversationId: scope.type === 'project' ? null : conversationId,
    projectId: scope.projectId || null,
    metadata: {
      ...(graph?.metadata || {}),
      researchScope: scope.type,
      projectId: scope.projectId || null
    },
    updatedAt
  };

  const writes = { [scope.graphKey]: payload };
  if (mirror && scope.type === 'project' && scope.mirrorKey) {
    writes[scope.mirrorKey] = {
      ...payload,
      conversationId,
      metadata: {
        ...(payload.metadata || {}),
        projectMirrorOf: scope.projectId,
        projectMirrorAt: Date.now()
      },
      updatedAt
    };
  }

  await chrome.storage.local.set(writes);
  return scope;
}
