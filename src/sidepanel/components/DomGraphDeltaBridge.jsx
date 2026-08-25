import { useEffect } from 'react';
import { loadResearchGraph, saveResearchGraph } from '../utils/researchStore';
import { applyGraphDelta, parseGraphDelta } from '../utils/graphDelta';

const DOM_PROCESSOR_VERSION = 2;
const POLL_MS = 900;

function conversationIdFromUrl(url) {
  try {
    const parsed = new URL(url || '');
    if (parsed.hostname !== 'chatgpt.com' && parsed.hostname !== 'chat.openai.com') return null;
    return parsed.pathname.match(/\/c\/([a-zA-Z0-9-]+)/)?.[1] || null;
  } catch {
    return null;
  }
}

function hashText(value) {
  const text = String(value || '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function semanticIdOf(node) {
  if (node?.data?.semanticId) return String(node.data.semanticId);
  if (String(node?.id || '').startsWith('rg_')) return String(node.id).slice(3);
  return null;
}

function appendSource(list, source) {
  const items = Array.isArray(list) ? [...list] : [];
  const duplicate = items.some((item) => item?.conversationId === source.conversationId && item?.messageId === source.messageId);
  if (!duplicate) items.push(source);
  return items.slice(-40);
}

function stampDeltaProvenance(next, parsed, context) {
  const source = {
    conversationId: context.conversationId,
    messageId: context.messageId,
    role: context.role || 'assistant',
    preview: context.preview || '',
    addedAt: Date.now()
  };

  const touchedNodeSemanticIds = new Set();
  const touchedEdges = [];
  for (const operation of parsed.operations || []) {
    if (operation.op === 'addNode' || operation.op === 'updateNode') touchedNodeSemanticIds.add(operation.semanticId);
    if (operation.op === 'addEdge') touchedEdges.push(operation);
  }

  const nodes = (next.nodes || []).map((node) => {
    if (!touchedNodeSemanticIds.has(semanticIdOf(node))) return node;
    return { ...node, data: { ...node.data, sources: appendSource(node.data?.sources, source) } };
  });
  const bySemantic = new Map(nodes.map((node) => [semanticIdOf(node), node]).filter(([id]) => id));

  const edges = (next.edges || []).map((edge) => {
    const match = touchedEdges.some((operation) => {
      const sourceNode = bySemantic.get(operation.from);
      const targetNode = bySemantic.get(operation.to);
      return sourceNode?.id === edge.source
        && targetNode?.id === edge.target
        && (edge.data?.relation || edge.label || 'informs') === operation.relation;
    });
    if (!match) return edge;
    return { ...edge, data: { ...edge.data, sources: appendSource(edge.data?.sources, source) } };
  });

  return { ...next, nodes, edges };
}

async function getActiveChatTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;
    const conversationId = conversationIdFromUrl(tab.url || '');
    if (!conversationId) return null;
    return { tabId: tab.id, conversationId };
  } catch {
    return null;
  }
}

