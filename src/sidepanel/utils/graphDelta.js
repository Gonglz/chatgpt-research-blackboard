const NODE_TYPES = new Set(['analysis', 'comparison', 'synthesis', 'judgment', 'question']);
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
  if (raw === 'synth' || raw === 'synthesize' || raw === 'synthesise') return 'synthesis';
  if (raw === 'judge') return 'judgment';
  return NODE_TYPES.has(raw) ? raw : 'analysis';
}

function normalizeRelation(value) {
  const raw = cleanText(value).toLowerCase();
  return RELATIONS.has(raw) ? raw : 'informs';
}

function normalizeKeywords(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean).slice(0, 6);
  return String(value || '')
    .split(/[|｜,，、;/；]+/)
    .map(cleanText)
    .filter(Boolean)
    .slice(0, 6);
}

function normalizeNodePatch(patch = {}) {
  const next = { ...patch };
  if (next.type) next.type = normalizeNodeType(next.type);
  if (next.keywords !== undefined) next.keywords = normalizeKeywords(next.keywords);
  if (next.checkpoint !== undefined) next.checkpoint = cleanText(next.checkpoint);
  if (next.title !== undefined) next.title = cleanText(next.title);
  if (next.status !== undefined) next.status = cleanText(next.status).toLowerCase();
  return next;
}

export function extractGraphDeltaBlocks(content) {
  const text = String(content || '');
  const blocks = [];

  const commentRe = /<!--\s*RGΔ\s*([\s\S]*?)-->/g;
  let match;
  while ((match = commentRe.exec(text)) !== null) {
    blocks.push(`RGΔ\n${match[1].trim()}`);
  }

  const fenceRe = /```(?:rgdelta|rgΔ|text)?\s*\n?\s*(RGΔ[\s\S]*?)```/gi;
  while ((match = fenceRe.exec(text)) !== null) blocks.push(match[1].trim());

  return [...new Set(blocks)];
}

export function stripGraphDeltaBlocks(content) {
  return String(content || '')
    .replace(/<!--\s*RGΔ\s*[\s\S]*?-->/g, '')
    .replace(/```(?:rgdelta|rgΔ|text)?\s*\n?\s*RGΔ[\s\S]*?```/gi, '')
    .trim();
}

/**
 * Split protocol operations even when ChatGPT serializes the hidden comment as
 * one physical line. Operation markers inside quoted values are intentionally
 * very unlikely; keeping the transport compact is more important here.
 */
function protocolLines(block) {
  const raw = String(block || '').trim();
  if (!raw.startsWith('RGΔ')) return [];
  const body = raw.slice(3).trim();
  if (!body) return ['RGΔ'];

  const normalized = body.replace(
    /\s+(?=(?:\+node\s+|~node\s+|\+edge\s+|-edge\s+|focus\s*:))/g,
    '\n'
  );

  return ['RGΔ', ...normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)];
}

/**
 * RGΔ v0.2 grammar:
 * +node A1 analysis title="Business model" checkpoint="..." keywords="x|y" status="active"
 * ~node A1 title="..." checkpoint="..." keywords="..." status="..."
 * +edge A1 C1 compares
 * -edge A1 C1 [compares]
 * focus: A1
 */
