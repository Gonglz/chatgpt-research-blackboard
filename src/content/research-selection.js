const AUTO_PREFIX = 'researchAutoGraphEnabled:';
const HEARTBEAT_PREFIX = 'researchSidecarHeartbeat:';
const GRAPH_PREFIX = 'researchBlackboard:';
const HEARTBEAT_TTL_MS = 4500;
const TOOLBAR_ID = 'research-blackboard-selection-toolbar';

let toolbar = null;
let currentSelection = null;
let showTimer = null;

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

function getConversationId() {
  const match = window.location.pathname.match(/\/c\/([a-zA-Z0-9-]+)/);
  return match?.[1] || null;
}

function graphKey(conversationId) {
  return `${GRAPH_PREFIX}${conversationId}`;
}

function heartbeatFresh(value) {
  const ts = Number(value || 0);
  return Number.isFinite(ts) && ts > 0 && Date.now() - ts <= HEARTBEAT_TTL_MS;
}

async function sidecarIsLive(conversationId) {
  if (!conversationId) return false;
  const autoKey = `${AUTO_PREFIX}${conversationId}`;
  const heartbeatKey = `${HEARTBEAT_PREFIX}${conversationId}`;
  try {
    const result = await chrome.storage.local.get([autoKey, heartbeatKey]);
    return result?.[autoKey] === true && heartbeatFresh(result?.[heartbeatKey]);
  } catch {
    return false;
  }
}

function findMessageContainer(node) {
  const element = node instanceof Element ? node : node?.parentElement;
  if (!element) return null;
  return element.closest?.('section[data-turn-id]')
    || element.closest?.('article')
    || element.closest?.('[data-message-author-role]')
    || null;
}

function messageRole(container) {
  if (!container) return '';
  const roleNode = container.matches?.('[data-message-author-role]')
    ? container
    : container.querySelector?.('[data-message-author-role]');
  return cleanText(roleNode?.getAttribute?.('data-message-author-role')).toLowerCase();
}

function messageId(container) {
  if (!container) return null;
  return cleanText(
    container.getAttribute?.('data-turn-id')
      || container.getAttribute?.('data-message-id')
      || container.querySelector?.('[data-message-id]')?.getAttribute?.('data-message-id')
  ) || null;
}

function rangeContext(range, container) {
  let startOffset = -1;
  let endOffset = -1;
  let prefix = '';
  let suffix = '';

  try {
    const before = document.createRange();
    before.selectNodeContents(container);
    before.setEnd(range.startContainer, range.startOffset);
    const beforeText = before.toString();
    startOffset = beforeText.length;
    prefix = cleanText(beforeText.slice(-140));

    const after = document.createRange();
    after.selectNodeContents(container);
    after.setStart(range.endContainer, range.endOffset);
    const afterText = after.toString();
    suffix = cleanText(afterText.slice(0, 140));

    endOffset = startOffset + range.toString().length;
  } catch {
    // Exact offsets are a convenience for precise jump-back, not a hard requirement.
  }

  return { startOffset, endOffset, prefix, suffix };
}

function captureSelection() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const range = selection.getRangeAt(0);
  const quote = cleanText(selection.toString());
  if (quote.length < 2 || quote.length > 1600) return null;

  const container = findMessageContainer(range.commonAncestorContainer);
  if (!container) return null;

  const role = messageRole(container);
  // This interaction is intentionally about extracting useful material from answers.
  if (role && role !== 'assistant') return null;

  const rect = range.getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)) return null;

  const context = rangeContext(range, container);
  const fullText = cleanText(container.innerText || container.textContent || '');

  return {
    id: makeId('selection'),
    conversationId: getConversationId(),
    quote,
    messageId: messageId(container),
    messageRole: role || 'assistant',
    messagePreview: fullText.slice(0, 220),
    messageTail: fullText.slice(-180),
    messageTextLength: fullText.length,
    startOffset: context.startOffset,
    endOffset: context.endOffset,
    prefix: context.prefix,
    suffix: context.suffix,
    rect: {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height
    }
  };
}

