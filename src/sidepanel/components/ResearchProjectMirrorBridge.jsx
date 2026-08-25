import { useEffect } from 'react';
import {
  conversationGraphKey,
  conversationProjectKey,
  projectGraphKey
} from '../../shared/researchScope';

function conversationIdFromUrl(url) {
  try {
    const parsed = new URL(url || '');
    if (parsed.hostname !== 'chatgpt.com' && parsed.hostname !== 'chat.openai.com') return null;
    return parsed.pathname.match(/\/c\/([a-zA-Z0-9-]+)/)?.[1] || null;
  } catch {
    return null;
  }
}

async function activeConversationId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return conversationIdFromUrl(tab?.url || '');
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function appendSource(list, source) {
  const items = Array.isArray(list) ? [...list] : [];
  const duplicate = items.some((item) => item?.conversationId === source.conversationId && item?.messageId === source.messageId);
  if (!duplicate) items.push(source);
  return items.slice(-40);
}

function reconcileMirrorMutation(canonical, local, conversationId) {
  if (!canonical) {
    return {
      ...local,
      nodes: (local.nodes || []).map((node) => ({
        ...node,
        data: {
          ...node.data,
          sources: appendSource(node.data?.sources, {
            conversationId,
            messageId: node.data?.messageId || null,
            addedAt: Date.now()
          }),
          highlights: (node.data?.highlights || []).map((highlight) => ({ ...highlight, conversationId: highlight.conversationId || conversationId }))
        }
      }))
    };
  }

  const canonicalNodes = new Map((canonical.nodes || []).map((node) => [node.id, node]));
  const nodes = (local.nodes || []).map((node) => {
    const before = canonicalNodes.get(node.id);
    if (!before) {
      return {
        ...node,
        data: {
          ...node.data,
          sources: appendSource(node.data?.sources, {
            conversationId,
            messageId: node.data?.messageId || null,
            addedAt: Date.now()
          }),
          highlights: (node.data?.highlights || []).map((highlight) => ({ ...highlight, conversationId: highlight.conversationId || conversationId }))
        }
      };
    }

    const beforeHighlights = new Map((before.data?.highlights || []).map((item) => [item.id || `${item.messageId}:${cleanText(item.quote)}`, item]));
    const highlights = (node.data?.highlights || []).map((highlight) => {
      const key = highlight.id || `${highlight.messageId}:${cleanText(highlight.quote)}`;
      const existed = beforeHighlights.has(key);
      return existed ? highlight : { ...highlight, conversationId: highlight.conversationId || conversationId };
    });

    return {
      ...node,
      data: {
        ...node.data,
        sources: before.data?.sources || node.data?.sources || [],
        highlights
      }
    };
  });

  const canonicalEdges = new Map((canonical.edges || []).map((edge) => [edge.id, edge]));
  const edges = (local.edges || []).map((edge) => {
    const before = canonicalEdges.get(edge.id);
    if (before) return { ...edge, data: { ...edge.data, sources: before.data?.sources || edge.data?.sources || [] } };
    return {
      ...edge,
      data: {
        ...edge.data,
        sources: appendSource(edge.data?.sources, { conversationId, messageId: null, addedAt: Date.now() })
      }
    };
  });

  return { ...local, nodes, edges };
}

function mirrorFromCanonical(canonical, conversationId, projectId, mirroredAt) {
  return {
    ...canonical,
    conversationId,
    projectId,
    metadata: {
      ...(canonical.metadata || {}),
      projectId,
      researchScope: 'project',
      projectMirrorOf: projectId,
      projectMirrorAt: mirroredAt
    },
    // Mirror and canonical share one version clock. projectMirrorAt records when
    // this local copy was refreshed without making it look like a new mutation.
    updatedAt: Number(canonical.updatedAt || 0) || mirroredAt
  };
}

/**
 * Compatibility bridge for the selection content script.
 *
 * - canonical newer -> refresh this chat's mirror before it can write stale data
 * - mirror newer -> reconcile only local/new material into canonical
 *
 * This gives the project graph one canonical clock while preserving the legacy
 * per-chat key used by the page content script.
 */
export default function ResearchProjectMirrorBridge() {
  useEffect(() => {
    let cancelled = false;
    let busy = false;
    let timer = null;

    const sync = async () => {
      if (cancelled || busy) return;
      busy = true;
      try {
        const conversationId = await activeConversationId();
        if (!conversationId) return;
        const mappingKey = conversationProjectKey(conversationId);
        const mapping = await chrome.storage.local.get([mappingKey]);
        const projectId = mapping?.[mappingKey] || null;
        if (!projectId) return;

        const localKey = conversationGraphKey(conversationId);
        const canonicalKey = projectGraphKey(projectId);
        const records = await chrome.storage.local.get([localKey, canonicalKey]);
        const local = records?.[localKey] || null;
        const canonical = records?.[canonicalKey] || null;
        if (!canonical || !Array.isArray(canonical.nodes)) return;

        const localUpdated = Number(local?.updatedAt || 0);
        const canonicalUpdated = Number(canonical.updatedAt || 0);

        if (!local || canonicalUpdated > localUpdated) {
          await chrome.storage.local.set({
            [localKey]: mirrorFromCanonical(canonical, conversationId, projectId, Date.now())
          });
          return;
        }

        if (localUpdated <= canonicalUpdated) return;

        const reconciled = reconcileMirrorMutation(canonical, local, conversationId);
        const now = Date.now();
        const canonicalPayload = {
          ...reconciled,
          conversationId: null,
          projectId,
          metadata: {
            ...(reconciled.metadata || {}),
            projectId,
            researchScope: 'project',
            projectMirrorOf: null,
            mirroredFromConversationId: conversationId,
            mirroredFromConversationAt: now
          },
          updatedAt: now
        };
        await chrome.storage.local.set({
          [canonicalKey]: canonicalPayload,
          [localKey]: mirrorFromCanonical(canonicalPayload, conversationId, projectId, now)
        });
      } catch (error) {
        console.debug('[ResearchProjectMirror] sync failed:', error?.message || error);
      } finally {
        busy = false;
      }
    };

    void sync();
    timer = window.setInterval(() => { void sync(); }, 600);
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, []);

  return null;
}
