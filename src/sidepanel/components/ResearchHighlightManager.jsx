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

function findHighlightCards(detail) {
  if (!detail) return [];
  const sourceButtons = Array.from(detail.querySelectorAll('button')).filter((button) => cleanText(button.textContent) === '↗ Source');
  const cards = [];
  for (const button of sourceButtons) {
    const card = button.parentElement;
    if (!card) continue;
    const text = cleanText(card.textContent);
    if (!text.startsWith('★')) continue;
    if (!cards.includes(card)) cards.push(card);
  }
  return cards;
}

function findEditActionRow(detail) {
  if (!detail) return null;
  const edit = Array.from(detail.querySelectorAll('button')).find((button) => {
    const text = cleanText(button.textContent);
    return text === 'Edit' || text === 'Done';
  });
  return edit?.parentElement || null;
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

function ItemActions({
  highlight,
  index,
  total,
  nodes,
  selectedNodeId,
  open,
  setOpen,
  reorder,
  addNote,
  promote,
  moveHighlight,
  deleteHighlight
}) {
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(open ? null : highlight.id)}
        aria-label="Highlight actions"
        title="Highlight actions"
        style={{
          position: 'absolute',
          right: 7,
          top: 7,
          zIndex: 5,
          width: 25,
          height: 23,
          border: '1px solid #dbe3ee',
          borderRadius: 6,
          background: open ? '#eef2f7' : '#fff',
          color: '#64748b',
          fontFamily: FONT_STACK,
          cursor: 'pointer'
        }}
      >⋯</button>

      {open ? (
        <div style={{
          position: 'absolute',
          right: 7,
          top: 34,
          zIndex: 12,
          width: 'min(235px, calc(100% - 14px))',
          border: '1px solid #dbe3ee',
          borderRadius: 8,
          background: '#fff',
          boxShadow: '0 10px 24px rgba(15,23,42,.14)',
          padding: 4,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 2,
          fontFamily: FONT_STACK
        }}>
          <button type="button" disabled={index === 0} onClick={() => reorder(highlight.id, -1)} style={{ ...actionStyle, opacity: index === 0 ? .4 : 1 }}>↑ Move up</button>
          <button type="button" disabled={index === total - 1} onClick={() => reorder(highlight.id, 1)} style={{ ...actionStyle, opacity: index === total - 1 ? .4 : 1 }}>↓ Move down</button>
          <button type="button" onClick={() => addNote(highlight)} style={actionStyle}>{highlight.note ? 'Edit note' : '+ Note'}</button>
          <button type="button" onClick={() => promote(highlight)} style={actionStyle}>Promote → Node</button>
          <select
            defaultValue=""
            onChange={(event) => {
              if (event.target.value) moveHighlight(highlight.id, event.target.value);
            }}
            style={{
              gridColumn: '1 / -1',
              width: '100%',
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              background: '#fff',
              padding: '5px 6px',
              fontFamily: FONT_STACK,
              fontSize: 11,
              color: '#475569'
            }}
          >
            <option value="">Move to another node…</option>
            {nodes.filter((node) => node.id !== selectedNodeId).map((node) => (
              <option key={node.id} value={node.id}>{node.data?.title || node.id}</option>
            ))}
          </select>
          <button type="button" onClick={() => deleteHighlight(highlight.id)} style={{ ...actionStyle, gridColumn: '1 / -1', color: '#b91c1c' }}>Delete highlight</button>
        </div>
      ) : null}
    </>
  );
}

