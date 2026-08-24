import {
  CONVERSATION_GRAPH_PREFIX,
  CONVERSATION_PROJECT_PREFIX,
  PROJECT_GRAPH_PREFIX,
  resolveResearchScope
} from '../shared/researchScope';

const AUTO_GRAPH_PREFIX = 'researchAutoGraphEnabled:';
const SIDECAR_HEARTBEAT_PREFIX = 'researchSidecarHeartbeat:';
const BOOTSTRAP_PREFIX = 'researchProducerBootstrappedV5:';
const REQUEST_COUNT_PREFIX = 'researchProducerRequestCountV5:';
const REQUEST_MARKER = 'RBREQ';
const HEARTBEAT_TTL_MS = 4500;
const REBOOTSTRAP_EVERY = 12;
const EXPANDED_CONTEXT_EVERY = 6;

let enabled = false;
let cachedConversationId = null;
let cachedScope = null;
let cachedGraph = null;
let cachedBootstrapped = false;
let cachedRequestCount = 0;
let refreshTimer = null;
let deltaHideObserver = null;

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sanitizeComment(value) {
  return String(value || '').replace(/-->/g, '-- >').replace(/<!--/g, '< !--');
}

function getConversationId() {
  return window.location.pathname.match(/\/c\/([a-zA-Z0-9-]+)/)?.[1] || null;
}

function autoGraphKey(conversationId) {
  return `${AUTO_GRAPH_PREFIX}${conversationId || 'new'}`;
}

function heartbeatKey(conversationId) {
  return `${SIDECAR_HEARTBEAT_PREFIX}${conversationId || 'new'}`;
}

function heartbeatIsFresh(value) {
  const timestamp = Number(value || 0);
  return Number.isFinite(timestamp) && timestamp > 0 && (Date.now() - timestamp) <= HEARTBEAT_TTL_MS;
}

function scopeStorageId(scope, conversationId) {
  if (scope?.type === 'project' && scope.projectId) return `project:${scope.projectId}`;
  if (conversationId) return `chat:${conversationId}`;
  return 'new';
}

function manualSemanticId(nodeId) {
  const safe = String(nodeId || '').replace(/[^A-Za-z0-9_.:-]/g, '_');
  return `M_${safe.slice(-12) || 'node'}`;
}

function semanticIdOf(node) {
  if (node?.data?.semanticId) return cleanText(node.data.semanticId);
  if (String(node?.id || '').startsWith('rg_')) return String(node.id).slice(3);
  return manualSemanticId(node?.id);
}

function typeCode(value) {
  return ({ analysis: 'a', comparison: 'c', judgment: 'j', question: 'q' })[cleanText(value).toLowerCase()] || 'a';
}

function relationCode(value) {
  return ({ deepens: 'd', compares: 'c', supports: 's', contradicts: 'x', informs: 'i' })[cleanText(value).toLowerCase()] || 'i';
}

