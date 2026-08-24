import { resolveResearchScope, writeScopedGraphRecord } from '../../shared/researchScope';
import { layoutStateForImportedGraph } from './researchLayout';

const PACKAGE_FORMAT = 'chatgpt-research-blackboard';
const SUPPORTED_NODE_TYPES = new Set(['analysis', 'comparison', 'judgment', 'question']);
const SUPPORTED_RELATIONS = new Set(['deepens', 'compares', 'supports', 'contradicts', 'informs']);

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function activeConversationContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = String(tab?.url || '');
  const match = url.match(/\/c\/([a-zA-Z0-9-]+)/);
  return {
    conversationId: match?.[1] || null,
    url,
    title: cleanText(tab?.title || 'Research Blackboard')
  };
}

function validatePackage(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid Research Blackboard package.');
  if (payload.format !== PACKAGE_FORMAT) throw new Error('This file is not a Research Blackboard package.');
  if (!payload.graph || !Array.isArray(payload.graph.nodes) || !Array.isArray(payload.graph.edges)) {
    throw new Error('Research package is missing graph data.');
  }

  const ids = new Set();
  for (const node of payload.graph.nodes) {
    if (!node || !node.id) throw new Error('Research package contains a node without an id.');
    const id = String(node.id);
    if (ids.has(id)) throw new Error(`Duplicate node id in package: ${id}`);
    ids.add(id);
  }

  for (const edge of payload.graph.edges) {
    if (!edge?.source || !edge?.target) throw new Error('Research package contains an invalid relation.');
    if (!ids.has(String(edge.source)) || !ids.has(String(edge.target))) {
      throw new Error('Research package contains a relation to a missing node.');
    }
  }

  return payload;
}

function normalizeGraph(graph, conversationId, sourceConversationId, scope) {
  const nodes = graph.nodes.map((node) => {
    const type = SUPPORTED_NODE_TYPES.has(node?.data?.type) ? node.data.type : 'analysis';
    const highlights = Array.isArray(node?.data?.highlights) ? node.data.highlights : [];
    return {
      ...node,
      id: String(node.id),
      type: 'researchNode',
      position: {
        x: Number.isFinite(Number(node?.position?.x)) ? Number(node.position.x) : 0,
        y: Number.isFinite(Number(node?.position?.y)) ? Number(node.position.y) : 0
      },
      data: {
        ...(node.data || {}),
        type,
        title: cleanText(node?.data?.title || 'Untitled research node'),
        checkpoint: String(node?.data?.checkpoint || ''),
        keywords: Array.isArray(node?.data?.keywords) ? node.data.keywords.map(cleanText).filter(Boolean).slice(0, 12) : [],
        highlights
      }
    };
  });

  const edges = graph.edges.map((edge, index) => {
    const relation = SUPPORTED_RELATIONS.has(edge?.data?.relation)
      ? edge.data.relation
      : (SUPPORTED_RELATIONS.has(edge?.label) ? edge.label : 'informs');
    return {
      ...edge,
      id: String(edge.id || `imported-edge-${index}`),
      source: String(edge.source),
      target: String(edge.target),
      type: edge.type || 'smoothstep',
      label: relation,
      data: { ...(edge.data || {}), relation }
    };
  });

  const importedAt = Date.now();
  const previousLayoutState = graph.metadata?.layoutState || {};
  const layoutState = layoutStateForImportedGraph(nodes, edges, previousLayoutState);

  return {
    schemaVersion: Math.max(2, Number(graph.schemaVersion) || 2),
    conversationId: scope?.type === 'project' ? null : conversationId,
    projectId: scope?.projectId || null,
    nodes,
    edges,
    metadata: {
      ...(graph.metadata || {}),
      selectedNodeId: null,
      researchScope: scope?.type || 'conversation',
      projectId: scope?.projectId || null,
      importedAt,
      importedFromConversationId: sourceConversationId || null,
      importSourceMatchedConversation: !!sourceConversationId && sourceConversationId === conversationId,
      layoutState
    },
    updatedAt: importedAt
  };
}

export async function importResearchPackage(file) {
  if (!file) throw new Error('Choose a .rbb.json file first.');
  const context = await activeConversationContext();
  if (!context.conversationId) throw new Error('Open a saved ChatGPT conversation before importing.');
  const scope = await resolveResearchScope(context.conversationId);

  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }

  validatePackage(payload);

  const sourceConversationId = payload?.conversation?.conversationId
    || payload?.conversation?.id
    || payload?.graph?.conversationId
    || null;

  if (sourceConversationId && sourceConversationId !== context.conversationId) {
    const ok = window.confirm(
      'This package was exported from another ChatGPT conversation.\n\n' +
      'The graph can be imported, but source-message jumps only work where the package contains usable conversation provenance.\n\n' +
      'Import anyway?'
    );
    if (!ok) return 'Import cancelled';
  }

  const existingRecord = scope.graphKey ? await chrome.storage.local.get([scope.graphKey]) : {};
  const existing = scope.graphKey ? existingRecord?.[scope.graphKey] : null;
  if (existing?.nodes?.length) {
    const scopeName = scope.type === 'project' ? 'current Project Blackboard' : 'current Blackboard';
    const ok = window.confirm(
      `Replace the ${scopeName} (${existing.nodes.length} nodes) with the imported package?\n\n` +
      'Export a backup first if you want to keep the current graph.'
    );
    if (!ok) return 'Import cancelled';
  }

  const graph = normalizeGraph(payload.graph, context.conversationId, sourceConversationId, scope);
  await writeScopedGraphRecord(context.conversationId, graph);
  return `Imported ${graph.nodes.length} nodes and ${graph.edges.length} relations${scope.type === 'project' ? ' into project' : ''}`;
}
