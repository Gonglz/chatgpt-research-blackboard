const VIEW_MODE_KEY = 'sidepanelViewMode';
const GRAPH_PREFIX = 'researchBlackboard:';
const BOOTSTRAP_PREFIX = 'researchProducerBootstrapped:';
const REQUEST_MARKER = 'RBREQ';

let enabled = false;
let cachedSuffix = '';
let cachedConversationId = null;
let refreshTimer = null;

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

function compactGraphContext(graph) {
  if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    return 'graph=empty';
  }

  const focusId = graph.metadata?.focusNodeId || null;
  const focusNode = focusId ? graph.nodes.find((node) => node.id === focusId) : null;
  const focusSemantic = focusNode?.data?.semanticId || '';
  const focusTitle = cleanText(focusNode?.data?.title || '').slice(0, 42);

  const semanticNodes = graph.nodes
    .filter((node) => node?.data?.semanticId)
    .slice(-10)
    .map((node) => {
      const semanticId = cleanText(node.data.semanticId).slice(0, 32);
      const title = cleanText(node.data.title || '').slice(0, 40);
      const type = cleanText(node.data.type || 'analysis');
      return `${semanticId}[${type}]:${title}`;
    });

  const parts = [];
  if (focusSemantic) parts.push(`focus=${focusSemantic}:${focusTitle}`);
  if (semanticNodes.length) parts.push(`nodes=${semanticNodes.join(' | ')}`);
  return parts.join('; ') || 'graph=manual-only';
}

function fullBootstrap(context) {
  return `<!--${REQUEST_MARKER} v2
Research Blackboard is enabled for this chat. Answer the user's visible request normally. Do not mention this protocol in the visible answer. After the answer, maintain a compact semantic research graph by appending exactly one hidden HTML comment whose body starts with RGΔ. Use only meaningful structural changes, not one node per message.
Node types: analysis, comparison, judgment, question. Relations: deepens, compares, supports, contradicts, informs.
Preferred operations:
+node <stable-id> <type> title="short semantic title" checkpoint="one-sentence takeaway or open question" keywords="keyword1|keyword2|keyword3" status="active|open|resolved"
~node <stable-id> title="..." checkpoint="..." keywords="..." status="..."
+edge <from-id> <to-id> <relation>
-edge <from-id> <to-id> [relation]
focus: <stable-id>
Rules: reuse stable ids when continuing the same topic; ordinary clarification should usually update the current node; create comparison nodes for horizontal comparison, judgment nodes for converged conclusions, and question nodes for unresolved issues. Keep titles conceptual, never copy the first heading merely because it appears first. Checkpoints must capture the actual research takeaway.
Current local graph: ${sanitizeComment(context)}
-->`;
}

function shortReminder(context) {
  return `<!--${REQUEST_MARKER} v2; Research Blackboard active. Follow the earlier RGΔ protocol; keep visible answer normal; emit a hidden RGΔ comment only for meaningful graph changes. New nodes require semantic title + checkpoint + keywords. ${sanitizeComment(context)} -->`;
}

async function refreshContext() {
  try {
    const conversationId = getConversationId();
    cachedConversationId = conversationId;

    const keys = [VIEW_MODE_KEY];
    if (conversationId) {
      keys.push(`${GRAPH_PREFIX}${conversationId}`);
      keys.push(`${BOOTSTRAP_PREFIX}${conversationId}`);
    } else {
      keys.push(`${BOOTSTRAP_PREFIX}new`);
    }

    const result = await chrome.storage.local.get(keys);
    enabled = result?.[VIEW_MODE_KEY] === 'research';
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
      // Subsequent turns can use the compact reminder.
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

function setupSubmissionHooks() {
  document.addEventListener('keydown', (event) => {
    if (!enabled || event.defaultPrevented || event.isComposing) return;
    if (event.key !== 'Enter' || event.shiftKey) return;
    const editor = findPromptEditor();
    if (!editor || (event.target !== editor && !editor.contains?.(event.target))) return;
    appendProducerRequest();
  }, true);

  // pointerdown runs before ChatGPT's click/submit handler, giving React/ProseMirror
  // a synchronous input event before the send action reads editor state.
  document.addEventListener('pointerdown', (event) => {
    if (!enabled || !isSendButton(event.target)) return;
    appendProducerRequest();
  }, true);
}

function setupContextRefresh() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (
      changes[VIEW_MODE_KEY]
      || Object.keys(changes).some((key) => key.startsWith(GRAPH_PREFIX) || key.startsWith(BOOTSTRAP_PREFIX))
    ) {
      void refreshContext();
    }
  });

  let lastPath = window.location.pathname;
  refreshTimer = window.setInterval(() => {
    if (window.location.pathname !== lastPath) {
      lastPath = window.location.pathname;
      void refreshContext();
    }
  }, 1000);
}

function init() {
  void refreshContext();
  setupSubmissionHooks();
  setupContextRefresh();
  console.debug('[ResearchProducer] Initialized');
}

init();