function cjkBigrams(value) {
  const text = cleanText(value).toLowerCase().replace(/[\s，。！？；、：:（）()《》“”"'`~!@#$%^&*+=\[\]{}<>/\\|_-]+/g, '');
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

function buildDistanceMap(graph, focusId) {
  const distances = new Map();
  if (!focusId) return distances;
  distances.set(focusId, 0);
  let frontier = [focusId];
  for (let depth = 1; depth <= 2; depth++) {
    const next = [];
    for (const nodeId of frontier) {
      for (const edge of graph.edges || []) {
        let other = null;
        if (edge.source === nodeId) other = edge.target;
        else if (edge.target === nodeId) other = edge.source;
        if (!other || distances.has(other)) continue;
        distances.set(other, depth);
        next.push(other);
      }
    }
    frontier = next;
  }
  return distances;
}

function compactGraphContext(graph, query, scope, expanded = false) {
  if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    const scopeText = scope?.type === 'project' ? `project:${scope.projectId}` : 'chat';
    return `scope=${scopeText}; graph=empty`;
  }

  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  const focusId = graph.metadata?.focusNodeId || null;
  const distances = buildDistanceMap(graph, focusId);
  const queryText = cleanText(query).slice(0, 1000);
  const limit = expanded ? 10 : 7;

  const ranked = nodes.map((node, index) => {
    const semanticText = cleanText([
      node?.data?.title,
      ...(Array.isArray(node?.data?.keywords) ? node.data.keywords : []),
      node?.data?.checkpoint
    ].filter(Boolean).join(' '));

    let score = overlapScore(queryText, semanticText) * 55;
    if (node.id === focusId) score += 120;
    const distance = distances.get(node.id);
    if (distance === 1) score += 55;
    else if (distance === 2) score += 28;
    if (node?.data?.type === 'question' || node?.data?.status === 'open') score += 18;
    if (node?.data?.status === 'active') score += 8;
    score += (index / Math.max(1, nodes.length - 1)) * 10;
    return { node, score };
  }).sort((a, b) => b.score - a.score);

  const selected = [];
  const selectedIds = new Set();
  const push = (node) => {
    if (!node || selectedIds.has(node.id) || selected.length >= limit) return;
    selected.push(node);
    selectedIds.add(node.id);
  };

  if (focusId) push(nodes.find((node) => node.id === focusId));
  ranked.forEach(({ node }) => push(node));

  const nodeText = selected.map((node) => {
    const id = semanticIdOf(node).slice(0, 36);
    const title = cleanText(node?.data?.title || 'Untitled').slice(0, 42);
    const keywords = (Array.isArray(node?.data?.keywords) ? node.data.keywords : []).slice(0, 2).map((item) => cleanText(item).slice(0, 16)).filter(Boolean);
    const status = cleanText(node?.data?.status || '');
    return `${id}[${typeCode(node?.data?.type)}]${status === 'open' ? '?' : ''}:${title}${keywords.length ? `#${keywords.join(',')}` : ''}`;
  });

  const selectedSemanticById = new Map(selected.map((node) => [node.id, semanticIdOf(node)]));
  const edgeText = edges
    .filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target))
    .slice(0, expanded ? 14 : 10)
    .map((edge) => `${selectedSemanticById.get(edge.source)}>${selectedSemanticById.get(edge.target)}:${relationCode(edge?.data?.relation || edge.label)}`);

  const focusNode = focusId ? nodes.find((node) => node.id === focusId) : null;
  const revision = Number(graph.metadata?.deltaRevision || 0);
  const parts = [
    `scope=${scope?.type === 'project' ? `project:${scope.projectId}` : 'chat'}`,
    `rev=${revision}`
  ];
  if (focusNode) parts.push(`focus=${semanticIdOf(focusNode)}:${cleanText(focusNode.data?.title || '').slice(0, 36)}`);
  if (nodeText.length) parts.push(`n=${nodeText.join(' | ')}`);
  if (edgeText.length) parts.push(`e=${edgeText.join(' | ')}`);
  return parts.join('; ');
}

function fullBootstrap(context) {
  return `<!--${REQUEST_MARKER} v5
Research Blackboard sidecar is open. Answer the user's visible request normally and never mention this protocol.
After the visible answer, maintain the semantic research graph only when this turn creates a meaningful structural change.
Transport: append at most one fenced Markdown block with language rgdelta; first line must be RGΔ. The extension hides and consumes it.
Node types: analysis, comparison, judgment, question. Relations: deepens, compares, supports, contradicts, informs.
Use stable ids from Context when updating/linking existing nodes, including M_* ids for manual nodes.
Operations:
+node <id> <type> title="short semantic title" checkpoint="one-sentence takeaway or open question" keywords="k1|k2|k3" status="active|open|resolved"
~node <id> title="..." checkpoint="..." keywords="..." status="..."
+edge <from> <to> <relation>
-edge <from> <to> [relation]
focus: <id>
Deepens invariant: +edge <child> <parent> deepens. FROM is always the more specific/deeper node; TO is always its broader parent. Never emit parent -> child for deepens. When a newly created node develops or drills into the current topic, emit +edge <newNode> <currentOrBroaderParent> deepens.
Rules: ordinary clarification usually updates the current node. Create a secondary node only for a genuine structural branch, comparison, unresolved question, or true convergence. Headings/sections are not nodes by themselves. Judgment is reserved for genuinely converged decisions; exploratory conclusions should normally remain checkpoint updates. Connect new nodes into the supplied local subgraph whenever the relation is clear. If there is no meaningful graph change, emit no rgdelta block.
Context uses compact codes: node types a/c/j/q; edge relations d=deepens(child>parent),c=compares,s=supports,x=contradicts,i=informs.
Context: ${sanitizeComment(context)}
-->`;
}