function semanticIdOf(node) {
  if (node?.data?.semanticId) return cleanText(node.data.semanticId);
  if (String(node?.id || '').startsWith('rg_')) return String(node.id).slice(3);
  return null;
}

function resolveTargetNode(graph, selectionPayload) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  if (!nodes.length) return null;

  // Prefer the semantic node actually anchored to the answer the user selected.
  const exact = nodes.find((node) => (
    node?.data?.messageId === selectionPayload.messageId
    || (Array.isArray(node?.data?.sourceMessageIds) && node.data.sourceMessageIds.includes(selectionPayload.messageId))
  ));
  if (exact) return exact;

  const focusId = graph?.metadata?.focusNodeId;
  if (focusId) {
    const focused = nodes.find((node) => node.id === focusId);
    if (focused) return focused;
  }

  return null;
}

function makeHighlight(payload) {
  return {
    id: makeId('highlight'),
    quote: payload.quote,
    messageId: payload.messageId || null,
    messageRole: payload.messageRole || 'assistant',
    messagePreview: payload.messagePreview || '',
    messageTail: payload.messageTail || '',
    messageTextLength: payload.messageTextLength || 0,
    startOffset: Number.isInteger(payload.startOffset) ? payload.startOffset : -1,
    endOffset: Number.isInteger(payload.endOffset) ? payload.endOffset : -1,
    prefix: payload.prefix || '',
    suffix: payload.suffix || '',
    createdAt: Date.now()
  };
}

