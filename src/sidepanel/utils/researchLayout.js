import ELK from 'elkjs/lib/elk.bundled.js';

const elk = new ELK();

export const RESEARCH_NODE_WIDTH = 200;
export const RESEARCH_NODE_HEIGHT = 88;

function cleanRelation(edge) {
  return String(edge?.data?.relation || edge?.label || 'informs').trim().toLowerCase();
}

function stableNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positionOf(node) {
  return {
    x: stableNumber(node?.position?.x),
    y: stableNumber(node?.position?.y)
  };
}

function distance(a, b) {
  const dx = stableNumber(a?.x) - stableNumber(b?.x);
  const dy = stableNumber(a?.y) - stableNumber(b?.y);
  return Math.sqrt(dx * dx + dy * dy);
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function blend(a, b, keepA) {
  return stableNumber(a) * keepA + stableNumber(b) * (1 - keepA);
}

/**
 * Only semantic structure that changes vertical hierarchy belongs in the layout
 * signature. Focus, selection, Highlight edits, cross-links and text edits do
 * not trigger automatic layout.
 */
export function researchStructuralSignature(nodes = [], edges = []) {
  const nodeIds = nodes.map((node) => String(node.id)).sort();
  const deepens = edges
    .filter((edge) => cleanRelation(edge) === 'deepens')
    .map((edge) => `${edge.source}>${edge.target}`)
    .sort();
  return `n:${nodeIds.join(',')}|d:${deepens.join(',')}`;
}

function createsCycle(nodeId, parentId, parentByNodeId) {
  let cursor = parentId;
  const seen = new Set();
  while (cursor) {
    if (cursor === nodeId) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = parentByNodeId[cursor] || null;
  }
  return false;
}

/**
 * Project the canonical graph into a low-volatility backbone.
 * - deepens is the only structural relation.
 * - every node gets at most one primary parent for layout.
 * - a previously valid primary parent is retained when possible.
 * - secondary deepens edges remain canonical edges, but do not control rank.
 */
export function deriveSemanticBackbone(nodes = [], edges = [], previousParentByNodeId = {}) {
  const nodeIds = new Set(nodes.map((node) => String(node.id)));
  const incoming = new Map();

  const deepensEdges = edges
    .filter((edge) => cleanRelation(edge) === 'deepens')
    .filter((edge) => nodeIds.has(String(edge.source)) && nodeIds.has(String(edge.target)) && edge.source !== edge.target)
    .slice()
    .sort((a, b) => String(a.id || `${a.source}>${a.target}`).localeCompare(String(b.id || `${b.source}>${b.target}`)));

  for (const edge of deepensEdges) {
    const target = String(edge.target);
    const list = incoming.get(target) || [];
    list.push(edge);
    incoming.set(target, list);
  }

  const parentByNodeId = {};
  const backboneEdgeIds = new Set();
  const orderedNodes = nodes.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));

  for (const node of orderedNodes) {
    const nodeId = String(node.id);
    const candidates = incoming.get(nodeId) || [];
    if (!candidates.length) continue;

    const previousParent = previousParentByNodeId?.[nodeId] || null;
    const preferred = previousParent
      ? candidates.find((edge) => String(edge.source) === String(previousParent))
      : null;
    const orderedCandidates = preferred
      ? [preferred, ...candidates.filter((edge) => edge !== preferred)]
      : candidates;

    for (const edge of orderedCandidates) {
      const parentId = String(edge.source);
      if (createsCycle(nodeId, parentId, parentByNodeId)) continue;
      parentByNodeId[nodeId] = parentId;
      backboneEdgeIds.add(String(edge.id || `${edge.source}>${edge.target}`));
      break;
    }
  }

  const childrenByNodeId = {};
  for (const node of nodes) childrenByNodeId[String(node.id)] = [];
  for (const [childId, parentId] of Object.entries(parentByNodeId)) {
    if (!childrenByNodeId[parentId]) childrenByNodeId[parentId] = [];
    childrenByNodeId[parentId].push(childId);
  }
  for (const children of Object.values(childrenByNodeId)) children.sort();

  const rootIds = nodes
    .map((node) => String(node.id))
    .filter((nodeId) => !parentByNodeId[nodeId])
    .sort();

  const depthByNodeId = {};
  const queue = rootIds.map((id) => ({ id, depth: 0 }));
  const visited = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (!current || visited.has(current.id)) continue;
    visited.add(current.id);
    depthByNodeId[current.id] = current.depth;
    for (const childId of childrenByNodeId[current.id] || []) {
      queue.push({ id: childId, depth: current.depth + 1 });
    }
  }

  return {
    rootIds,
    parentByNodeId,
    childrenByNodeId,
    depthByNodeId,
    backboneEdgeIds
  };
}

function translatedTargets(nodes, elkChildren, layoutState) {
  const byId = new Map((elkChildren || []).map((child) => [String(child.id), {
    x: stableNumber(child.x),
    y: stableNumber(child.y)
  }]));
  const previousPositions = layoutState?.lastAppliedPositions || {};
  const dx = [];
  const dy = [];

  for (const node of nodes) {
    const id = String(node.id);
    const target = byId.get(id);
    const previous = previousPositions[id];
    if (!target || !previous) continue;
    const current = positionOf(node);
    dx.push(current.x - target.x);
    dy.push(current.y - target.y);
  }

  // Keep the whole drawing anchored near where the user already knows it.
  const offsetX = dx.length ? average(dx) : 0;
  const offsetY = dy.length ? average(dy) : 0;
  const translated = new Map();
  for (const [id, target] of byId.entries()) {
    translated.set(id, { x: target.x + offsetX, y: target.y + offsetY });
  }
  return translated;
}

