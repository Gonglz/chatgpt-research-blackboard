const NODE_TYPES = new Set(['analysis', 'comparison', 'judgment', 'question']);
const RELATIONS = new Set(['deepens', 'compares', 'supports', 'contradicts', 'informs']);

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function unquote(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const first = text[0];
  const last = text[text.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return text.slice(1, -1).replace(/\\([\\"'])/g, '$1');
  }
  return text;
}

function tokenize(line) {
  const tokens = [];
  const re = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+/g;
  let match;
  while ((match = re.exec(line)) !== null) tokens.push(match[0]);
  return tokens;
}

function parseAssignments(text) {
  const result = {};
  const re = /([A-Za-z][A-Za-z0-9_-]*)=("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+)/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    result[match[1]] = unquote(match[2]);
  }
  return result;
}

function normalizeNodeType(value) {
  const raw = cleanText(value).toLowerCase();
  if (raw === 'compare') return 'comparison';
  if (raw === 'judge') return 'judgment';
  return NODE_TYPES.has(raw) ? raw : 'analysis';
}

function normalizeRelation(value) {
  const raw = cleanText(value).toLowerCase();
  return RELATIONS.has(raw) ? raw : 'informs';
}

/**
 * Extract RGΔ payloads from assistant text.
 * Preferred transport is an HTML comment so the protocol is invisible in ChatGPT:
 *   <!--RGΔ\n...\n-->
 * Fenced/plain forms are supported for debugging.
 */
export function extractGraphDeltaBlocks(content) {
  const text = String(content || '');
  const blocks = [];

  const commentRe = /<!--\s*RGΔ\s*([\s\S]*?)-->/g;
  let match;
  while ((match = commentRe.exec(text)) !== null) {
    blocks.push(`RGΔ\n${match[1].trim()}`);
  }

  const fenceRe = /```(?:rgdelta|rgΔ|text)?\s*\n?\s*(RGΔ[\s\S]*?)```/gi;
  while ((match = fenceRe.exec(text)) !== null) {
    blocks.push(match[1].trim());
  }

  if (blocks.length === 0) {
    const marker = text.indexOf('RGΔ');
    if (marker >= 0) {
      const tail = text.slice(marker).trim();
      if (tail.split(/\r?\n/).length >= 2) blocks.push(tail);
    }
  }

  return [...new Set(blocks)];
}

export function stripGraphDeltaBlocks(content) {
  return String(content || '')
    .replace(/<!--\s*RGΔ\s*[\s\S]*?-->/g, '')
    .replace(/```(?:rgdelta|rgΔ|text)?\s*\n?\s*RGΔ[\s\S]*?```/gi, '')
    .trim();
}

/**
 * RGΔ v0.2 grammar:
 *   focus: A1
 *   +node A1 analysis "Business model"
 *   ~node A1 checkpoint="High switching costs" title="Optional new title"
 *   +edge A1 C1 compares
 *   -edge A1 C1 [compares]
 */
export function parseGraphDelta(block) {
  const lines = String(block || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length || !lines[0].startsWith('RGΔ')) {
    return { version: 1, operations: [], errors: ['Missing RGΔ marker'] };
  }

  const operations = [];
  const errors = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith('#')) continue;

    const focusMatch = line.match(/^focus\s*:\s*([A-Za-z0-9_.:-]+)\s*$/i);
    if (focusMatch) {
      operations.push({ op: 'focus', semanticId: focusMatch[1] });
      continue;
    }

    if (line.startsWith('+node ')) {
      const tokens = tokenize(line);
      if (tokens.length < 4) {
        errors.push(`Line ${i + 1}: invalid +node`);
        continue;
      }
      operations.push({
        op: 'addNode',
        semanticId: tokens[1],
        nodeType: normalizeNodeType(tokens[2]),
        title: unquote(tokens.slice(3).join(' '))
      });
      continue;
    }

    if (line.startsWith('~node ')) {
      const tokens = tokenize(line);
      if (tokens.length < 3) {
        errors.push(`Line ${i + 1}: invalid ~node`);
        continue;
      }
      const semanticId = tokens[1];
      const assignmentText = line.slice(line.indexOf(semanticId) + semanticId.length).trim();
      const patch = parseAssignments(assignmentText);
      if (patch.type) patch.type = normalizeNodeType(patch.type);
      operations.push({ op: 'updateNode', semanticId, patch });
      continue;
    }

    if (line.startsWith('+edge ')) {
      const tokens = tokenize(line);
      if (tokens.length < 4) {
        errors.push(`Line ${i + 1}: invalid +edge`);
        continue;
      }
      operations.push({
        op: 'addEdge',
        from: tokens[1],
        to: tokens[2],
        relation: normalizeRelation(tokens[3])
      });
      continue;
    }

    if (line.startsWith('-edge ')) {
      const tokens = tokenize(line);
      if (tokens.length < 3) {
        errors.push(`Line ${i + 1}: invalid -edge`);
        continue;
      }
      operations.push({
        op: 'removeEdge',
        from: tokens[1],
        to: tokens[2],
        relation: tokens[3] ? normalizeRelation(tokens[3]) : null
      });
      continue;
    }

    errors.push(`Line ${i + 1}: unknown operation: ${line}`);
  }

  return { version: 1, operations, errors };
}

function internalNodeId(semanticId) {
  return `rg_${String(semanticId).replace(/[^A-Za-z0-9_.:-]/g, '_')}`;
}

function semanticIdOf(node) {
  return node?.data?.semanticId || (String(node?.id || '').startsWith('rg_') ? String(node.id).slice(3) : null);
}

function findNodeBySemanticId(nodes, semanticId) {
  return nodes.find((node) => semanticIdOf(node) === semanticId) || null;
}

function makePosition(index, focusNode) {
  if (focusNode?.position) {
    const ring = Math.floor(index / 4) + 1;
    const slot = index % 4;
    const offsets = [
      [230 * ring, 0],
      [0, 155 * ring],
      [-230 * ring, 0],
      [0, -155 * ring]
    ];
    return {
      x: focusNode.position.x + offsets[slot][0],
      y: focusNode.position.y + offsets[slot][1]
    };
  }

  return {
    x: 40 + (index % 3) * 230,
    y: 50 + Math.floor(index / 3) * 155
  };
}

function deterministicEdgeId(fromId, toId, relation) {
  return `rg_edge_${fromId}_${toId}_${relation}`.replace(/[^A-Za-z0-9_.:-]/g, '_');
}

/**
 * Pure reducer. Manual user edits win over AI updates when an *Edited flag is set.
 */
export function applyGraphDelta(graph, delta, context = {}) {
  let nodes = Array.isArray(graph?.nodes) ? graph.nodes.map((node) => ({ ...node, data: { ...node.data } })) : [];
  let edges = Array.isArray(graph?.edges) ? graph.edges.map((edge) => ({ ...edge, data: { ...edge.data } })) : [];
  let focusNodeId = graph?.focusNodeId || null;
  const changes = [];

  const getActualId = (semanticId) => findNodeBySemanticId(nodes, semanticId)?.id || internalNodeId(semanticId);

  for (const operation of delta?.operations || []) {
    if (operation.op === 'addNode') {
      const existing = findNodeBySemanticId(nodes, operation.semanticId);
      if (existing) {
        existing.data.type = existing.data.typeEdited ? existing.data.type : operation.nodeType;
        existing.data.title = existing.data.titleEdited ? existing.data.title : operation.title;
        existing.data.autoGenerated = true;
        existing.data.semanticId = operation.semanticId;
        if (!existing.data.messageId && context.messageId) existing.data.messageId = context.messageId;
        changes.push(`~node ${operation.semanticId}`);
        continue;
      }

      const focusNode = focusNodeId ? nodes.find((node) => node.id === focusNodeId) : null;
      const actualId = internalNodeId(operation.semanticId);
      const node = {
        id: actualId,
        type: 'researchNode',
        position: makePosition(nodes.length, focusNode),
        data: {
          semanticId: operation.semanticId,
          autoGenerated: true,
          type: operation.nodeType,
          title: operation.title,
          titleSource: 'ai',
          titleEdited: false,
          checkpoint: '',
          keywords: [],
          messageId: context.messageId || null,
          messageRole: context.role || 'assistant',
          messagePreview: context.preview || '',
          messageTail: context.tail || '',
          messageTextLength: context.textLength || 0,
          messageIndex: Number.isInteger(context.messageIndex) ? context.messageIndex : -1,
          messageRoleIndex: Number.isInteger(context.roleIndex) ? context.roleIndex : -1
        }
      };
      nodes.push(node);
      changes.push(`+node ${operation.semanticId}`);
      continue;
    }

    if (operation.op === 'updateNode') {
      const node = findNodeBySemanticId(nodes, operation.semanticId);
      if (!node) continue;
      const patch = operation.patch || {};
      if (patch.title && !node.data.titleEdited) {
        node.data.title = patch.title;
        node.data.titleSource = 'ai';
      }
      if (patch.checkpoint && !node.data.checkpointEdited) node.data.checkpoint = patch.checkpoint;
      if (patch.type && !node.data.typeEdited) node.data.type = normalizeNodeType(patch.type);
      if (patch.status) node.data.status = patch.status;
      if (context.messageId) {
        node.data.messageId = context.messageId;
        node.data.messageRole = context.role || 'assistant';
        node.data.messagePreview = context.preview || node.data.messagePreview || '';
        node.data.messageTail = context.tail || node.data.messageTail || '';
        node.data.messageTextLength = context.textLength || node.data.messageTextLength || 0;
        node.data.messageIndex = Number.isInteger(context.messageIndex) ? context.messageIndex : node.data.messageIndex;
        node.data.messageRoleIndex = Number.isInteger(context.roleIndex) ? context.roleIndex : node.data.messageRoleIndex;
      }
      changes.push(`~node ${operation.semanticId}`);
      continue;
    }

    if (operation.op === 'addEdge') {
      const source = getActualId(operation.from);
      const target = getActualId(operation.to);
      if (!nodes.some((node) => node.id === source) || !nodes.some((node) => node.id === target)) continue;
      const duplicate = edges.some((edge) => edge.source === source && edge.target === target && (edge.data?.relation || edge.label) === operation.relation);
      if (duplicate) continue;
      edges.push({
        id: deterministicEdgeId(source, target, operation.relation),
        source,
        target,
        type: 'smoothstep',
        label: operation.relation,
        data: { relation: operation.relation, autoGenerated: true }
      });
      changes.push(`+edge ${operation.from} ${operation.to}`);
      continue;
    }

    if (operation.op === 'removeEdge') {
      const source = getActualId(operation.from);
      const target = getActualId(operation.to);
      const before = edges.length;
      edges = edges.filter((edge) => {
        if (edge.source !== source || edge.target !== target) return true;
        if (operation.relation && (edge.data?.relation || edge.label) !== operation.relation) return true;
        if (edge.data?.userLocked) return true;
        return false;
      });
      if (edges.length !== before) changes.push(`-edge ${operation.from} ${operation.to}`);
      continue;
    }

    if (operation.op === 'focus') {
      const node = findNodeBySemanticId(nodes, operation.semanticId);
      if (node) {
        focusNodeId = node.id;
        changes.push(`focus ${operation.semanticId}`);
      }
    }
  }

  return { nodes, edges, focusNodeId, changes };
}
