import {
  PROJECT_INDEX_KEY,
  conversationGraphKey,
  conversationProjectKey,
  projectGraphKey,
  projectMetaKey,
  resolveResearchScope
} from '../../shared/researchScope';

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function makeId(prefix) {
  try {
    return `${prefix}_${crypto.randomUUID()}`;
  } catch {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

function sourceForNode(node, conversationId) {
  const messageId = node?.data?.messageId || null;
  if (!conversationId && !messageId) return null;
  return {
    conversationId: conversationId || null,
    messageId,
    role: node?.data?.messageRole || null,
    preview: node?.data?.messagePreview || '',
    addedAt: Date.now()
  };
}

function mergeSources(existing, next) {
  const result = Array.isArray(existing) ? [...existing] : [];
  for (const item of next || []) {
    if (!item) continue;
    const duplicate = result.some((candidate) => (
      candidate?.conversationId === item.conversationId
      && candidate?.messageId === item.messageId
    ));
    if (!duplicate) result.push(item);
  }
  return result.slice(-40);
}

function decorateGraphWithConversation(graph, conversationId) {
  if (!graph) return null;
  const nodes = (graph.nodes || []).map((node) => {
    const source = sourceForNode(node, conversationId);
    const highlights = Array.isArray(node?.data?.highlights)
      ? node.data.highlights.map((highlight) => ({
          ...highlight,
          conversationId: highlight.conversationId || conversationId || null
        }))
      : [];
    return {
      ...node,
      data: {
        ...(node.data || {}),
        sources: mergeSources(node?.data?.sources, source ? [source] : []),
        highlights
      }
    };
  });

  const edges = (graph.edges || []).map((edge) => ({
    ...edge,
    data: {
      ...(edge.data || {}),
      sources: mergeSources(edge?.data?.sources, conversationId ? [{ conversationId, messageId: null, addedAt: Date.now() }] : [])
    }
  }));

  return { ...graph, nodes, edges };
}

function semanticKey(node) {
  const semanticId = cleanText(node?.data?.semanticId);
  return semanticId ? `semantic:${semanticId}` : null;
}

function mergeGraphs(projectGraph, incomingGraph, conversationId) {
  const base = decorateGraphWithConversation(projectGraph || { nodes: [], edges: [], metadata: {} }, null);
  const incoming = decorateGraphWithConversation(incomingGraph || { nodes: [], edges: [], metadata: {} }, conversationId);

  const nodes = [...(base.nodes || [])];
  const edges = [...(base.edges || [])];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const bySemantic = new Map(nodes.map((node) => [semanticKey(node), node]).filter(([key]) => key));
  const idMap = new Map();

  for (const candidate of incoming.nodes || []) {
    const sKey = semanticKey(candidate);
    const semanticMatch = sKey ? bySemantic.get(sKey) : null;
    const idMatch = byId.get(candidate.id);
    const existing = semanticMatch || idMatch || null;

    if (existing) {
      const mergedHighlights = [...(existing.data?.highlights || [])];
      for (const highlight of candidate.data?.highlights || []) {
        const duplicate = mergedHighlights.some((item) => (
          item?.messageId === highlight?.messageId
          && cleanText(item?.quote) === cleanText(highlight?.quote)
          && (item?.conversationId || conversationId) === (highlight?.conversationId || conversationId)
        ));
        if (!duplicate) mergedHighlights.push(highlight);
      }

      const merged = {
        ...existing,
        data: {
          ...(existing.data || {}),
          ...(candidate.data || {}),
          title: existing.data?.titleEdited ? existing.data.title : (candidate.data?.title || existing.data?.title),
          checkpoint: existing.data?.checkpointEdited ? existing.data.checkpoint : (candidate.data?.checkpoint || existing.data?.checkpoint),
          keywords: existing.data?.keywordsEdited ? existing.data.keywords : (candidate.data?.keywords?.length ? candidate.data.keywords : existing.data?.keywords),
          sources: mergeSources(existing.data?.sources, candidate.data?.sources),
          highlights: mergedHighlights
        }
      };
      const index = nodes.findIndex((node) => node.id === existing.id);
      nodes[index] = merged;
      byId.set(existing.id, merged);
      if (sKey) bySemantic.set(sKey, merged);
      idMap.set(candidate.id, existing.id);
      continue;
    }

    let nextId = candidate.id;
    if (byId.has(nextId)) nextId = `${candidate.id}_${String(conversationId || 'chat').slice(0, 8)}`;
    const added = { ...candidate, id: nextId };
    nodes.push(added);
    byId.set(nextId, added);
    if (sKey) bySemantic.set(sKey, added);
    idMap.set(candidate.id, nextId);
  }

  for (const edge of incoming.edges || []) {
    const source = idMap.get(edge.source) || edge.source;
    const target = idMap.get(edge.target) || edge.target;
    if (!byId.has(source) || !byId.has(target)) continue;
    const relation = edge?.data?.relation || edge.label || 'informs';
    const existing = edges.find((item) => (
      item.source === source
      && item.target === target
      && (item?.data?.relation || item.label || 'informs') === relation
    ));
    if (existing) {
      existing.data = {
        ...(existing.data || {}),
        sources: mergeSources(existing.data?.sources, edge?.data?.sources)
      };
      continue;
    }
    edges.push({ ...edge, source, target });
  }

  const incomingFocus = incoming.metadata?.focusNodeId;
  return {
    ...base,
    schemaVersion: Math.max(2, Number(base.schemaVersion) || 2, Number(incoming.schemaVersion) || 2),
    nodes,
    edges,
    metadata: {
      ...(base.metadata || {}),
      focusNodeId: idMap.get(incomingFocus) || incomingFocus || base.metadata?.focusNodeId || null,
      selectedNodeId: null,
      lastProjectMergeAt: Date.now()
    },
    updatedAt: Date.now()
  };
}

export async function listResearchProjects() {
  const result = await chrome.storage.local.get([PROJECT_INDEX_KEY]);
  const ids = Array.isArray(result?.[PROJECT_INDEX_KEY]) ? result[PROJECT_INDEX_KEY] : [];
  if (!ids.length) return [];
  const keys = ids.map(projectMetaKey);
  const records = await chrome.storage.local.get(keys);
  return ids
    .map((id) => records?.[projectMetaKey(id)])
    .filter(Boolean)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

export async function getConversationProject(conversationId) {
  if (!conversationId) return null;
  const scope = await resolveResearchScope(conversationId);
  if (!scope.projectId) return null;
  const result = await chrome.storage.local.get([projectMetaKey(scope.projectId)]);
  return result?.[projectMetaKey(scope.projectId)] || null;
}

async function upsertProjectIndex(projectId) {
  const result = await chrome.storage.local.get([PROJECT_INDEX_KEY]);
  const ids = Array.isArray(result?.[PROJECT_INDEX_KEY]) ? [...result[PROJECT_INDEX_KEY]] : [];
  if (!ids.includes(projectId)) ids.push(projectId);
  await chrome.storage.local.set({ [PROJECT_INDEX_KEY]: ids });
}

export async function createResearchProject(title, conversationId, conversationTitle = '') {
  const projectId = makeId('project');
  const now = Date.now();
  const localKey = conversationGraphKey(conversationId);
  const local = conversationId ? await chrome.storage.local.get([localKey]) : {};
  const initialGraph = decorateGraphWithConversation(local?.[localKey] || {
    schemaVersion: 2,
    nodes: [],
    edges: [],
    metadata: {}
  }, conversationId);

  const meta = {
    id: projectId,
    title: cleanText(title) || 'Untitled Research Project',
    conversations: conversationId ? [{
      conversationId,
      title: cleanText(conversationTitle) || 'ChatGPT conversation',
      attachedAt: now,
      lastSeenAt: now
    }] : [],
    createdAt: now,
    updatedAt: now
  };

  const graph = {
    ...initialGraph,
    projectId,
    conversationId: null,
    metadata: {
      ...(initialGraph.metadata || {}),
      projectId,
      selectedNodeId: null
    },
    updatedAt: now
  };

  const writes = {
    [projectMetaKey(projectId)]: meta,
    [projectGraphKey(projectId)]: graph
  };
  if (conversationId) {
    writes[conversationProjectKey(conversationId)] = projectId;
    writes[localKey] = {
      ...graph,
      conversationId,
      metadata: {
        ...(graph.metadata || {}),
        projectMirrorOf: projectId,
        projectMirrorAt: now
      }
    };
  }
  await chrome.storage.local.set(writes);
  await upsertProjectIndex(projectId);
  return meta;
}

export async function attachConversationToProject(projectId, conversationId, conversationTitle = '') {
  if (!projectId || !conversationId) return null;
  const metaKey = projectMetaKey(projectId);
  const pGraphKey = projectGraphKey(projectId);
  const localKey = conversationGraphKey(conversationId);
  const records = await chrome.storage.local.get([metaKey, pGraphKey, localKey]);
  const meta = records?.[metaKey];
  if (!meta) throw new Error('Research project not found.');

  const merged = mergeGraphs(records?.[pGraphKey], records?.[localKey], conversationId);
  const conversations = Array.isArray(meta.conversations) ? [...meta.conversations] : [];
  const existingIndex = conversations.findIndex((item) => item.conversationId === conversationId);
  const entry = {
    conversationId,
    title: cleanText(conversationTitle) || conversations[existingIndex]?.title || 'ChatGPT conversation',
    attachedAt: conversations[existingIndex]?.attachedAt || Date.now(),
    lastSeenAt: Date.now()
  };
  if (existingIndex >= 0) conversations[existingIndex] = entry;
  else conversations.push(entry);

  const nextMeta = { ...meta, conversations, updatedAt: Date.now() };
  const projectGraph = {
    ...merged,
    projectId,
    metadata: { ...(merged.metadata || {}), projectId },
    updatedAt: Date.now()
  };

  await chrome.storage.local.set({
    [metaKey]: nextMeta,
    [pGraphKey]: projectGraph,
    [conversationProjectKey(conversationId)]: projectId,
    [localKey]: {
      ...projectGraph,
      conversationId,
      metadata: {
        ...(projectGraph.metadata || {}),
        projectMirrorOf: projectId,
        projectMirrorAt: Date.now()
      }
    }
  });
  return nextMeta;
}

export async function detachConversationFromProject(conversationId) {
  if (!conversationId) return null;
  const scope = await resolveResearchScope(conversationId);
  if (!scope.projectId) return null;

  const metaKey = projectMetaKey(scope.projectId);
  const pGraphKey = projectGraphKey(scope.projectId);
  const localKey = conversationGraphKey(conversationId);
  const records = await chrome.storage.local.get([metaKey, pGraphKey]);
  const projectGraph = records?.[pGraphKey] || { schemaVersion: 2, nodes: [], edges: [], metadata: {} };
  const meta = records?.[metaKey] || null;

  const localSnapshot = {
    ...projectGraph,
    projectId: null,
    conversationId,
    metadata: {
      ...(projectGraph.metadata || {}),
      projectId: null,
      projectMirrorOf: null,
      detachedFromProjectId: scope.projectId,
      detachedAt: Date.now()
    },
    updatedAt: Date.now()
  };

  const writes = { [localKey]: localSnapshot };
  if (meta) {
    writes[metaKey] = {
      ...meta,
      conversations: (meta.conversations || []).filter((item) => item.conversationId !== conversationId),
      updatedAt: Date.now()
    };
  }
  await chrome.storage.local.set(writes);
  await chrome.storage.local.remove(conversationProjectKey(conversationId));
  return meta;
}

export { decorateGraphWithConversation, mergeGraphs };