/** Read completed fenced RGΔ blocks directly from the rendered ChatGPT DOM. */
async function readDomDeltas(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const raw = Array.from(document.querySelectorAll('section[data-turn-id], article'));
        const containers = [];
        const seenContainers = new Set();

        for (const element of raw) {
          const canonical = element.matches?.('section[data-turn-id]') ? element : (element.closest?.('section[data-turn-id]') || element);
          if (!canonical || seenContainers.has(canonical)) continue;
          seenContainers.add(canonical);
          containers.push(canonical);
        }

        const roleCounters = new Map();
        const deltas = [];
        containers.forEach((container, messageIndex) => {
          const roleNode = container.matches?.('[data-message-author-role]') ? container : container.querySelector?.('[data-message-author-role]');
          const role = normalize(roleNode?.getAttribute?.('data-message-author-role') || '').toLowerCase();
          const roleIndex = roleCounters.get(role) || 0;
          roleCounters.set(role, roleIndex + 1);
          if (role !== 'assistant' && role !== 'tool' && role !== 'model') return;

          const messageId = normalize(
            container.getAttribute?.('data-turn-id')
              || roleNode?.getAttribute?.('data-message-id')
              || container.querySelector?.('[data-message-id]')?.getAttribute?.('data-message-id')
              || `dom-assistant-${roleIndex}`
          );

          const blocks = [];
          const seenText = new Set();
          for (const candidate of Array.from(container.querySelectorAll('pre code, pre'))) {
            const text = String(candidate.textContent || '').trim();
            if (!text.startsWith('RGΔ') || seenText.has(text)) continue;
            seenText.add(text);
            blocks.push(text);
          }
          if (!blocks.length) return;

          let visibleText = String(container.innerText || container.textContent || '');
          for (const block of blocks) visibleText = visibleText.replace(block, ' ');
          visibleText = normalize(visibleText);

          blocks.forEach((block) => deltas.push({
            messageId, role, messageIndex, roleIndex, block,
            preview: visibleText.slice(0, 220),
            tail: visibleText.slice(-180),
            textLength: visibleText.length
          }));
        });

        const streaming = !!(
          document.querySelector('[data-testid="stop-button"]')
          || document.querySelector('button[aria-label*="Stop"]')
          || document.querySelector('button[aria-label*="停止"]')
        );
        return { streaming, deltas };
      }
    });
    return results?.[0]?.result || { streaming: false, deltas: [] };
  } catch (error) {
    console.debug('[ResearchDOM] DOM delta scan unavailable:', error?.message || error);
    return { streaming: false, deltas: [] };
  }
}

export default function DomGraphDeltaBridge() {
  useEffect(() => {
    let cancelled = false;
    let busy = false;
    let timer = null;

    const tick = async () => {
      if (cancelled || busy) return;
      busy = true;
      try {
        const active = await getActiveChatTab();
        if (!active) return;
        const dom = await readDomDeltas(active.tabId);
        if (!dom?.deltas?.length || dom.streaming) return;

        const graph = await loadResearchGraph(active.conversationId);
        const applied = new Set(graph.metadata?.appliedDomDeltaKeys || []);
        let state = { nodes: graph.nodes || [], edges: graph.edges || [], focusNodeId: graph.metadata?.focusNodeId || null };
        const appliedNow = [];
        const errors = [];
        const changes = [];

        for (const item of dom.deltas) {
          const deltaKey = `${item.messageId}:${hashText(item.block)}`;
          if (applied.has(deltaKey)) continue;
          const parsed = parseGraphDelta(item.block);
          if (parsed.errors?.length) errors.push(...parsed.errors.map((error) => `${item.messageId.slice(0, 8)}: ${error}`));
          if (!parsed.operations?.length) continue;

          const context = {
            conversationId: active.conversationId,
            messageId: item.messageId,
            role: item.role,
            preview: item.preview,
            tail: item.tail,
            textLength: item.textLength,
            messageIndex: item.messageIndex,
            roleIndex: item.roleIndex
          };
          const rawNext = applyGraphDelta(state, parsed, context);
          const next = stampDeltaProvenance(rawNext, parsed, context);
          state = { nodes: next.nodes, edges: next.edges, focusNodeId: next.focusNodeId };
          changes.push(...next.changes);
          applied.add(deltaKey);
          appliedNow.push(deltaKey);
        }

        if (!appliedNow.length) {
          if (errors.length) console.warn('[ResearchDOM] RGΔ parse errors:', errors);
          return;
        }

        const nextRevision = Number(graph.metadata?.deltaRevision || 0) + appliedNow.length;
        await saveResearchGraph(active.conversationId, state.nodes, state.edges, {
          domDeltaProcessorVersion: DOM_PROCESSOR_VERSION,
          appliedDomDeltaKeys: Array.from(applied).slice(-500),
          focusNodeId: state.focusNodeId,
          deltaRevision: nextRevision,
          lastDeltaAt: Date.now(),
          lastDeltaSource: 'dom',
          lastDeltaConversationId: active.conversationId
        });

        console.log('[ResearchDOM] Applied RGΔ directly from DOM:', { blocks: appliedNow.length, revision: nextRevision, changes, errors });
      } catch (error) {
        console.warn('[ResearchDOM] Apply failed:', error?.message || error);
      } finally {
        busy = false;
      }
    };

    void tick();
    timer = window.setInterval(() => { void tick(); }, POLL_MS);
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, []);

  return null;
}
