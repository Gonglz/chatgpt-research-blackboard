import { loadScopedGraphRecord, writeScopedGraphRecord } from '../shared/researchScope';

const HEARTBEAT_PREFIX = 'researchSidecarHeartbeat:';
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
  return window.location.pathname.match(/\/c\/([a-zA-Z0-9-]+)/)?.[1] || null;
}

function heartbeatFresh(value) {
  const ts = Number(value || 0);
  return Number.isFinite(ts) && ts > 0 && Date.now() - ts <= HEARTBEAT_TTL_MS;
}

async function sidecarIsLive(conversationId) {
  if (!conversationId) return false;
  const heartbeatKey = `${HEARTBEAT_PREFIX}${conversationId}`;
  try {
    const result = await chrome.storage.local.get([heartbeatKey]);
    return heartbeatFresh(result?.[heartbeatKey]);
  } catch {
    return false;
  }
}

function findMessageContainer(node) {
  const element = node instanceof Element ? node : node?.parentElement;
  if (!element) return null;
  return element.closest?.('[data-message-author-role="assistant"]')
    || element.closest?.('section[data-turn-id]')
    || element.closest?.('[data-testid^="conversation-turn-"]')
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
  const turn = container.closest?.('section[data-turn-id]') || container.closest?.('[data-testid^="conversation-turn-"]') || container;
  return cleanText(
    turn.getAttribute?.('data-turn-id')
      || turn.getAttribute?.('data-message-id')
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
    // best effort only
  }
  return { startOffset, endOffset, prefix, suffix };
}

function localSelectionContext(range, container) {
  const anchor = range.startContainer instanceof Element ? range.startContainer : range.startContainer?.parentElement;
  if (!anchor) return { heading: '', paragraph: '' };
  const paragraphNode = anchor.closest?.('p, li, blockquote, td, th, h1, h2, h3, h4, h5, h6');
  const paragraph = cleanText(paragraphNode?.innerText || paragraphNode?.textContent || '');
  let heading = '';
  try {
    for (const candidate of Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6'))) {
      if (candidate === anchor || candidate.contains(anchor)) {
        heading = cleanText(candidate.innerText || candidate.textContent || '');
        break;
      }
      if (candidate.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING) {
        heading = cleanText(candidate.innerText || candidate.textContent || '');
      }
    }
  } catch {
    // best effort only
  }
  return { heading: heading.slice(0, 160), paragraph: paragraph.slice(0, 520) };
}

function captureSelectionNow() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0).cloneRange();
  const quote = cleanText(selection.toString());
  if (quote.length < 2 || quote.length > 1600) return null;

  const container = findMessageContainer(range.commonAncestorContainer);
  if (!container) return null;
  const role = messageRole(container);
  if (role && role !== 'assistant') return null;

  const rect = range.getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)) return null;

  const context = rangeContext(range, container);
  const local = localSelectionContext(range, container);
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
    localHeading: local.heading,
    localParagraph: local.paragraph,
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