export function parseGraphDelta(block) {
  const lines = protocolLines(block);
  if (!lines.length || lines[0] !== 'RGΔ') {
    return { version: 2, operations: [], errors: ['Missing RGΔ marker'] };
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
      const match = line.match(/^\+node\s+(\S+)\s+(\S+)\s+([\s\S]+)$/);
      if (!match) {
        errors.push(`Line ${i + 1}: invalid +node`);
        continue;
      }

      const semanticId = match[1];
      const nodeType = normalizeNodeType(match[2]);
      const rest = match[3].trim();
      const assignmentMode = /(?:^|\s)(?:title|checkpoint|keywords|status)=/.test(rest);

      if (assignmentMode) {
        const patch = normalizeNodePatch(parseAssignments(rest));
        if (!patch.title) {
          errors.push(`Line ${i + 1}: +node semantic form requires title=`);
          continue;
        }
        operations.push({
          op: 'addNode',
          semanticId,
          nodeType,
          title: patch.title,
          checkpoint: patch.checkpoint || '',
          keywords: patch.keywords || [],
          status: patch.status || null
        });
      } else {
        operations.push({
          op: 'addNode',
          semanticId,
          nodeType,
          title: unquote(rest),
          checkpoint: '',
          keywords: [],
          status: null
        });
      }
      continue;
    }

    if (line.startsWith('~node ')) {
      const match = line.match(/^~node\s+(\S+)\s+([\s\S]+)$/);
      if (!match) {
        errors.push(`Line ${i + 1}: invalid ~node`);
        continue;
      }
      operations.push({
        op: 'updateNode',
        semanticId: match[1],
        patch: normalizeNodePatch(parseAssignments(match[2]))
      });
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

  return { version: 2, operations, errors };
}

function internalNodeId(semanticId) {
  return `rg_${String(semanticId).replace(/[^A-Za-z0-9_.:-]/g, '_')}`;
}

function manualSemanticId(nodeId) {
  const safe = String(nodeId || '').replace(/[^A-Za-z0-9_.:-]/g, '_');
  return `M_${safe.slice(-12) || 'node'}`;
}

function semanticIdOf(node) {
  if (node?.data?.semanticId) return node.data.semanticId;
  if (String(node?.id || '').startsWith('rg_')) return String(node.id).slice(3);
  return manualSemanticId(node?.id);
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

function applySemanticFields(data, operation) {
  if (!data.titleEdited && operation.title) {
    data.title = operation.title;
    data.titleSource = 'ai';
  }
  if (!data.checkpointEdited && operation.checkpoint) {
    data.checkpoint = operation.checkpoint;
    data.checkpointSource = 'ai';
  }
  if (!data.keywordsEdited && Array.isArray(operation.keywords) && operation.keywords.length) {
    data.keywords = operation.keywords;
    data.keywordsSource = 'ai';
  }
  if (operation.status) data.status = operation.status;
}

function applyContextAnchor(data, context) {
  if (!context?.messageId || data.anchorLocked) return;

  const history = Array.isArray(data.sourceMessageIds) ? data.sourceMessageIds.slice() : [];
  if (!history.includes(context.messageId)) history.push(context.messageId);
  data.sourceMessageIds = history.slice(-8);

  // Primary anchor follows the latest assistant turn that materially updated the
  // semantic node. This avoids stale branch anchors on comparison/question nodes.
  data.messageId = context.messageId;
  data.messageRole = context.role || 'assistant';
  data.messagePreview = context.preview || '';
  data.messageTail = context.tail || '';
  data.messageTextLength = context.textLength || 0;
  data.messageIndex = Number.isInteger(context.messageIndex) ? context.messageIndex : -1;
  data.messageRoleIndex = Number.isInteger(context.roleIndex) ? context.roleIndex : -1;
}

export function applyGraphDelta(graph, delta, context = {}) {
  let nodes = Array.isArray(graph?.nodes)
    ? graph.nodes.map((node) => ({ ...node, data: { ...node.data } }))
    : [];
  let edges = Array.isArray(graph?.edges)
    ? graph.edges.map((edge) => ({ ...edge, data: { ...edge.data } }))
    : [];
  let focusNodeId = graph?.focusNodeId || null;
  const changes = [];

  const getActualId = (semanticId) => findNodeBySemanticId(nodes, semanticId)?.id || internalNodeId(semanticId);

  for (const operation of delta?.operations || []) {
    if (operation.op === 'addNode') {
      const existing = findNodeBySemanticId(nodes, operation.semanticId);
      if (existing) {
        existing.data.type = existing.data.typeEdited ? existing.data.type : operation.nodeType;
        existing.data.semanticId = existing.data.semanticId || operation.semanticId;
        existing.data.autoGenerated = true;
        applySemanticFields(existing.data, operation);
        applyContextAnchor(existing.data, context);
        changes.push(`~node ${operation.semanticId}`);
        continue;
      }

      const focusNode = focusNodeId ? nodes.find((node) => node.id === focusNodeId) : null;
      const node = {
        id: internalNodeId(operation.semanticId),
        type: 'researchNode',
        position: makePosition(nodes.length, focusNode),
        data: {
          semanticId: operation.semanticId,
          autoGenerated: true,
          type: operation.nodeType,
          title: operation.title,
          titleSource: 'ai',
          titleEdited: false,
          checkpoint: operation.checkpoint || '',
          checkpointSource: operation.checkpoint ? 'ai' : null,
          checkpointEdited: false,
          keywords: Array.isArray(operation.keywords) ? operation.keywords : [],
          keywordsSource: operation.keywords?.length ? 'ai' : null,
          keywordsEdited: false,
          status: operation.status || null,
          sourceMessageIds: []
        }
      };
      applyContextAnchor(node.data, context);
      nodes.push(node);
      changes.push(`+node ${operation.semanticId}`);
      continue;
    }

    if (operation.op === 'updateNode') {
      const node = findNodeBySemanticId(nodes, operation.semanticId);
      if (!node) continue;
      const patch = normalizeNodePatch(operation.patch || {});
      if (patch.title && !node.data.titleEdited) {
        node.data.title = patch.title;
        node.data.titleSource = 'ai';
      }
      if (patch.checkpoint && !node.data.checkpointEdited) {
        node.data.checkpoint = patch.checkpoint;
        node.data.checkpointSource = 'ai';
      }
      if (patch.keywords?.length && !node.data.keywordsEdited) {
        node.data.keywords = patch.keywords;
        node.data.keywordsSource = 'ai';
      }
      if (patch.type && !node.data.typeEdited) node.data.type = normalizeNodeType(patch.type);
      if (patch.status) node.data.status = patch.status;
      applyContextAnchor(node.data, context);
      changes.push(`~node ${operation.semanticId}`);
      continue;
    }

    if (operation.op === 'addEdge') {
      const source = getActualId(operation.from);
      const target = getActualId(operation.to);
      if (!nodes.some((node) => node.id === source) || !nodes.some((node) => node.id === target)) {
        changes.push(`!edge ${operation.from} ${operation.to}`);
        continue;
      }
      const duplicate = edges.some((edge) => (
        edge.source === source
        && edge.target === target
        && (edge.data?.relation || edge.label) === operation.relation
      ));
      if (duplicate) continue;
      edges.push({
        id: deterministicEdgeId(source, target, operation.relation),
        source,
        target,
        type: 'smoothstep',
        label: operation.relation,
        data: { relation: operation.relation, autoGenerated: true },
        style: { strokeWidth: 1.6 }
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
