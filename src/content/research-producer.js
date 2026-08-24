const AUTO_GRAPH_PREFIX = 'researchAutoGraphEnabled:';
const SIDECAR_HEARTBEAT_PREFIX = 'researchSidecarHeartbeat:';
const GRAPH_PREFIX = 'researchBlackboard:';
const BOOTSTRAP_PREFIX = 'researchProducerBootstrappedV3:';
const REQUEST_MARKER = 'RBREQ';
const HEARTBEAT_TTL_MS = 4500;

let enabled = false;
let cachedSuffix = '';
let cachedConversationId = null;
let refreshTimer = null;
let deltaHideObserver = null;

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sanitizeComment(value) {
  return String(value || '').replace(/-->/g, '-- >').replace(/<!--/g, '< !--');
}

function getConversationId() {
  const match = window.location.pathname.match(/\/c\/([a-zA-Z0-9-]+)/);
  return match?.[1] || null;
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

function manualSemanticId(nodeId) {
  const safe = String(nodeId || '').replace(/[^A-Za-z0-9_.:-]/g, '_');
  return `M_${safe.slice(-12) || 'node'}`;
}

function semanticIdOf(node) {
  if (node?.data?.semanticId) return cleanText(node.data.semanticId);
  if (String(node?.id || '').startsWith('rg_')) return String(node.id).slice(3);
  return manualSemanticId(node?.id);
}

function compactGraphContext(graph) {
  if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    return 'graph=empty';
  }

  const focusId = graph.metadata?.focusNodeId || null;
  const focusNode = focusId ? graph.nodes.find((node) => node.id === focusId) : null;
  const focusSemantic = focusNode ? semanticIdOf(focusNode) : '';
  const focusTitle = cleanText(focusNode?.data?.title || '').slice(0, 42);

  const contextNodes = graph.nodes
    .slice(-12)
    .map((node) => {
      const semanticId = semanticIdOf(node).slice(0, 40);
      const title = cleanText(node?.data?.title || 'Untitled').slice(0, 48);
      const type = cleanText(node?.data?.type || 'analysis');
      return `${semanticId}[${type}]:${title}`;
    });

  const parts = [];
  if (focusSemantic) parts.push(`focus=${focusSemantic}:${focusTitle}`);
  if (contextNodes.length) parts.push(`nodes=${contextNodes.join(' | ')}`);
  return parts.join('; ') || 'graph=empty';
}

function fullBootstrap(context) {
  return `<!--${REQUEST_MARKER} v3
Research Blackboard sidecar is open. Answer the user's visible request normally and do not mention this protocol.
After the visible answer, maintain the semantic research graph only when this turn creates a meaningful structural change.
Transport v3: append exactly one fenced Markdown code block with language rgdelta; its first line must be RGΔ. Do NOT use an HTML comment for RGΔ. The extension will hide and consume this block.
Node types: analysis, comparison, judgment, question. Relations: deepens, compares, supports, contradicts, informs.
Use stable ids from Current local graph when continuing or linking to existing nodes, including M_* ids for older manual nodes.
Operations:
+node <stable-id> <type> title="short semantic title" checkpoint="one-sentence takeaway or open question" keywords="keyword1|keyword2|keyword3" status="active|open|resolved"
~node <stable-id> title="..." checkpoint="..." keywords="..." status="..."
+edge <from-id> <to-id> <relation>
-edge <from-id> <to-id> [relation]
focus: <stable-id>
Rules: ordinary clarification should usually update an existing node; create comparison nodes for horizontal comparison, judgment nodes for converged conclusions, and question nodes for unresolved issues. Keep titles conceptual. Checkpoints capture the research takeaway, not the first heading. Connect new nodes back into the existing graph whenever the relationship is clear. If there is no meaningful graph change, emit no rgdelta block.
Current local graph: ${sanitizeComment(context)}
-->`;
}

function shortReminder(context) {
  return `<!--${REQUEST_MARKER} v3; Research sidecar open. Keep visible answer normal. For meaningful graph changes only, emit one fenced rgdelta Markdown block starting with RGΔ (not an HTML comment); reuse/link existing ids and include title+checkpoint+keywords for new nodes. ${sanitizeComment(context)} -->`;
}