function cjkBigrams(value) {
  const text = cleanText(value).replace(/[\s，。！？；、：:（）()《》“”"'`~!@#$%^&*+=\[\]{}<>/\\|_-]+/g, '');
  const grams = new Set();
  for (let i = 0; i < text.length - 1; i++) grams.add(text.slice(i, i + 2));
  return grams;
}

function overlapScore(a, b) {
  if (!a || !b) return 0;
  const left = cjkBigrams(a);
  const right = cjkBigrams(b);
  if (!left.size || !right.size) return 0;
  let hits = 0;
  for (const gram of left) if (right.has(gram)) hits += 1;
  return hits / Math.max(1, Math.min(left.size, right.size));
}

function nodeSemanticText(node) {
  return cleanText([
    node?.data?.title,
    ...(Array.isArray(node?.data?.keywords) ? node.data.keywords : []),
    node?.data?.checkpoint
  ].filter(Boolean).join(' '));
}

function scoreNode(node, payload, focusId) {
  const semantic = nodeSemanticText(node);
  const local = cleanText([
    payload.quote,
    payload.localHeading,
    payload.localParagraph,
    payload.prefix,
    payload.suffix
  ].filter(Boolean).join(' '));
  let score = overlapScore(semantic, local) * 30;
  for (const keyword of Array.isArray(node?.data?.keywords) ? node.data.keywords : []) {
    if (keyword && payload.quote?.includes(keyword)) score += 8;
    else if (keyword && payload.localHeading?.includes(keyword)) score += 6;
    else if (keyword && payload.localParagraph?.includes(keyword)) score += 4;
  }
  const title = cleanText(node?.data?.title);
  if (title && payload.localHeading && (title.includes(payload.localHeading) || payload.localHeading.includes(title))) score += 10;
  if (focusId && node.id === focusId) score += 1.5;
  return score;
}

function resolveTargetNode(graph, payload) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  if (!nodes.length) return null;
  const sameMessage = nodes.filter((node) => (
    node?.data?.messageId === payload.messageId
    || (Array.isArray(node?.data?.sourceMessageIds) && node.data.sourceMessageIds.includes(payload.messageId))
    || (Array.isArray(node?.data?.sources) && node.data.sources.some((source) => source?.conversationId === payload.conversationId && source?.messageId === payload.messageId))
  ));
  if (sameMessage.length === 1) return sameMessage[0];
  if (sameMessage.length > 1) {
    const focusId = graph?.metadata?.focusNodeId || null;
    return sameMessage.map((node) => ({ node, score: scoreNode(node, payload, focusId) })).sort((a, b) => b.score - a.score)[0]?.node || null;
  }
  const focusId = graph?.metadata?.focusNodeId;
  return focusId ? nodes.find((node) => node.id === focusId) || null : null;
}

function makeHighlight(payload) {
  return {
    id: makeId('highlight'),
    conversationId: payload.conversationId || null,
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
    localHeading: payload.localHeading || '',
    localParagraph: payload.localParagraph || '',
    createdAt: Date.now()
  };
}

function appendNodeSource(list, payload) {
  const source = {
    conversationId: payload.conversationId || null,
    messageId: payload.messageId || null,
    role: payload.messageRole || 'assistant',
    preview: payload.messagePreview || '',
    addedAt: Date.now()
  };
  const items = Array.isArray(list) ? [...list] : [];
  if (!items.some((item) => item?.conversationId === source.conversationId && item?.messageId === source.messageId)) items.push(source);
  return items.slice(-40);
}

function inferSelectionTitle(quote) {
  let text = cleanText(quote)
    .replace(/^[“”"'‘’「」『』【】\s]+|[“”"'‘’「」『』【】\s]+$/g, '')
    .replace(/^(所以|因此|但是|不过|其实|也就是说|换句话说)[，,:：\s]*/, '');
  text = text.split(/[。！？?!；;\n]/).map(cleanText).find(Boolean) || text || 'Selection node';
  return text.length > 34 ? `${text.slice(0, 34)}…` : text;
}

function nodePosition(graph, parent) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  if (parent?.position) {
    const childCount = (graph?.edges || []).filter((edge) => (
      String(edge?.data?.relation || edge?.label || '').toLowerCase() === 'deepens' && edge.target === parent.id
    )).length;
    const side = childCount % 2 === 0 ? 1 : -1;
    return { x: parent.position.x + side * 230, y: parent.position.y + 160 };
  }
  const index = nodes.length;
  return { x: 40 + (index % 3) * 230, y: 50 + Math.floor(index / 3) * 155 };
}

async function saveHighlight(payload) {
  const conversationId = payload?.conversationId;
  if (!conversationId) return { ok: false, message: 'No conversation' };
  const { graph } = await loadScopedGraphRecord(conversationId);
  if (!graph || !Array.isArray(graph.nodes)) return { ok: false, message: 'No research node yet — use + Node' };
  const target = resolveTargetNode(graph, payload);
  if (!target) return { ok: false, message: 'No matching node — use + Node' };

  const highlight = makeHighlight(payload);
  let inserted = false;
  const nodes = graph.nodes.map((node) => {
    if (node.id !== target.id) return node;
    const existing = Array.isArray(node?.data?.highlights) ? node.data.highlights : [];
    const duplicate = existing.some((item) => (
      item?.conversationId === highlight.conversationId
      && item?.messageId === highlight.messageId
      && cleanText(item?.quote) === cleanText(highlight.quote)
    ));
    if (duplicate) return node;
    inserted = true;
    return {
      ...node,
      data: {
        ...node.data,
        sources: appendNodeSource(node.data?.sources, payload),
        highlights: existing.concat(highlight)
      }
    };
  });

  const now = Date.now();
  await writeScopedGraphRecord(conversationId, {
    ...graph,
    nodes,
    metadata: { ...(graph.metadata || {}), selectedNodeId: target.id, lastSelectionAt: now },
    updatedAt: now
  });
  return { ok: true, message: inserted ? `Saved to ${target.data?.title || 'node'}` : `Already saved in ${target.data?.title || 'node'}` };
}

async function createNode(payload, nodeType = 'analysis') {
  const conversationId = payload?.conversationId;
  if (!conversationId) return { ok: false, message: 'No conversation' };
  const loaded = await loadScopedGraphRecord(conversationId);
  const graph = loaded.graph || { schemaVersion: 2, conversationId, nodes: [], edges: [], metadata: {} };
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
      sources: appendNodeSource([], payload),
      highlights: [highlight],
      createdFromSelection: true
    }
  };

  const edges = [...(graph.edges || [])];
  if (parent && parent.id !== id) {
    edges.push({
      id: makeId('edge'),
      source: id,
      target: parent.id,
      type: 'researchSemanticEdge',
      label: 'deepens',
      data: {
        relation: 'deepens',
        createdFromSelection: true,
        canonicalDirection: 'child-to-parent',
        sources: [{ conversationId, messageId: payload.messageId || null, addedAt: Date.now() }]
      }
    });
  }

  const now = Date.now();
  await writeScopedGraphRecord(conversationId, {
    ...graph,
    schemaVersion: graph.schemaVersion || 2,
    nodes: [...(graph.nodes || []), node],
    edges,
    metadata: { ...(graph.metadata || {}), focusNodeId: id, selectedNodeId: id, lastSelectionAt: now },
    updatedAt: now
  });
  return { ok: true, message: 'Created research node' };
}

