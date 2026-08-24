import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadScopedGraphRecord, writeScopedGraphRecord } from '../../shared/researchScope';
import { jumpToResearchHighlightSource } from '../utils/researchSourceJump';

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
  return String(tab?.url || '').match(/\/c\/([a-zA-Z0-9-]+)/)?.[1] || null;
}

function currentSelectedNodeId() {
  const selected = document.querySelector('.main-content .react-flow__node.selected');
  return selected?.getAttribute('data-id') || selected?.dataset?.id || null;
}

async function loadGraph() {
  const conversationId = await currentConversationId();
  if (!conversationId) return { conversationId: null, graph: null };
  const { graph } = await loadScopedGraphRecord(conversationId);
  return { conversationId, graph };
}

async function saveGraph(conversationId, graph, selectedNodeId) {
  const now = Date.now();
  await writeScopedGraphRecord(conversationId, {
    ...graph,
    metadata: {
      ...(graph.metadata || {}),
      selectedNodeId,
      lastSelectionAt: now
    },
    updatedAt: now
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
  return true;
}

function managerButtonStyle(active) {
  return {
    position: 'absolute', right: 42, top: 8, zIndex: 120,
    height: 24, minWidth: 28, padding: '0 7px',
    border: active ? '1px solid #94a3b8' : '1px solid #e2e8f0',
    borderRadius: 7, background: '#fff', color: '#475569',
    fontFamily: FONT_STACK, fontSize: 11, fontWeight: 650, cursor: 'pointer'
  };
}

const actionStyle = {
  border: 0,
  borderRadius: 6,
  background: 'transparent',
  padding: '6px 7px',
  fontFamily: FONT_STACK,
  fontSize: 11,
  lineHeight: '15px',
  color: '#475569',
  textAlign: 'left',
  cursor: 'pointer'
};

export default function ResearchHighlightManager({ enabled = true }) {
  const [detailEl, setDetailEl] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [graph, setGraph] = useState(null);
  const [open, setOpen] = useState(false);
  const [openItemId, setOpenItemId] = useState(null);
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
      setOpenItemId(null);
      return;
    }
    const loaded = await loadGraph();
    setGraph(loaded.graph || null);
  };

  useEffect(() => {
    if (!enabled) return undefined;
    void refresh();
    refreshTimer.current = window.setInterval(() => { void refresh(); }, 450);
    const listener = (changes, area) => {
      if (area !== 'local') return;
      if (Object.keys(changes || {}).some((key) => key.startsWith('researchBlackboard:') || key.startsWith('researchProjectGraph:'))) void refresh();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      if (refreshTimer.current) window.clearInterval(refreshTimer.current);
      chrome.storage.onChanged.removeListener(listener);
    };
  }, [enabled]);

  const selectedNode = useMemo(() => graph?.nodes?.find((node) => node.id === selectedNodeId) || null, [graph, selectedNodeId]);
  const highlights = Array.isArray(selectedNode?.data?.highlights) ? selectedNode.data.highlights : [];
  const promotedParentId = selectedNode?.data?.promotedFromNodeId
    || graph?.edges?.find((edge) => edge.target === selectedNodeId && edge.data?.createdFromHighlight)?.source
    || null;

  if (!enabled || !detailEl || !selectedNode) return null;

  const mutate = async (fn, message = '') => {
    try {
      await mutateSelectedGraph(fn);
      if (message) setStatus(message);
      setOpenItemId(null);
      await refresh();
    } catch (error) {
      setStatus(error?.message || 'Update failed');
    }
  };

  const moveHighlight = async (highlightId, targetNodeId) => {
    if (!targetNodeId || targetNodeId === selectedNodeId) return;
    await mutate((current, sourceNodeId) => {
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
            const duplicate = targetHighlights.some((highlight) => highlight.id === item.id);
            return { ...node, data: { ...node.data, highlights: duplicate ? targetHighlights : targetHighlights.concat(item) } };
          }
          return node;
        }),
        metadata: { ...(current.metadata || {}), selectedNodeId: targetNodeId }
      };
    }, 'Highlight moved');
  };

  const reorder = (highlightId, direction) => mutate((current, nodeId) => ({
    ...current,
    nodes: current.nodes.map((node) => {
      if (node.id !== nodeId) return node;
      const items = [...(Array.isArray(node.data?.highlights) ? node.data.highlights : [])];
      const index = items.findIndex((item) => item.id === highlightId);
      const nextIndex = Math.max(0, Math.min(items.length - 1, index + direction));
      if (index < 0 || nextIndex === index) return node;
      const [item] = items.splice(index, 1);
      items.splice(nextIndex, 0, item);
      return { ...node, data: { ...node.data, highlights: items } };
    })
  }), 'Highlight reordered');

  const deleteHighlight = async (highlightId) => {
    if (!window.confirm('Delete this highlight?')) return;
    await mutate((current, nodeId) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === nodeId
        ? { ...node, data: { ...node.data, highlights: (node.data?.highlights || []).filter((item) => item.id !== highlightId) } }
        : node)
    }), 'Highlight deleted');
  };

  const addNote = async (highlight) => {
    const note = window.prompt('Note for this highlight', highlight.note || '');
    if (note === null) return;
    await mutate((current, nodeId) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === nodeId ? {
        ...node,
        data: {
          ...node.data,
          highlights: (node.data?.highlights || []).map((item) => item.id === highlight.id
            ? { ...item, note: cleanText(note), updatedAt: Date.now() }
            : item)
        }
      } : node)
    }), note.trim() ? 'Note saved' : 'Note removed');
  };

  const promote = (highlight) => mutate((current, nodeId) => {
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
        sources: [{
          conversationId: highlight.conversationId || null,
          messageId: highlight.messageId || null,
          role: highlight.messageRole || 'assistant',
          preview: highlight.messagePreview || '',
          addedAt: Date.now()
        }].filter((source) => source.conversationId || source.messageId),
        highlights: [{ ...highlight }],
        createdFromHighlight: true,
        promotedFromNodeId: nodeId,
        promotedHighlightId: highlight.id
      }
    };
    return {
      ...current,
      nodes: [...current.nodes, promoted],
      edges: [...(current.edges || []), {
        id: makeId('edge'), source: nodeId, target: id, type: 'smoothstep', label: 'deepens',
        data: {
          relation: 'deepens',
          createdFromHighlight: true,
          sources: highlight.conversationId ? [{ conversationId: highlight.conversationId, messageId: highlight.messageId || null, addedAt: Date.now() }] : []
        }
      }],
      metadata: { ...(current.metadata || {}), selectedNodeId: id, focusNodeId: id }
    };
  }, 'Promoted to node');

  const demote = async () => {
    if (!selectedNode?.data?.createdFromHighlight || !promotedParentId) return;
    const ok = window.confirm(`Demote “${selectedNode.data?.title || 'this node'}” back to a highlight?`);
    if (!ok) return;
    await mutate((current, nodeId) => {
      const node = current.nodes.find((candidate) => candidate.id === nodeId);
      const parent = current.nodes.find((candidate) => candidate.id === promotedParentId);
      if (!node || !parent) return current;
      const sourceHighlight = (node.data?.highlights || [])[0] || null;
      const parentHighlights = Array.isArray(parent.data?.highlights) ? [...parent.data.highlights] : [];
      if (sourceHighlight) {
        const duplicate = parentHighlights.some((item) => item.id === sourceHighlight.id || (
          item?.messageId === sourceHighlight.messageId && cleanText(item?.quote) === cleanText(sourceHighlight.quote)
        ));
        if (!duplicate) parentHighlights.push(sourceHighlight);
      }
      return {
        ...current,
        nodes: current.nodes
          .filter((candidate) => candidate.id !== nodeId)
          .map((candidate) => candidate.id === promotedParentId
            ? { ...candidate, data: { ...candidate.data, highlights: parentHighlights } }
            : candidate),
        edges: (current.edges || []).filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
        metadata: {
          ...(current.metadata || {}),
          selectedNodeId: promotedParentId,
          focusNodeId: current.metadata?.focusNodeId === nodeId ? promotedParentId : current.metadata?.focusNodeId
        }
      };
    }, 'Demoted to highlight');
  };

  const panel = (
    <>
      <button type="button" onClick={() => setOpen((value) => !value)} style={managerButtonStyle(open)} title="Manage highlights" aria-label="Manage highlights">
        ★{highlights.length || ''}
      </button>

      {open ? (
        <div style={{
          position: 'absolute', right: 8, top: 38, zIndex: 160,
          width: 'min(310px, calc(100% - 16px))', maxHeight: 'calc(100% - 48px)', overflowY: 'auto',
          border: '1px solid #dbe3ee', borderRadius: 10, background: '#fff',
          boxShadow: '0 14px 32px rgba(15,23,42,.18)', padding: 8, fontFamily: FONT_STACK
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '1px 2px 7px' }}>
            <strong style={{ minWidth: 0, flex: 1, fontSize: 12, lineHeight: '16px', color: '#111827' }}>Highlights · {highlights.length}</strong>
            {selectedNode.data?.createdFromHighlight && promotedParentId ? (
              <button type="button" onClick={demote} style={{ ...actionStyle, border: '1px solid #dbe3ee', padding: '3px 6px' }}>↩ Highlight</button>
            ) : null}
            <button type="button" onClick={() => setOpen(false)} style={{ ...actionStyle, fontSize: 15, padding: '2px 5px' }}>×</button>
          </div>

          {!highlights.length ? (
            <div style={{ padding: '9px 4px', fontSize: 11.5, lineHeight: '17px', color: '#94a3b8' }}>No saved highlights.</div>
          ) : highlights.map((highlight, index) => {
            const itemOpen = openItemId === highlight.id;
            return (
              <div key={highlight.id || `${highlight.messageId}:${index}`} style={{ position: 'relative', borderTop: index ? '1px solid #eef2f7' : 0, padding: '8px 2px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await jumpToResearchHighlightSource(highlight, 5000);
                      setStatus(ok ? 'Exact source located · highlighted for 5s' : 'Exact source not found');
                    }}
                    style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', padding: 0, textAlign: 'left', fontFamily: FONT_STACK, cursor: 'pointer' }}
                    title="Jump to exact source sentence"
                  >
                    <span style={{ fontSize: 11.5, lineHeight: '17px', color: '#334155' }}>★ “{highlight.quote || ''}”</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpenItemId(itemOpen ? null : highlight.id)}
                    aria-label="Highlight actions"
                    style={{ width: 24, height: 22, border: '1px solid #e2e8f0', borderRadius: 6, background: itemOpen ? '#f1f5f9' : '#fff', color: '#64748b', cursor: 'pointer' }}
                  >⋯</button>
                </div>

                {highlight.note ? (
                  <div style={{ marginTop: 4, paddingLeft: 12, borderLeft: '2px solid #e2e8f0', fontSize: 10.8, lineHeight: '15px', color: '#64748b' }}>
                    {highlight.note}
                  </div>
                ) : null}

                {itemOpen ? (
                  <div style={{ marginTop: 6, border: '1px solid #e2e8f0', borderRadius: 8, background: '#f8fafc', padding: 4, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                    <button type="button" disabled={index === 0} onClick={() => reorder(highlight.id, -1)} style={{ ...actionStyle, opacity: index === 0 ? .4 : 1 }}>↑ Move up</button>
                    <button type="button" disabled={index === highlights.length - 1} onClick={() => reorder(highlight.id, 1)} style={{ ...actionStyle, opacity: index === highlights.length - 1 ? .4 : 1 }}>↓ Move down</button>
                    <button type="button" onClick={() => addNote(highlight)} style={actionStyle}>{highlight.note ? 'Edit note' : '+ Note'}</button>
                    <button type="button" onClick={() => promote(highlight)} style={actionStyle}>Promote → Node</button>
                    <select
                      defaultValue=""
                      onChange={(event) => {
                        if (event.target.value) moveHighlight(highlight.id, event.target.value);
                      }}
                      style={{ gridColumn: '1 / -1', width: '100%', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', padding: '5px 6px', fontFamily: FONT_STACK, fontSize: 11, color: '#475569' }}
                    >
                      <option value="">Move to another node…</option>
                      {(graph.nodes || []).filter((node) => node.id !== selectedNodeId).map((node) => (
                        <option key={node.id} value={node.id}>{node.data?.title || node.id}</option>
                      ))}
                    </select>
                    <button type="button" onClick={() => deleteHighlight(highlight.id)} style={{ ...actionStyle, gridColumn: '1 / -1', color: '#b91c1c' }}>Delete highlight</button>
                  </div>
                ) : null}
              </div>
            );
          })}

          {status ? (
            <div style={{ marginTop: 4, padding: '6px 3px 1px', borderTop: '1px solid #eef2f7', fontSize: 10.5, lineHeight: '15px', color: '#64748b' }}>{status}</div>
          ) : null}
        </div>
      ) : null}
    </>
  );

  return createPortal(panel, detailEl);
}