/**
 * Run ELK on the primary deepens backbone only. Cross-links are intentionally
 * excluded from ranking; React Flow still renders every canonical edge.
 */
export async function layoutResearchGraph(nodes = [], edges = [], previousLayoutState = {}) {
  if (!nodes.length) {
    return {
      nodes,
      layoutState: {
        structuralSignature: researchStructuralSignature(nodes, edges),
        backboneParentByNodeId: {},
        preferredPositions: {},
        lastAppliedPositions: {}
      }
    };
  }

  const backbone = deriveSemanticBackbone(
    nodes,
    edges,
    previousLayoutState?.backboneParentByNodeId || {}
  );

  const primaryEdges = [];
  for (const [childId, parentId] of Object.entries(backbone.parentByNodeId)) {
    primaryEdges.push({
      id: `backbone:${parentId}>${childId}`,
      sources: [parentId],
      targets: [childId]
    });
  }

  const graph = {
    id: 'research-blackboard-layout',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': '48',
      'elk.layered.spacing.nodeNodeBetweenLayers': '72',
      'elk.layered.spacing.edgeNodeBetweenLayers': '28',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.crossingMinimization.semiInteractive': 'true',
      'elk.padding': '[top=24,left=24,bottom=24,right=24]'
    },
    children: nodes.map((node) => ({
      id: String(node.id),
      width: RESEARCH_NODE_WIDTH,
      height: RESEARCH_NODE_HEIGHT
    })),
    edges: primaryEdges
  };

  const laidOut = await elk.layout(graph);
  const targets = translatedTargets(nodes, laidOut.children || [], previousLayoutState);
  const preferredPositions = { ...(previousLayoutState?.preferredPositions || {}) };
  const lastAppliedPositions = {};
  const previousApplied = previousLayoutState?.lastAppliedPositions || {};

  const nextNodes = nodes.map((node) => {
    const id = String(node.id);
    const current = positionOf(node);
    const target = targets.get(id) || current;
    const preferred = preferredPositions[id] || null;
    const existedBefore = !!previousApplied[id];

    let next;
    if (preferred) {
      // A drag means “keep it around here”, not “freeze this coordinate”.
      next = {
        x: blend(preferred.x, target.x, 0.78),
        y: blend(preferred.y, target.y, 0.58)
      };
    } else if (existedBefore) {
      // Preserve the mental map horizontally; let hierarchy settle vertically.
      next = {
        x: blend(current.x, target.x, 0.58),
        y: blend(current.y, target.y, 0.34)
      };
    } else {
      next = target;
    }

    const rounded = {
      x: Math.round(next.x * 10) / 10,
      y: Math.round(next.y * 10) / 10
    };
    lastAppliedPositions[id] = rounded;
    return { ...node, position: rounded };
  });

  // Remove preferences for nodes that no longer exist.
  const liveIds = new Set(nodes.map((node) => String(node.id)));
  for (const id of Object.keys(preferredPositions)) {
    if (!liveIds.has(id)) delete preferredPositions[id];
  }

  return {
    nodes: nextNodes,
    layoutState: {
      structuralSignature: researchStructuralSignature(nodes, edges),
      backboneParentByNodeId: backbone.parentByNodeId,
      preferredPositions,
      lastAppliedPositions,
      lastBackboneDepthByNodeId: backbone.depthByNodeId,
      algorithm: 'elk-layered-down-v1'
    }
  };
}

/**
 * Detect position changes that happened without structural change. Those are
 * interpreted as user drag preferences. A small epsilon filters React Flow
 * rounding noise.
 */
export function capturePreferredPositions(nodes = [], layoutState = {}, epsilon = 6) {
  const previous = layoutState?.lastAppliedPositions || {};
  const preferredPositions = { ...(layoutState?.preferredPositions || {}) };
  const lastAppliedPositions = { ...previous };
  let changed = false;

  for (const node of nodes) {
    const id = String(node.id);
    const before = previous[id];
    if (!before) continue;
    const current = positionOf(node);
    if (distance(current, before) <= epsilon) continue;
    preferredPositions[id] = current;
    lastAppliedPositions[id] = current;
    changed = true;
  }

  return {
    changed,
    layoutState: {
      ...layoutState,
      preferredPositions,
      lastAppliedPositions
    }
  };
}

export function layoutStateForImportedGraph(nodes = [], edges = [], previous = {}) {
  const backbone = deriveSemanticBackbone(nodes, edges, previous?.backboneParentByNodeId || {});
  const positions = {};
  for (const node of nodes) positions[String(node.id)] = positionOf(node);
  return {
    structuralSignature: researchStructuralSignature(nodes, edges),
    backboneParentByNodeId: backbone.parentByNodeId,
    preferredPositions: { ...(previous?.preferredPositions || {}) },
    lastAppliedPositions: positions,
    lastBackboneDepthByNodeId: backbone.depthByNodeId,
    algorithm: 'imported-layout'
  };
}