function inferSelectionTitle(quote) {
  let text = cleanText(quote)
    .replace(/^[“”"'‘’「」『』【】\s]+|[“”"'‘’「」『』【】\s]+$/g, '')
    .replace(/^(所以|因此|但是|不过|其实|也就是说|换句话说)[，,:：\s]*/, '');

  const firstClause = text.split(/[。！？?!；;\n]/).map(cleanText).find(Boolean) || text;
  text = firstClause || 'Selection node';
  return text.length > 34 ? `${text.slice(0, 34)}…` : text;
}

function nodePosition(graph, parentNode) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  if (parentNode?.position) {
    const childCount = (graph?.edges || []).filter((edge) => edge.source === parentNode.id).length;
    const side = childCount % 2 === 0 ? 1 : -1;
    const ring = Math.floor(childCount / 2) + 1;
    return {
      x: parentNode.position.x + side * (225 + Math.min(ring - 1, 2) * 45),
      y: parentNode.position.y + 150 + Math.min(ring - 1, 3) * 35
    };
  }

  const index = nodes.length;
  return {
    x: 40 + (index % 3) * 230,
    y: 50 + Math.floor(index / 3) * 155
  };
}

async function saveHighlightToGraph(payload) {
  const conversationId = payload?.conversationId;
  if (!conversationId) return { ok: false, message: 'No conversation' };

  const key = graphKey(conversationId);
  const result = await chrome.storage.local.get([key]);
  const graph = result?.[key];
  if (!graph || !Array.isArray(graph.nodes)) {
    return { ok: false, message: 'No research node yet — use + Node' };
  }

  const target = resolveTargetNode(graph, payload);
  if (!target) {
    return { ok: false, message: 'No matching node — use + Node' };
  }

  const highlight = makeHighlight(payload);
  const nodes = graph.nodes.map((node) => {
    if (node.id !== target.id) return node;
    const existing = Array.isArray(node?.data?.highlights) ? node.data.highlights : [];
    const duplicate = existing.some((item) => (
      item?.messageId === highlight.messageId && cleanText(item?.quote) === cleanText(highlight.quote)
    ));
    if (duplicate) return node;
    return {
      ...node,
      data: {
        ...node.data,
        highlights: existing.concat(highlight)
      }
    };
  });

  await chrome.storage.local.set({
    [key]: {
      ...graph,
      nodes,
      metadata: {
        ...(graph.metadata || {}),
        lastSelectionAt: Date.now()
      },
      updatedAt: Date.now()
    }
  });

  return { ok: true, message: `Saved to ${target.data?.title || 'node'}` };
}

async function createNodeFromSelection(payload, nodeType = 'analysis') {
  const conversationId = payload?.conversationId;
  if (!conversationId) return { ok: false, message: 'No conversation' };

  const key = graphKey(conversationId);
  const result = await chrome.storage.local.get([key]);
  const graph = result?.[key] || {
    schemaVersion: 2,
    conversationId,
    nodes: [],
    edges: [],
    metadata: {}
  };

  const parent = resolveTargetNode(graph, payload);
  const highlight = makeHighlight(payload);
  const id = makeId('research');
  const node = {
    id,
    type: 'researchNode',
    position: nodePosition(graph, parent),
    data: {
      type: ['analysis', 'comparison', 'question'].includes(nodeType) ? nodeType : 'analysis',
      title: inferSelectionTitle(payload.quote),
      titleSource: 'selection',
      titleEdited: false,
      keywords: [],
      checkpoint: '',
      messageId: payload.messageId || null,
      messageRole: payload.messageRole || 'assistant',
      messagePreview: payload.messagePreview || payload.quote.slice(0, 180),
      messageTail: payload.messageTail || '',
      messageTextLength: payload.messageTextLength || 0,
      messageIndex: -1,
      messageRoleIndex: -1,
      highlights: [highlight],
      createdFromSelection: true
    }
  };

  const nodes = [...(graph.nodes || []), node];
  const edges = [...(graph.edges || [])];

  if (parent && parent.id !== id) {
    edges.push({
      id: makeId('edge'),
      source: parent.id,
      target: id,
      type: 'smoothstep',
      label: 'deepens',
      data: { relation: 'deepens', createdFromSelection: true }
    });
  }

  await chrome.storage.local.set({
    [key]: {
      ...graph,
      schemaVersion: graph.schemaVersion || 2,
      conversationId,
      nodes,
      edges,
      metadata: {
        ...(graph.metadata || {}),
        focusNodeId: id,
        lastSelectionAt: Date.now()
      },
      updatedAt: Date.now()
    }
  });

  return { ok: true, message: 'Created research node' };
}

function removeToolbar() {
  currentSelection = null;
  if (toolbar?.isConnected) toolbar.remove();
  toolbar = null;
}

function buttonStyle(primary = false) {
  return [
    'border:0',
    'border-radius:7px',
    'padding:6px 9px',
    'font:600 12px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    'cursor:pointer',
    `background:${primary ? '#2563eb' : '#ffffff'}`,
    `color:${primary ? '#ffffff' : '#334155'}`,
    primary ? '' : 'box-shadow:inset 0 0 0 1px #dbe3ee'
  ].filter(Boolean).join(';');
}

function setToolbarStatus(message, ok = true) {
  if (!toolbar) return;
  const status = toolbar.querySelector('[data-rb-selection-status]');
  if (!status) return;
  status.textContent = message;
  status.style.color = ok ? '#166534' : '#b45309';
  window.setTimeout(() => removeToolbar(), ok ? 650 : 1500);
}

function closeTypeMenu() {
  toolbar?.querySelector('[data-rb-type-menu]')?.remove();
}

function openTypeMenu(nodeButton) {
  if (!toolbar || !currentSelection) return;
  closeTypeMenu();

  const menu = document.createElement('div');
  menu.dataset.rbTypeMenu = '1';
  menu.style.cssText = [
    'position:absolute',
    'top:calc(100% + 5px)',
    'right:0',
    'display:flex',
    'flex-direction:column',
    'gap:3px',
    'padding:5px',
    'min-width:112px',
    'border:1px solid #dbe3ee',
    'border-radius:9px',
    'background:#fff',
    'box-shadow:0 10px 28px rgba(15,23,42,.16)',
    'z-index:2147483647'
  ].join(';');

  const options = [
    ['analysis', 'Analysis'],
    ['comparison', 'Comparison'],
    ['question', 'Question']
  ];

  for (const [value, label] of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.style.cssText = 'border:0;background:#fff;text-align:left;padding:7px 8px;border-radius:6px;font:12px system-ui;cursor:pointer;color:#334155';
    button.addEventListener('mouseenter', () => { button.style.background = '#f1f5f9'; });
    button.addEventListener('mouseleave', () => { button.style.background = '#fff'; });
    button.addEventListener('pointerdown', (event) => event.preventDefault());
    button.addEventListener('click', async () => {
      const payload = currentSelection;
      if (!payload) return;
      const result = await createNodeFromSelection(payload, value).catch((error) => ({ ok: false, message: error?.message || 'Failed' }));
      setToolbarStatus(result.message, result.ok);
    });
    menu.appendChild(button);
  }

  toolbar.appendChild(menu);
  nodeButton.setAttribute('aria-expanded', 'true');
}

async function showToolbarForSelection() {
  const payload = captureSelection();
  if (!payload?.conversationId) {
    removeToolbar();
    return;
  }

  if (!(await sidecarIsLive(payload.conversationId))) {
    removeToolbar();
    return;
  }

  currentSelection = payload;
  removeToolbar();
  currentSelection = payload;

  const root = document.createElement('div');
  root.id = TOOLBAR_ID;
  root.style.cssText = [
    'position:fixed',
    'display:flex',
    'align-items:center',
    'gap:5px',
    'padding:5px',
    'border:1px solid #dbe3ee',
    'border-radius:10px',
    'background:rgba(255,255,255,.98)',
    'box-shadow:0 8px 26px rgba(15,23,42,.18)',
    'z-index:2147483647',
    'user-select:none'
  ].join(';');

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.textContent = '★ Save';
  saveButton.style.cssText = buttonStyle(false);
  saveButton.addEventListener('pointerdown', (event) => event.preventDefault());
  saveButton.addEventListener('click', async () => {
    const selectionPayload = currentSelection;
    if (!selectionPayload) return;
    const result = await saveHighlightToGraph(selectionPayload).catch((error) => ({ ok: false, message: error?.message || 'Failed' }));
    setToolbarStatus(result.message, result.ok);
  });

  const nodeButton = document.createElement('button');
  nodeButton.type = 'button';
  nodeButton.textContent = '+ Node';
  nodeButton.style.cssText = buttonStyle(true);
  nodeButton.setAttribute('aria-haspopup', 'menu');
  nodeButton.setAttribute('aria-expanded', 'false');
  nodeButton.addEventListener('pointerdown', (event) => event.preventDefault());
  nodeButton.addEventListener('click', () => openTypeMenu(nodeButton));

  const status = document.createElement('span');
  status.dataset.rbSelectionStatus = '1';
  status.style.cssText = 'display:none;max-width:180px;font:11px/1.2 system-ui;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';

  root.append(saveButton, nodeButton, status);
  document.documentElement.appendChild(root);
  toolbar = root;

  const width = root.offsetWidth || 150;
  const height = root.offsetHeight || 38;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, payload.rect.left + payload.rect.width / 2 - width / 2));
  let top = payload.rect.bottom + 8;
  if (top + height + 120 > window.innerHeight) top = Math.max(8, payload.rect.top - height - 8);
  root.style.left = `${Math.round(left)}px`;
  root.style.top = `${Math.round(top)}px`;
}

function scheduleToolbar() {
  if (showTimer) window.clearTimeout(showTimer);
  showTimer = window.setTimeout(() => {
    void showToolbarForSelection();
  }, 40);
}

function setupSelectionCapture() {
  document.addEventListener('mouseup', (event) => {
    if (toolbar?.contains(event.target)) return;
    scheduleToolbar();
  }, true);

  document.addEventListener('keyup', (event) => {
    if (event.key === 'Shift' || event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
      scheduleToolbar();
    }
  }, true);

  document.addEventListener('pointerdown', (event) => {
    if (toolbar?.contains(event.target)) return;
    removeToolbar();
  }, true);

  window.addEventListener('scroll', () => removeToolbar(), true);
  window.addEventListener('resize', () => removeToolbar(), true);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (Object.keys(changes).some((key) => key.startsWith(HEARTBEAT_PREFIX))) {
      const conversationId = getConversationId();
      if (!conversationId) return removeToolbar();
      void sidecarIsLive(conversationId).then((live) => {
        if (!live) removeToolbar();
      });
    }
  });
}

setupSelectionCapture();
console.debug('[ResearchSelection] Initialized');