async function refreshContext() {
  try {
    const conversationId = getConversationId();
    cachedConversationId = conversationId;
    const autoKey = autoGraphKey(conversationId);
    const liveKey = heartbeatKey(conversationId);

    const keys = [autoKey, liveKey];
    if (conversationId) {
      keys.push(`${GRAPH_PREFIX}${conversationId}`);
      keys.push(`${BOOTSTRAP_PREFIX}${conversationId}`);
    } else {
      keys.push(`${BOOTSTRAP_PREFIX}new`);
    }

    const result = await chrome.storage.local.get(keys);
    enabled = result?.[autoKey] === true && heartbeatIsFresh(result?.[liveKey]);
    if (!enabled) {
      cachedSuffix = '';
      return;
    }

    const graph = conversationId ? result?.[`${GRAPH_PREFIX}${conversationId}`] : null;
    const context = compactGraphContext(graph);
    const bootstrapped = !!result?.[`${BOOTSTRAP_PREFIX}${conversationId || 'new'}`];
    cachedSuffix = `\n\n${bootstrapped ? shortReminder(context) : fullBootstrap(context)}`;
  } catch (error) {
    console.warn('[ResearchProducer] Failed to refresh context:', error);
    enabled = false;
    cachedSuffix = '';
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
  const proto = editor instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
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
  try {
    inserted = document.execCommand('insertText', false, suffix);
  } catch {
    inserted = false;
  }

  if (!inserted) {
    range.insertNode(document.createTextNode(suffix));
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    try {
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: suffix
      }));
    } catch {
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  return true;
}

function appendProducerRequest() {
  if (!enabled || !cachedSuffix) return false;
  const editor = findPromptEditor();
  if (!editor) return false;

  const text = editorText(editor);
  if (!cleanText(text)) return false;
  if (text.includes(`<!--${REQUEST_MARKER}`)) return true;

  let success = false;
  if ('value' in editor && typeof editor.value === 'string') {
    success = appendToTextarea(editor, cachedSuffix);
  } else if (editor.isContentEditable) {
    success = appendToContentEditable(editor, cachedSuffix);
  }

  if (success) {
    const bootstrapKey = `${BOOTSTRAP_PREFIX}${cachedConversationId || 'new'}`;
    chrome.storage.local.set({ [bootstrapKey]: true }).then(() => {
      void refreshContext();
    }).catch(() => {});
    console.debug('[ResearchProducer] Sidecar request attached');
  }

  return success;
}

function isSendButton(target) {
  if (!(target instanceof Element)) return false;
  return !!target.closest(
    '[data-testid="send-button"], button[aria-label*="Send"], button[aria-label*="发送"], button[data-testid*="send"]'
  );
}

/**
 * RGΔ v3 is deliberately DOM-readable. Hide its rendered fenced block so the
 * machine transport does not add visual noise to ChatGPT.
 */
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

  deltaHideObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
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
    if (Object.keys(changes).some((key) => (
      key.startsWith(AUTO_GRAPH_PREFIX)
      || key.startsWith(SIDECAR_HEARTBEAT_PREFIX)
      || key.startsWith(GRAPH_PREFIX)
      || key.startsWith(BOOTSTRAP_PREFIX)
    ))) {
      void refreshContext();
    }
  });

  let lastPath = window.location.pathname;
  refreshTimer = window.setInterval(() => {
    const pathChanged = window.location.pathname !== lastPath;
    if (pathChanged) lastPath = window.location.pathname;

    // Refresh continuously while enabled so a stale heartbeat turns Research
    // Mode off even if Chrome skipped the side-panel unload handler.
    if (pathChanged || enabled) {
      void refreshContext();
    }
  }, 1200);
}

function init() {
  void refreshContext();
  setupSubmissionHooks();
  setupContextRefresh();
  setupDeltaBlockHider();
  console.debug('[ResearchProducer] Initialized');
}

init();
