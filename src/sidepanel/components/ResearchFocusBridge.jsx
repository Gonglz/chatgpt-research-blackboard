import React, { useEffect, useRef } from 'react';
import { loadScopedGraphRecord } from '../../shared/researchScope';

const PREF_KEY = 'researchFocusVisual:enabled';
const GRAPH_PREFIXES = ['researchBlackboard:', 'researchProjectGraph:', 'researchConversationProject:'];
const STYLE_ID = 'research-focus-visual-style';
const BUTTON_ID = 'research-focus-visual-toggle';
const APPLY_DELAY_MS = 70;

function conversationIdFromUrl(url) {
  return String(url || '').match(/\/c\/([a-zA-Z0-9-]+)/)?.[1] || null;
}

async function activeConversationId() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return conversationIdFromUrl(tab?.url || '');
  } catch {
    return null;
  }
}

function relationOf(edge) {
  return String(edge?.data?.relation || edge?.label || 'informs').trim().toLowerCase();
}

function ensureStyle() {
  let style = document.getElementById(STYLE_ID);
  if (style) return style;
  style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .react-flow__node[data-rb-focus-role] {
      transition: opacity 150ms ease, filter 150ms ease;
    }
    .react-flow__node[data-rb-focus-role="background"] {
      opacity: .58 !important;
    }
    .react-flow__node[data-rb-focus-role="near"] {
      opacity: .88 !important;
    }
    .react-flow__node[data-rb-focus-role="path"],
    .react-flow__node[data-rb-focus-role="focus"],
    .react-flow__node.selected {
      opacity: 1 !important;
    }
    .react-flow__node[data-rb-focus-role="focus"] {
      z-index: 16 !important;
      filter: drop-shadow(0 5px 10px rgba(15,23,42,.14));
    }
    .react-flow__node[data-rb-focus-role="focus"] > div {
      outline: 2px solid rgba(37,99,235,.44) !important;
      outline-offset: 3px !important;
    }
    .react-flow__node[data-rb-focus-role="focus"]::after {
      content: '◎';
      position: absolute;
      right: -10px;
      top: -12px;
      width: 19px;
      height: 19px;
      display: grid;
      place-items: center;
      border-radius: 999px;
      background: #fff;
      color: #2563eb;
      border: 1px solid rgba(37,99,235,.35);
      box-shadow: 0 2px 7px rgba(15,23,42,.12);
      font: 700 12px/1 ui-sans-serif, system-ui, sans-serif;
      pointer-events: none;
    }
    .react-flow__edge[data-rb-focus-edge="path"] path {
      stroke: #475569 !important;
      stroke-width: 2px !important;
      opacity: .92 !important;
    }
  `;
  document.head.appendChild(style);
  return style;
}

function clearFocusAttributes() {
  document.querySelectorAll('.react-flow__node[data-rb-focus-role]').forEach((element) => {
    element.removeAttribute('data-rb-focus-role');
  });
  document.querySelectorAll('.react-flow__edge[data-rb-focus-edge]').forEach((element) => {
    element.removeAttribute('data-rb-focus-edge');
  });
}

function fallbackParentMap(nodes = [], edges = []) {
  const ids = new Set(nodes.map((node) => String(node.id)));
  const parent = {};
  const deepens = edges
    .filter((edge) => relationOf(edge) === 'deepens')
    .filter((edge) => ids.has(String(edge.source)) && ids.has(String(edge.target)))
    .slice()
    .sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
  for (const edge of deepens) {
    const childId = String(edge.source);
    if (!parent[childId]) parent[childId] = String(edge.target);
  }
  return parent;
}

function focusSets(graph, focusNodeId) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const nodeIds = new Set(nodes.map((node) => String(node.id)));
  const focusId = String(focusNodeId || '');
  if (!focusId || !nodeIds.has(focusId)) return null;

  const cachedParent = graph?.metadata?.layoutState?.backboneParentByNodeId || {};
  const parentByNodeId = Object.keys(cachedParent).length
    ? cachedParent
    : fallbackParentMap(nodes, edges);

  const path = new Set([focusId]);
  const seen = new Set([focusId]);
  let cursor = focusId;
  while (parentByNodeId[cursor] && !seen.has(String(parentByNodeId[cursor]))) {
    const parentId = String(parentByNodeId[cursor]);
    if (!nodeIds.has(parentId)) break;
    path.add(parentId);
    seen.add(parentId);
    cursor = parentId;
  }

  const near = new Set();
  for (const [childId, parentId] of Object.entries(parentByNodeId)) {
    if (String(parentId) === focusId && childId !== focusId) near.add(String(childId));
  }
  for (const edge of edges) {
    if (relationOf(edge) === 'deepens') continue;
    if (String(edge.source) === focusId) near.add(String(edge.target));
    if (String(edge.target) === focusId) near.add(String(edge.source));
  }
  path.forEach((id) => near.delete(id));

  const pathEdgeIds = new Set();
  for (const childId of path) {
    if (childId === cursor) continue;
    const parentId = parentByNodeId[childId];
    if (!parentId || !path.has(String(parentId))) continue;
    const match = edges.find((edge) => (
      relationOf(edge) === 'deepens'
      && String(edge.source) === String(childId)
      && String(edge.target) === String(parentId)
    ));
    if (match?.id) pathEdgeIds.add(String(match.id));
  }

  return { focusId, path, near, pathEdgeIds };
}

function applyNodeRoles(sets) {
  const nodeElements = document.querySelectorAll('.react-flow__node[data-id]');
  nodeElements.forEach((element) => {
    const id = String(element.getAttribute('data-id') || '');
    let role = 'background';
    if (id === sets.focusId) role = 'focus';
    else if (sets.path.has(id)) role = 'path';
    else if (sets.near.has(id)) role = 'near';
    element.setAttribute('data-rb-focus-role', role);
  });

  document.querySelectorAll('.react-flow__edge').forEach((element) => {
    const testId = String(element.getAttribute('data-testid') || '');
    const edgeId = testId.startsWith('rf__edge-') ? testId.slice('rf__edge-'.length) : '';
    if (edgeId && sets.pathEdgeIds.has(edgeId)) element.setAttribute('data-rb-focus-edge', 'path');
    else element.removeAttribute('data-rb-focus-edge');
  });
}

function ensureToggleButton(onToggle) {
  let button = document.getElementById(BUTTON_ID);
  if (button) return button;

  button = document.createElement('button');
  button.id = BUTTON_ID;
  button.type = 'button';
  button.addEventListener('click', onToggle);
  Object.assign(button.style, {
    position: 'fixed',
    zIndex: '39',
    width: '30px',
    height: '30px',
    borderRadius: '8px',
    border: '1px solid #dbe3ee',
    background: 'rgba(255,255,255,.94)',
    color: '#475569',
    boxShadow: '0 4px 12px rgba(15,23,42,.08)',
    font: '700 14px/28px ui-sans-serif, system-ui, sans-serif',
    textAlign: 'center',
    padding: '0',
    cursor: 'pointer',
    backdropFilter: 'blur(8px)'
  });
  document.body.appendChild(button);
  return button;
}

function positionToggle(button, visible) {
  if (!visible) {
    button.style.display = 'none';
    return;
  }
  const tools = document.querySelector('[aria-label="Research canvas tools"]');
  const canvas = tools?.parentElement;
  const rect = canvas?.getBoundingClientRect?.();
  if (!rect) {
    button.style.display = 'none';
    return;
  }
  button.style.display = 'block';
  button.style.top = `${Math.max(8, rect.top + 10)}px`;
  button.style.right = `${Math.max(10, window.innerWidth - rect.right + 10)}px`;
}

export default function ResearchFocusBridge() {
  const timerRef = useRef(null);
  const enabledRef = useRef(true);
  const focusPresentRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    let observer = null;
    let interval = null;

    ensureStyle();

    const toggle = async () => {
      enabledRef.current = !enabledRef.current;
      try { await chrome.storage.local.set({ [PREF_KEY]: enabledRef.current }); } catch { /* ignore */ }
      schedule();
    };
    const button = ensureToggleButton(toggle);

    const updateButton = () => {
      const researchVisible = !!document.querySelector('[aria-label="Research canvas tools"]');
      positionToggle(button, researchVisible);
      button.textContent = enabledRef.current ? '◎' : '○';
      button.style.color = enabledRef.current ? '#2563eb' : '#94a3b8';
      button.style.opacity = focusPresentRef.current || !enabledRef.current ? '1' : '.62';
      button.title = enabledRef.current
        ? (focusPresentRef.current ? 'Focus emphasis on — click to disable' : 'Focus emphasis on — no active focus yet')
        : 'Focus emphasis off — click to enable';
      button.setAttribute('aria-label', button.title);
    };

    const apply = async () => {
      if (disposed) return;
      clearFocusAttributes();
      try {
        const pref = await chrome.storage.local.get([PREF_KEY]);
        enabledRef.current = pref?.[PREF_KEY] !== false;
      } catch {
        enabledRef.current = true;
      }

      if (!enabledRef.current) {
        focusPresentRef.current = false;
        updateButton();
        return;
      }

      const conversationId = await activeConversationId();
      if (!conversationId) {
        focusPresentRef.current = false;
        updateButton();
        return;
      }

      const { graph } = await loadScopedGraphRecord(conversationId);
      const focusNodeId = graph?.metadata?.focusNodeId || graph?.focusNodeId || null;
      const sets = focusSets(graph, focusNodeId);
      focusPresentRef.current = !!sets;
      if (sets && document.querySelector('[aria-label="Research canvas tools"]')) applyNodeRoles(sets);
      updateButton();
    };

    const schedule = () => {
      if (disposed) return;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void apply();
      }, APPLY_DELAY_MS);
    };

    const onStorageChanged = (changes, area) => {
      if (area !== 'local') return;
      if (changes?.[PREF_KEY]
        || Object.keys(changes || {}).some((key) => GRAPH_PREFIXES.some((prefix) => key.startsWith(prefix)))) {
        schedule();
      }
    };

    chrome.storage.onChanged.addListener(onStorageChanged);
    observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    interval = window.setInterval(schedule, 1400);
    schedule();

    return () => {
      disposed = true;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (interval) window.clearInterval(interval);
      observer?.disconnect();
      chrome.storage.onChanged.removeListener(onStorageChanged);
      window.removeEventListener('resize', schedule);
      clearFocusAttributes();
      const existingButton = document.getElementById(BUTTON_ID);
      if (existingButton) existingButton.remove();
      const style = document.getElementById(STYLE_ID);
      if (style) style.remove();
    };
  }, []);

  return null;
}
