import { useEffect } from 'react';
import {
  conversationGraphKey,
  conversationProjectKey,
  projectGraphKey
} from '../../shared/researchScope';
import { decorateGraphWithConversation } from '../utils/researchProjectStore';

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

/**
 * Compatibility bridge for content scripts that still write the per-chat key.
 * Project graph remains canonical. The bridge copies a newer selection/manual
 * mutation from the conversation mirror back into its canonical project graph.
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
        const local = records?.[localKey];
        const canonical = records?.[canonicalKey];
        if (!local || !Array.isArray(local.nodes)) return;

        const localUpdated = Number(local.updatedAt || 0);
        const canonicalUpdated = Number(canonical?.updatedAt || 0);
        const selectionAt = Number(local.metadata?.lastSelectionAt || 0);
        const canonicalSelectionAt = Number(canonical?.metadata?.lastSelectionAt || 0);

        // Only content-script/manual mutations should flow mirror -> canonical.
        // Canonical AI delta writes already mirror in the opposite direction.
        if (localUpdated <= canonicalUpdated && selectionAt <= canonicalSelectionAt) return;

        const decorated = decorateGraphWithConversation(local, conversationId);
        const now = Date.now();
        await chrome.storage.local.set({
          [canonicalKey]: {
            ...decorated,
            conversationId: null,
            projectId,
            metadata: {
              ...(decorated.metadata || {}),
              projectId,
              researchScope: 'project',
              projectMirrorOf: null,
              mirroredFromConversationId: conversationId,
              mirroredFromConversationAt: now
            },
            updatedAt: now
          },
          [localKey]: {
            ...decorated,
            conversationId,
            projectId,
            metadata: {
              ...(decorated.metadata || {}),
              projectId,
              researchScope: 'project',
              projectMirrorOf: projectId,
              projectMirrorAt: now
            },
            updatedAt: now
          }
        });
      } catch (error) {
        console.debug('[ResearchProjectMirror] sync failed:', error?.message || error);
      } finally {
        busy = false;
      }
    };

    void sync();
    timer = window.setInterval(() => { void sync(); }, 700);
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, []);

  return null;
}