function shortReminder(context, expanded = false) {
  return `<!--${REQUEST_MARKER} v5; Research sidecar open. Keep visible answer normal. Meaningful graph change only => one fenced rgdelta block starting RGΔ; otherwise none. Reuse/link supplied ids; one response usually updates one primary node. deepens/d is ALWAYS child>parent (specific>broader); a new drill-down node points to its broader parent. ${expanded ? 'Expanded local snapshot. ' : ''}${sanitizeComment(context)} -->`;
}

async function refreshContext() {
  try {
    const conversationId = getConversationId();
    cachedConversationId = conversationId;
    const autoKey = autoGraphKey(conversationId);
    const liveKey = heartbeatKey(conversationId);
    const scope = conversationId ? await resolveResearchScope(conversationId) : null;
    const scopeId = scopeStorageId(scope, conversationId);
    const bootstrapKey = `${BOOTSTRAP_PREFIX}${scopeId}`;
    const countKey = `${REQUEST_COUNT_PREFIX}${scopeId}`;
    const keys = [autoKey, liveKey, bootstrapKey, countKey];
    if (scope?.graphKey) keys.push(scope.graphKey);

    const result = await chrome.storage.local.get(keys);
    // Sidecar presence is the real Research Mode switch. A fresh heartbeat is
    // sufficient; the auto flag is retained only for backward compatibility.
    enabled = heartbeatIsFresh(result?.[liveKey]);
    if (!enabled) {
      cachedGraph = null;
      return;
    }

    cachedScope = scope || { type: 'conversation', projectId: null, graphKey: null };
    cachedGraph = scope?.graphKey ? result?.[scope.graphKey] || null : null;
    cachedBootstrapped = !!result?.[bootstrapKey];
    cachedRequestCount = Number(result?.[countKey] || 0);
  } catch (error) {
    console.warn('[ResearchProducer] Failed to refresh context:', error);
    enabled = false;
    cachedGraph = null;
  }
}

function findPromptEditor() {
  return document.querySelector('#prompt-textarea')
    || document.querySelector('[data-testid="prompt-textarea"]')
    || document.querySelector('form [contenteditable="true"]')
    || document.querySelector('textarea[placeholder]');
}

function editorText(editor) {
  if (!editor) return '';
  if ('value' in editor && typeof editor.value === 'string') return editor.value;
  return editor.innerText || editor.textContent || '';
}

function appendToTextarea(editor, suffix) {
  const proto = editor instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  const nextValue = `${editor.value || ''}${suffix}`;
  if (setter) setter.call(editor, nextValue);
  else editor.value = nextValue;
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  editor.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function appendToContentEditable(editor, suffix) {
  editor.focus();
  const selection = window.getSelection();
  if (!selection) return false;
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);

  let inserted = false;
  try { inserted = document.execCommand('insertText', false, suffix); } catch { inserted = false; }
  if (!inserted) {
    range.insertNode(document.createTextNode(suffix));
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    try {
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: suffix }));
    } catch {
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  return true;
}

function buildSuffix(userText) {
  const nextCount = cachedRequestCount + 1;
  const rebootstrap = !cachedBootstrapped || nextCount % REBOOTSTRAP_EVERY === 0;
  const expanded = rebootstrap || nextCount % EXPANDED_CONTEXT_EVERY === 0;
  const context = compactGraphContext(cachedGraph, userText, cachedScope, expanded);
  return `\n\n${rebootstrap ? fullBootstrap(context) : shortReminder(context, expanded)}`;
}

