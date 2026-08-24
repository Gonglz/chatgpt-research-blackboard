import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const GRAPH_PREFIX = 'researchBlackboard:';
const FONT_STACK = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

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

function inferTitle(quote) {
  const first = cleanText(quote).split(/[。！？?!；;\n]/).find(Boolean) || 'Highlight';
  return first.length > 34 ? `${first.slice(0, 34)}…` : first;
}

async function currentConversationId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const match = String(tab?.url || '').match(/\/c\/([a-zA-Z0-9-]+)/);
  return match?.[1] || null;
}

function currentSelectedNodeId() {
  const selected = document.querySelector('.main-content .react-flow__node.selected');
  return selected?.getAttribute('data-id') || selected?.dataset?.id || null;
}

async function loadGraph() {
  const conversationId = await currentConversationId();
  if (!conversationId) return { conversationId: null, graph: null };
  const key = `${GRAPH_PREFIX}${conversationId}`;
  const result = await chrome.storage.local.get([key]);
  return { conversationId, graph: result?.[key] || null };
}

async function saveGraph(conversationId, graph, selectedNodeId) {
  const key = `${GRAPH_PREFIX}${conversationId}`;
  await chrome.storage.local.set({
    [key]: {
      ...graph,
      conversationId,
      metadata: {
        ...(graph.metadata || {}),
        selectedNodeId,
        lastSelectionAt: Date.now()
      },
      updatedAt: Date.now()
    }
  });
}

async function mutateSelectedGraph(mutator) {
  const { conversationId, graph } = await loadGraph();
  if (!conversationId || !graph) throw new Error('No Research Blackboard graph found.');
  const selectedNodeId = currentSelectedNodeId() || graph.metadata?.selectedNodeId;
  if (!selectedNodeId) throw new Error('Select a research node first.');
  const next = mutator(graph, selectedNodeId);
  if (!next) return false;
  await saveGraph(conversationId, next, next.metadata?.selectedNodeId || selectedNodeId);
  window.setTimeout(() => window.location.reload(), 90);
  return true;
}

async function exactJump(highlight) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return false;
  const payload = {
    messageId: highlight?.messageId || '',
    quote: cleanText(highlight?.quote || ''),
    paragraph: cleanText(highlight?.localParagraph || ''),
    heading: cleanText(highlight?.localHeading || '')
  };
  if (!payload.quote) return false;

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [payload],
    func: (input) => {
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const escapeValue = (value) => window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');

      const findContainer = () => {
        if (input.messageId) {
          const id = escapeValue(input.messageId);
          const exact = document.querySelector(`[data-turn-id="${id}"]`)
            || document.querySelector(`[data-message-id="${id}"]`);
          if (exact) return exact.closest('section[data-turn-id], article') || exact;
        }

        const candidates = Array.from(document.querySelectorAll('section[data-turn-id], article'));
        return candidates.find((el) => normalize(el.innerText || el.textContent || '').includes(input.quote)) || null;
      };

      const container = findContainer();
      if (!container) return { success: false, method: 'message-not-found' };

      const blocks = Array.from(container.querySelectorAll('p, li, blockquote, td, th, h1, h2, h3, h4, h5, h6, div'));
      let target = blocks.find((el) => normalize(el.innerText || el.textContent || '').includes(input.quote));
      if (!target && input.paragraph) {
        const probe = input.paragraph.slice(0, 120);
        target = blocks.find((el) => normalize(el.innerText || el.textContent || '').includes(probe));
      }
      target ||= container;

      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
      const chars = [];
      const map = [];
      let lastWasSpace = false;
      let node;

      while ((node = walker.nextNode())) {
        const text = node.nodeValue || '';
        for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          if (/\s/.test(ch)) {
            if (chars.length && !lastWasSpace) {
              chars.push(' ');
              map.push({ node, offset: i });
              lastWasSpace = true;
            }
          } else {
            chars.push(ch);
            map.push({ node, offset: i });
            lastWasSpace = false;
          }
        }
      }

      const normalizedTarget = chars.join('').trim();
      const quote = normalize(input.quote);
      const start = normalizedTarget.indexOf(quote);

      if (start >= 0 && map[start] && map[start + quote.length - 1]) {
        const startPoint = map[start];
        const endPoint = map[start + quote.length - 1];
        const range = document.createRange();
        range.setStart(startPoint.node, startPoint.offset);
        range.setEnd(endPoint.node, Math.min((endPoint.node.nodeValue || '').length, endPoint.offset + 1));

        const anchor = range.startContainer.parentElement || target;
        anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });

        try {
          if (window.Highlight && CSS?.highlights) {
            let style = document.getElementById('research-blackboard-exact-highlight-style');
            if (!style) {
              style = document.createElement('style');
              style.id = 'research-blackboard-exact-highlight-style';
              style.textContent = '::highlight(research-blackboard-exact){ background: #fde68a; color: inherit; }';
              document.head.appendChild(style);
            }
            CSS.highlights.set('research-blackboard-exact', new Highlight(range));
            window.setTimeout(() => CSS.highlights.delete('research-blackboard-exact'), 2200);
            return { success: true, method: 'exact-range' };
          }
        } catch {
          // Fall through to block-level highlight.
        }
      }

      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const previous = target.style.backgroundColor;
      target.style.backgroundColor = '#fef3c7';
      window.setTimeout(() => { target.style.backgroundColor = previous; }, 1800);
      return { success: true, method: 'block-fallback' };
    }
  });

  return !!results?.[0]?.result?.success;
}