function clearToolbarElement() {
  if (toolbar?.isConnected) toolbar.remove();
  toolbar = null;
}

function removeToolbar() {
  currentSelection = null;
  clearToolbarElement();
}

function buttonStyle(primary = false) {
  return [
    'border:0', 'border-radius:7px', 'padding:6px 9px',
    'font:600 12px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    'cursor:pointer', `background:${primary ? '#2563eb' : '#ffffff'}`, `color:${primary ? '#ffffff' : '#334155'}`,
    primary ? '' : 'box-shadow:inset 0 0 0 1px #dbe3ee'
  ].filter(Boolean).join(';');
}

function setToolbarStatus(message, ok = true) {
  if (!toolbar) return;
  const status = toolbar.querySelector('[data-rb-selection-status]');
  if (!status) return;
  status.style.display = 'inline-block';
  status.textContent = message;
  status.style.color = ok ? '#166534' : '#b45309';
  window.setTimeout(() => removeToolbar(), ok ? 900 : 1800);
}

function closeTypeMenu() {
  toolbar?.querySelector('[data-rb-type-menu]')?.remove();
}

function openTypeMenu(nodeButton) {
  if (!toolbar || !currentSelection) return;
  closeTypeMenu();
  const menu = document.createElement('div');
  menu.dataset.rbTypeMenu = '1';
  menu.style.cssText = 'position:absolute;top:calc(100% + 5px);right:0;display:flex;flex-direction:column;gap:3px;padding:5px;min-width:112px;border:1px solid #dbe3ee;border-radius:9px;background:#fff;box-shadow:0 10px 28px rgba(15,23,42,.16);z-index:2147483647';
  for (const [value, label] of [['analysis', 'Analysis'], ['comparison', 'Comparison'], ['question', 'Question']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.style.cssText = 'border:0;background:#fff;text-align:left;padding:7px 8px;border-radius:6px;font:12px system-ui;cursor:pointer;color:#334155';
    button.addEventListener('pointerdown', (event) => event.preventDefault());
    button.addEventListener('click', async () => {
      const payload = currentSelection;
      if (!payload) return;
      const result = await createNode(payload, value).catch((error) => ({ ok: false, message: error?.message || 'Failed' }));
      setToolbarStatus(result.message, result.ok);
    });
    menu.appendChild(button);
  }
  toolbar.appendChild(menu);
  nodeButton.setAttribute('aria-expanded', 'true');
}

async function showToolbar(payload) {
  if (!payload?.conversationId) return removeToolbar();
  if (!(await sidecarIsLive(payload.conversationId))) return removeToolbar();
  if (currentSelection?.id !== payload.id) return;

  clearToolbarElement();
  const root = document.createElement('div');
  root.id = TOOLBAR_ID;
  root.style.cssText = 'position:fixed;display:flex;align-items:center;gap:5px;padding:5px;border:1px solid #dbe3ee;border-radius:10px;background:rgba(255,255,255,.99);box-shadow:0 8px 26px rgba(15,23,42,.18);z-index:2147483647;user-select:none';

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.textContent = '★ Save';
  saveButton.style.cssText = buttonStyle(false);
  saveButton.addEventListener('pointerdown', (event) => event.preventDefault());
  saveButton.addEventListener('click', async () => {
    const selectionPayload = currentSelection;
    if (!selectionPayload) return;
    const result = await saveHighlight(selectionPayload).catch((error) => ({ ok: false, message: error?.message || 'Failed' }));
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
  status.style.cssText = 'display:none;max-width:210px;font:11px/1.2 system-ui;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
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

function scheduleCapturedSelection(payload) {
  if (showTimer) window.clearTimeout(showTimer);
  if (!payload) return removeToolbar();
  currentSelection = payload;
  showTimer = window.setTimeout(() => {
    showTimer = null;
    void showToolbar(payload);
  }, 20);
}

function setupSelectionCapture() {
  document.addEventListener('mouseup', (event) => {
    if (toolbar?.contains(event.target)) return;
    scheduleCapturedSelection(captureSelectionNow());
  }, true);

  document.addEventListener('keyup', (event) => {
    if (event.key === 'Shift' || event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
      scheduleCapturedSelection(captureSelectionNow());
    }
  }, true);

  document.addEventListener('pointerdown', (event) => {
    if (toolbar?.contains(event.target)) return;
    clearToolbarElement();
  }, true);

  window.addEventListener('scroll', () => removeToolbar(), true);
  window.addEventListener('resize', () => removeToolbar(), true);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!Object.keys(changes || {}).some((key) => key.startsWith(HEARTBEAT_PREFIX))) return;
    const conversationId = getConversationId();
    if (!conversationId) return removeToolbar();
    void sidecarIsLive(conversationId).then((live) => { if (!live) removeToolbar(); });
  });
}

setupSelectionCapture();
console.debug('[ResearchSelectionV2] Initialized');