export default function ResearchHighlightManager({ enabled = true }) {
  const [detailEl, setDetailEl] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [graph, setGraph] = useState(null);
  const [cardEls, setCardEls] = useState([]);
  const [editRowEl, setEditRowEl] = useState(null);
  const [openItemId, setOpenItemId] = useState(null);
  const [status, setStatus] = useState('');
  const highlightsRef = useRef([]);
  const refreshTimer = useRef(null);

  const refresh = async () => {
    if (!enabled) return;
    const detail = document.querySelector('section[aria-label="Research node detail"]');
    const selectedId = currentSelectedNodeId();
    setDetailEl(detail || null);
    setSelectedNodeId(selectedId || null);

    if (!detail || !selectedId) {
      setGraph(null);
      setCardEls([]);
      setEditRowEl(null);
      setOpenItemId(null);
      return;
    }

    const loaded = await loadGraph();
    setGraph(loaded.graph || null);
    const cards = findHighlightCards(detail);
    for (const card of cards) {
      card.style.position = 'relative';
      card.style.paddingRight = '38px';
    }
    setCardEls(cards);
    setEditRowEl(findEditActionRow(detail));
  };

  useEffect(() => {
    if (!enabled) return undefined;
    void refresh();
    refreshTimer.current = window.setInterval(() => { void refresh(); }, 350);
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

  const selectedNode = useMemo(
    () => graph?.nodes?.find((node) => node.id === selectedNodeId) || null,
    [graph, selectedNodeId]
  );
  const highlights = Array.isArray(selectedNode?.data?.highlights) ? selectedNode.data.highlights : [];
  highlightsRef.current = highlights;

  const promotedParentId = selectedNode?.data?.promotedFromNodeId
    || graph?.edges?.find((edge) => edge.target === selectedNodeId && edge.data?.createdFromHighlight)?.source
    || null;

  useEffect(() => {
    if (!detailEl) return undefined;

    const handleSourceClick = (event) => {
      const button = event.target?.closest?.('button');
      if (!button || cleanText(button.textContent) !== '↗ Source') return;
      const card = button.parentElement;
      const cards = findHighlightCards(detailEl);
      const index = cards.indexOf(card);
      const highlight = highlightsRef.current[index];
      if (!highlight) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      void jumpToResearchHighlightSource(highlight, 5000).then((ok) => {
        setStatus(ok ? 'Exact source located · highlighted for 5s' : 'Exact source not found');
      });
    };

    detailEl.addEventListener('click', handleSourceClick, true);
    return () => detailEl.removeEventListener('click', handleSourceClick, true);
  }, [detailEl]);

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
          if (node.id === sourceNodeId) {
            return { ...node, data: { ...node.data, highlights: sourceHighlights.filter((highlight) => highlight.id !== highlightId) } };
          }
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
        id: makeId('edge'),
        source: nodeId,
        target: id,
        type: 'smoothstep',
        label: 'deepens',
        data: {
          relation: 'deepens',
          createdFromHighlight: true,
          sources: highlight.conversationId
            ? [{ conversationId: highlight.conversationId, messageId: highlight.messageId || null, addedAt: Date.now() }]
            : []
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

  const portals = cardEls.slice(0, highlights.length).map((card, index) => {
    const highlight = highlights[index];
    if (!card || !highlight) return null;
    return createPortal(
      <ItemActions
        key={highlight.id || index}
        highlight={highlight}
        index={index}
        total={highlights.length}
        nodes={graph.nodes || []}
        selectedNodeId={selectedNodeId}
        open={openItemId === highlight.id}
        setOpen={setOpenItemId}
        reorder={reorder}
        addNote={addNote}
        promote={promote}
        moveHighlight={moveHighlight}
        deleteHighlight={deleteHighlight}
      />,
      card
    );
  });

  if (selectedNode.data?.createdFromHighlight && promotedParentId && editRowEl) {
    portals.push(createPortal(
      <button
        key="demote-highlight"
        type="button"
        onClick={demote}
        style={{
          border: '1px solid #dbe3ee',
          borderRadius: 6,
          background: '#fff',
          padding: '4px 7px',
          fontFamily: FONT_STACK,
          fontSize: 11,
          color: '#475569',
          cursor: 'pointer'
        }}
      >↩ Highlight</button>,
      editRowEl
    ));
  }

  if (status) {
    portals.push(createPortal(
      <div key="highlight-status" style={{ position: 'absolute', right: 8, bottom: 8, zIndex: 40, padding: '5px 7px', borderRadius: 7, background: 'rgba(255,255,255,.96)', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(15,23,42,.08)', fontFamily: FONT_STACK, fontSize: 10.5, color: '#64748b', pointerEvents: 'none' }}>
        {status}
      </div>,
      detailEl
    ));
  }

  return <>{portals}</>;
}