function managerButtonStyle(active) {
  return {
    position: 'absolute',
    right: 42,
    top: 8,
    zIndex: 120,
    height: 24,
    minWidth: 28,
    padding: '0 7px',
    border: active ? '1px solid #94a3b8' : '1px solid #e2e8f0',
    borderRadius: 7,
    background: '#fff',
    color: '#475569',
    fontFamily: FONT_STACK,
    fontSize: 11,
    fontWeight: 650,
    cursor: 'pointer'
  };
}

export default function ResearchHighlightManager({ enabled = true }) {
  const [detailEl, setDetailEl] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [graph, setGraph] = useState(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('');
  const refreshTimer = useRef(null);

  const refresh = async () => {
    if (!enabled) return;
    const detail = document.querySelector('section[aria-label="Research node detail"]');
    const selectedId = currentSelectedNodeId();
    setDetailEl(detail || null);
    setSelectedNodeId(selectedId || null);
    if (!detail || !selectedId) {
      setGraph(null);
      setOpen(false);
      return;
    }
    const loaded = await loadGraph();
    setGraph(loaded.graph || null);
  };

  useEffect(() => {
    if (!enabled) return undefined;
    void refresh();
    refreshTimer.current = window.setInterval(() => { void refresh(); }, 500);
    const listener = (changes, area) => {
      if (area !== 'local') return;
      if (Object.keys(changes).some((key) => key.startsWith(GRAPH_PREFIX))) void refresh();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      if (refreshTimer.current) window.clearInterval(refreshTimer.current);
      chrome.storage.onChanged.removeListener(listener);
    };
  }, [enabled]);

  const selectedNode = useMemo(
    () => graph?.nodes?.find((node) => node.id === selectedNodeId) || null,
    [graph, selectedNodeId]
  );
  const highlights = Array.isArray(selectedNode?.data?.highlights) ? selectedNode.data.highlights : [];

  if (!enabled || !detailEl || !selectedNode) return null;

  const moveHighlight = async (highlightId, targetNodeId) => {
    if (!targetNodeId || targetNodeId === selectedNodeId) return;
    await mutateSelectedGraph((current, sourceNodeId) => {
      const sourceNode = current.nodes.find((node) => node.id === sourceNodeId);
      const targetNode = current.nodes.find((node) => node.id === targetNodeId);
      if (!sourceNode || !targetNode) return current;
      const sourceHighlights = Array.isArray(sourceNode.data?.highlights) ? sourceNode.data.highlights : [];
      const item = sourceHighlights.find((highlight) => highlight.id === highlightId);
      if (!item) return current;
      return {
        ...current,
        nodes: current.nodes.map((node) => {
          if (node.id === sourceNodeId) return { ...node, data: { ...node.data, highlights: sourceHighlights.filter((highlight) => highlight.id !== highlightId) } };
          if (node.id === targetNodeId) {
            const targetHighlights = Array.isArray(node.data?.highlights) ? node.data.highlights : [];
            return { ...node, data: { ...node.data, highlights: targetHighlights.concat(item) } };
          }
          return node;
        }),
        metadata: { ...(current.metadata || {}), selectedNodeId: targetNodeId }
      };
    });
  };

  const reorder = async (highlightId, direction) => {
    await mutateSelectedGraph((current, nodeId) => ({
      ...current,
      nodes: current.nodes.map((node) => {
        if (node.id !== nodeId) return node;
        const items = [...(Array.isArray(node.data?.highlights) ? node.data.highlights : [])];
        const index = items.findIndex((item) => item.id === highlightId);
        if (index < 0) return node;
        const nextIndex = Math.max(0, Math.min(items.length - 1, index + direction));
        if (nextIndex === index) return node;
        const [item] = items.splice(index, 1);
        items.splice(nextIndex, 0, item);
        return { ...node, data: { ...node.data, highlights: items } };
      })
    }));
  };

  const deleteHighlight = async (highlightId) => {
    if (!window.confirm('Delete this highlight?')) return;
    await mutateSelectedGraph((current, nodeId) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === nodeId
        ? { ...node, data: { ...node.data, highlights: (node.data?.highlights || []).filter((item) => item.id !== highlightId) } }
        : node)
    }));
  };

  const addNote = async (highlight) => {
    const note = window.prompt('Note for this highlight', highlight.note || '');
    if (note === null) return;
    await mutateSelectedGraph((current, nodeId) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === nodeId
        ? {
            ...node,
            data: {
              ...node.data,
              highlights: (node.data?.highlights || []).map((item) => item.id === highlight.id
                ? { ...item, note: cleanText(note), updatedAt: Date.now() }
                : item)
            }
          }
        : node)
    }));
  };

  const promote = async (highlight) => {
    await mutateSelectedGraph((current, nodeId) => {
      const parent = current.nodes.find((node) => node.id === nodeId);
      if (!parent) return current;
      const id = makeId('research');
      const childIndex = (current.edges || []).filter((edge) => edge.source === nodeId).length;
      const side = childIndex % 2 === 0 ? 1 : -1;
      const ring = Math.floor(childIndex / 2) + 1;
      const promoted = {
        id,
        type: 'researchNode',
        position: {
          x: Number(parent.position?.x || 0) + side * (225 + Math.min(ring - 1, 2) * 45),
          y: Number(parent.position?.y || 0) + 150 + Math.min(ring - 1, 3) * 35
        },
        data: {
          type: 'analysis',
          title: inferTitle(highlight.quote),
          titleSource: 'highlight',
          titleEdited: false,
          keywords: [],
          checkpoint: cleanText(highlight.note || ''),
          messageId: highlight.messageId || null,
          messageRole: highlight.messageRole || 'assistant',
          messagePreview: highlight.messagePreview || cleanText(highlight.quote).slice(0, 180),
          messageTail: highlight.messageTail || '',
          messageTextLength: highlight.messageTextLength || 0,
          highlights: [{ ...highlight }],
          createdFromHighlight: true
        }
      };
      return {
        ...current,
        nodes: [...current.nodes, promoted],
        edges: [...(current.edges || []), {
          id: makeId('edge'),
          source: nodeId,
          target: id,
          type: 'smoothstep',
          label: 'deepens',
          data: { relation: 'deepens', createdFromHighlight: true }
        }],
        metadata: { ...(current.metadata || {}), selectedNodeId: id, focusNodeId: id }
      };
    });
  };

  const panel = (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        style={managerButtonStyle(open)}
        title="Manage highlights"
        aria-label="Manage highlights"
      >
        ★{highlights.length || ''}
      </button>
      {open ? (
        <div
          style={{
            position: 'absolute',
            right: 8,
            top: 38,
            zIndex: 160,
            width: 'min(310px, calc(100% - 16px))',
            maxHeight: 'calc(100% - 48px)',
            overflowY: 'auto',
            border: '1px solid #dbe3ee',
            borderRadius: 10,
            background: '#fff',
            boxShadow: '0 14px 32px rgba(15,23,42,.18)',
            padding: 8,
            fontFamily: FONT_STACK
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '1px 2px 6px' }}>
            <strong style={{ fontSize: 12.5, color: '#111827' }}>Highlights · {highlights.length}</strong>
            <button type="button" onClick={() => setOpen(false)} style={{ border: 0, background: 'transparent', color: '#64748b', cursor: 'pointer' }}>×</button>
          </div>

          {!highlights.length ? (
            <div style={{ fontSize: 11.5, lineHeight: '17px', color: '#94a3b8', padding: 6 }}>No highlights in this node.</div>
          ) : highlights.map((highlight, index) => (
            <div key={highlight.id || `${highlight.messageId}:${index}`} style={{ borderTop: index ? '1px solid #eef2f7' : 0, padding: '8px 3px' }}>
              <button
                type="button"
                onClick={async () => {
                  setStatus('Locating…');
                  const ok = await exactJump(highlight);
                  setStatus(ok ? 'Exact source located' : 'Source not found');
                }}
                style={{ width: '100%', border: 0, background: 'transparent', padding: 0, textAlign: 'left', fontFamily: FONT_STACK, fontSize: 11.8, lineHeight: '17px', color: '#334155', cursor: 'pointer' }}
                title="Jump to exact quote"
              >
                ★ “{cleanText(highlight.quote).slice(0, 180)}{cleanText(highlight.quote).length > 180 ? '…' : ''}”
              </button>
              {highlight.note ? (
                <div style={{ marginTop: 5, padding: '5px 6px', borderLeft: '2px solid #cbd5e1', fontSize: 11.3, lineHeight: '16px', color: '#64748b' }}>
                  {highlight.note}
                </div>
              ) : null}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                <button type="button" onClick={() => reorder(highlight.id, -1)} disabled={index === 0} style={smallButtonStyle}>↑</button>
                <button type="button" onClick={() => reorder(highlight.id, 1)} disabled={index === highlights.length - 1} style={smallButtonStyle}>↓</button>
                <button type="button" onClick={() => addNote(highlight)} style={smallButtonStyle}>Note</button>
                <button type="button" onClick={() => promote(highlight)} style={smallButtonStyle}>Promote</button>
                <select
                  defaultValue=""
                  onChange={(event) => moveHighlight(highlight.id, event.target.value)}
                  style={{ ...smallButtonStyle, maxWidth: 105, appearance: 'auto' }}
                  aria-label="Move highlight to another node"
                >
                  <option value="">Move…</option>
                  {(graph.nodes || []).filter((node) => node.id !== selectedNodeId).map((node) => (
                    <option key={node.id} value={node.id}>{cleanText(node.data?.title || node.id).slice(0, 40)}</option>
                  ))}
                </select>
                <button type="button" onClick={() => deleteHighlight(highlight.id)} style={{ ...smallButtonStyle, color: '#b91c1c' }}>Delete</button>
              </div>
            </div>
          ))}

          {status ? (
            <div style={{ marginTop: 5, padding: '6px 3px 1px', borderTop: '1px solid #eef2f7', fontSize: 10.5, color: '#64748b' }}>{status}</div>
          ) : null}
        </div>
      ) : null}
    </>
  );

  return createPortal(panel, detailEl);
}

const smallButtonStyle = {
  height: 24,
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  background: '#fff',
  color: '#475569',
  padding: '0 6px',
  fontFamily: FONT_STACK,
  fontSize: 10.5,
  lineHeight: '22px',
  cursor: 'pointer'
};