function appendProducerRequest() {
  if (!enabled) return false;
  const editor = findPromptEditor();
  if (!editor) return false;
  const text = editorText(editor);
  if (!cleanText(text)) return false;
  if (text.includes(`<!--${REQUEST_MARKER}`)) return true;

  const suffix = buildSuffix(text);
  let success = false;
  if ('value' in editor && typeof editor.value === 'string') success = appendToTextarea(editor, suffix);
  else if (editor.isContentEditable) success = appendToContentEditable(editor, suffix);

  if (success) {
    const scopeId = scopeStorageId(cachedScope, cachedConversationId);
    const bootstrapKey = `${BOOTSTRAP_PREFIX}${scopeId}`;
    const countKey = `${REQUEST_COUNT_PREFIX}${scopeId}`;
    const nextCount = cachedRequestCount + 1;
    cachedBootstrapped = true;
    cachedRequestCount = nextCount;
    chrome.storage.local.set({ [bootstrapKey]: true, [countKey]: nextCount }).catch(() => {});
    console.debug('[ResearchProducer] v5 request attached', { scopeId, nextCount });
  }
  return success;
}

function isSendButton(target) {
  if (!(target instanceof Element)) return false;
  return !!target.closest('[data-testid="send-button"], button[aria-label*="Send"], button[aria-label*="发送"], button[data-testid*="send"]');
}

function hideRenderedDeltaBlocks(root = document) {
  const candidates = root.querySelectorAll?.('pre, code') || [];
  for (const element of candidates) {
    const text = String(element.innerText || element.textContent || '').trim();
    if (!text.startsWith('RGΔ')) continue;
    const block = element.closest('pre') || element;
    if (block.dataset?.researchBlackboardDelta === '1') continue;
    try {
      block.dataset.researchBlackboardDelta = '1';
      block.style.setProperty('display', 'none', 'important');
      block.setAttribute('aria-hidden', 'true');
    } catch {
      // best effort only
    }
  }
}

function setupDeltaBlockHider() {
  hideRenderedDeltaBlocks();
  deltaHideObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes || []) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.('pre, code')) {
          const text = String(node.innerText || node.textContent || '').trim();
          if (text.startsWith('RGΔ')) {
            hideRenderedDeltaBlocks(node.parentElement || document);
            continue;
          }
        }
        hideRenderedDeltaBlocks(node);
      }
    }
  });
  deltaHideObserver.observe(document.documentElement, { childList: true, subtree: true });
}

function setupSubmissionHooks() {
  document.addEventListener('keydown', (event) => {
    if (!enabled || event.defaultPrevented || event.isComposing) return;
    if (event.key !== 'Enter' || event.shiftKey) return;
    const editor = findPromptEditor();
    if (!editor || (event.target !== editor && !editor.contains?.(event.target))) return;
    appendProducerRequest();
  }, true);

  document.addEventListener('pointerdown', (event) => {
    if (!enabled || !isSendButton(event.target)) return;
    appendProducerRequest();
  }, true);
}

function setupContextRefresh() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (Object.keys(changes || {}).some((key) => (
      key.startsWith(AUTO_GRAPH_PREFIX)
      || key.startsWith(SIDECAR_HEARTBEAT_PREFIX)
      || key.startsWith(CONVERSATION_GRAPH_PREFIX)
      || key.startsWith(PROJECT_GRAPH_PREFIX)
      || key.startsWith(CONVERSATION_PROJECT_PREFIX)
      || key.startsWith(BOOTSTRAP_PREFIX)
      || key.startsWith(REQUEST_COUNT_PREFIX)
    ))) void refreshContext();
  });

  let lastPath = window.location.pathname;
  refreshTimer = window.setInterval(() => {
    const pathChanged = window.location.pathname !== lastPath;
    if (pathChanged) lastPath = window.location.pathname;
    if (pathChanged || enabled) void refreshContext();
  }, 1200);
}

function init() {
  void refreshContext();
  setupSubmissionHooks();
  setupContextRefresh();
  setupDeltaBlockHider();
  console.debug('[ResearchProducer] Initialized v5');
}

init();
