import { useEffect } from 'react';

const BOOTSTRAP_PREFIX = 'researchProducerBootstrappedV3:';

function conversationIdFromUrl(url) {
  try {
    const parsed = new URL(url || '');
    if (parsed.hostname !== 'chatgpt.com' && parsed.hostname !== 'chat.openai.com') return null;
    const match = parsed.pathname.match(/\/c\/([a-zA-Z0-9-]+)/);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

function isChatGPTUrl(url) {
  return typeof url === 'string'
    && (url.startsWith('https://chatgpt.com/') || url.startsWith('https://chat.openai.com/'));
}

async function migrateBootstrapState(conversationId) {
  if (!conversationId) return;

  const stagedKey = `${BOOTSTRAP_PREFIX}new`;
  const conversationKey = `${BOOTSTRAP_PREFIX}${conversationId}`;
  const current = await chrome.storage.local.get([stagedKey, conversationKey]);

  if (current?.[stagedKey] === true && current?.[conversationKey] !== true) {
    await chrome.storage.local.set({ [conversationKey]: true });
  }

  if (current?.[stagedKey] !== undefined) {
    await chrome.storage.local.remove(stagedKey);
  }
}

/**
 * Lightweight new-chat lifecycle bridge.
 *
 * Research v3 no longer refreshes ChatGPT's conversation API automatically.
 * The DOM RGΔ bridge is the primary path, so a new chat only needs its one-time
 * producer bootstrap flag migrated from `new` to the assigned /c/<id> URL.
 */
export default function ResearchConversationSyncBridge() {
  useEffect(() => {
    let cancelled = false;
    let timer = null;
    let stagedNewTabId = null;
    let lastConversationId = null;

    const tick = async () => {
      if (cancelled) return;

      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !isChatGPTUrl(tab.url)) {
          stagedNewTabId = null;
          lastConversationId = null;
          return;
        }

        const conversationId = conversationIdFromUrl(tab.url);
        if (!conversationId) {
          stagedNewTabId = tab.id;
          lastConversationId = null;
          return;
        }

        const cameFromNewChat = stagedNewTabId === tab.id && lastConversationId == null;
        if (cameFromNewChat) {
          await migrateBootstrapState(conversationId);
          stagedNewTabId = null;
        }

        lastConversationId = conversationId;
      } catch (error) {
        console.debug('[ResearchSync] Lifecycle check failed:', error?.message || error);
      }
    };

    void tick();
    timer = window.setInterval(() => {
      void tick();
    }, 1200);

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, []);

  return null;
}
