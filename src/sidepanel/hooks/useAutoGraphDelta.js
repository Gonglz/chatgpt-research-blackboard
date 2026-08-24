import { useEffect, useMemo, useRef, useState } from 'react';
import { loadResearchGraph, saveResearchGraph } from '../utils/researchStore';
import {
  applyGraphDelta,
  extractGraphDeltaBlocks,
  parseGraphDelta,
  stripGraphDeltaBlocks
} from '../utils/graphDelta';

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeRole(value) {
  return cleanText(value).toLowerCase();
}

function buildOrderedMessages(conversationData) {
  const raw = (Array.isArray(conversationData?.nodes) ? conversationData.nodes : [])
    .filter((node) => node?.id && cleanText(node?.content))
    .slice()
    .sort((a, b) => (a.createTime || 0) - (b.createTime || 0));

  const roleCounts = new Map();
  return raw.map((node, messageIndex) => {
    const role = normalizeRole(node.role || 'message') || 'message';
    const roleIndex = roleCounts.get(role) || 0;
    roleCounts.set(role, roleIndex + 1);
    const content = String(node.content || '');
    const visibleContent = stripGraphDeltaBlocks(content);
    const cleanVisible = cleanText(visibleContent);

    return {
      id: node.id,
      role,
      content,
      visibleContent,
      cleanVisible,
      createTime: node.createTime || 0,
      messageIndex,
      roleIndex,
      textLength: cleanVisible.length
    };
  });
}

function isAssistantRole(role) {
  return role === 'assistant' || role === 'tool' || role === 'model';
}

/**
 * Watches conversation data for assistant messages containing RGΔ blocks.
 * Each source message is applied at most once and recorded in graph metadata.
 */
export function useAutoGraphDelta(conversationData) {
  const [revision, setRevision] = useState(0);
  const [lastResult, setLastResult] = useState(null);
  const runTokenRef = useRef(0);

  const orderedMessages = useMemo(
    () => buildOrderedMessages(conversationData),
    [conversationData]
  );

  const deltaMessages = useMemo(
    () => orderedMessages.filter((message) => (
      isAssistantRole(message.role) && extractGraphDeltaBlocks(message.content).length > 0
    )),
    [orderedMessages]
  );

  const signature = useMemo(
    () => deltaMessages.map((message) => message.id).join('|'),
    [deltaMessages]
  );

  useEffect(() => {
    const conversationId = conversationData?.id;
    if (!conversationId || !deltaMessages.length) return undefined;

    const runToken = ++runTokenRef.current;
    let cancelled = false;

    (async () => {
      const graph = await loadResearchGraph(conversationId);
      if (cancelled || runToken !== runTokenRef.current) return;

      const applied = new Set(graph.metadata?.appliedDeltaMessageIds || []);
      let state = {
        nodes: graph.nodes || [],
        edges: graph.edges || [],
        focusNodeId: graph.metadata?.focusNodeId || null
      };
      const appliedNow = [];
      const errors = [];
      const changes = [];

      for (const message of deltaMessages) {
        if (applied.has(message.id)) continue;

        const blocks = extractGraphDeltaBlocks(message.content);
        let messageApplied = false;

        for (const block of blocks) {
          const parsed = parseGraphDelta(block);
          if (parsed.errors?.length) {
            errors.push(...parsed.errors.map((error) => `${message.id.slice(0, 8)}: ${error}`));
          }
          if (!parsed.operations?.length) continue;

          const context = {
            messageId: message.id,
            role: message.role,
            preview: message.cleanVisible.slice(0, 220),
            tail: message.cleanVisible.slice(-180),
            textLength: message.textLength,
            messageIndex: message.messageIndex,
            roleIndex: message.roleIndex
          };

          const next = applyGraphDelta(state, parsed, context);
          state = {
            nodes: next.nodes,
            edges: next.edges,
            focusNodeId: next.focusNodeId
          };
          changes.push(...next.changes);
          messageApplied = true;
        }

        if (messageApplied) {
          applied.add(message.id);
          appliedNow.push(message.id);
        }
      }

      if (!appliedNow.length) {
        if (errors.length) setLastResult({ applied: 0, changes: [], errors });
        return;
      }

      await saveResearchGraph(
        conversationId,
        state.nodes,
        state.edges,
        {
          appliedDeltaMessageIds: Array.from(applied).slice(-500),
          focusNodeId: state.focusNodeId,
          lastDeltaAt: Date.now()
        }
      );

      if (cancelled || runToken !== runTokenRef.current) return;

      setLastResult({
        applied: appliedNow.length,
        changes,
        errors,
        focusNodeId: state.focusNodeId
      });
      setRevision((value) => value + 1);
      console.log('[ResearchBlackboard] Applied RGΔ:', {
        messages: appliedNow.length,
        changes,
        errors
      });
    })().catch((error) => {
      console.error('[ResearchBlackboard] RGΔ auto-apply failed:', error);
      if (!cancelled) setLastResult({ applied: 0, changes: [], errors: [error?.message || String(error)] });
    });

    return () => {
      cancelled = true;
    };
  }, [conversationData?.id, signature]);

  return { revision, lastResult };
}
