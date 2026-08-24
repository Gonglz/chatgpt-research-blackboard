import { useEffect } from 'react';

const AUTO_PREFIX = 'researchAutoGraphEnabled:';
const HEARTBEAT_PREFIX = 'researchSidecarHeartbeat:';

function conversationKeyFromUrl(url) {
  try {
    const parsed = new URL(url || '');
    const isChatGPT = parsed.hostname === 'chatgpt.com' || parsed.hostname === 'chat.openai.com';
    if (!isChatGPT) return null;
    const match = parsed.pathname.match(/\/c\/([a-zA-Z0-9-]+)/);
    return match?.[1] || 'new';
  } catch {
    return null;
  }
}

async function getActiveScope() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;
    const conversationKey = conversationKeyFromUrl(tab.url || '');
    if (!conversationKey) return null;
    return {
      tabId: tab.id,
      conversationKey,
      autoKey: `${AUTO_PREFIX}${conversationKey}`,
      heartbeatKey: `${HEARTBEAT_PREFIX}${conversationKey}`
    };
  } catch {
    return null;
  }
}

/**
 * Sidecar presence is the Research Mode switch.
 *
 * While the side panel document exists, keep the active ChatGPT conversation
 * marked as automatic-research enabled. Closing the sidecar removes that state.
 * A heartbeat lets the content producer reject stale `true` flags if Chrome
 * kills the side-panel document without running cleanup.
 */
export default function SidecarPresenceBridge() {
  useEffect(() => {
    let cancelled = false;
    let currentScope = null;
    let timer = null;

    const clearScope = async (scope = currentScope) => {
      if (!scope) return;
      try {
        await chrome.storage.local.remove([scope.autoKey, scope.heartbeatKey]);
      } catch {
        // best effort; producer also expires stale heartbeat values
      }
      if (currentScope?.autoKey === scope.autoKey) currentScope = null;
    };

    const publish = async () => {
      if (cancelled) return;
      const nextScope = await getActiveScope();
      if (cancelled) return;

      if (!nextScope) {
        await clearScope();
        return;
      }

      if (currentScope && currentScope.autoKey !== nextScope.autoKey) {
        await clearScope(currentScope);
      }

      currentScope = nextScope;
      try {
        await chrome.storage.local.set({
          [nextScope.autoKey]: true,
          [nextScope.heartbeatKey]: Date.now()
        });
      } catch {
        // retry on next heartbeat
      }
    };

    const cleanupNow = () => {
      const scope = currentScope;
      currentScope = null;
      if (!scope) return;
      chrome.storage.local.remove([scope.autoKey, scope.heartbeatKey]).catch(() => {});
    };

    window.addEventListener('pagehide', cleanupNow);
    window.addEventListener('beforeunload', cleanupNow);

    void publish();
    timer = window.setInterval(() => {
      void publish();
    }, 1200);

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      window.removeEventListener('pagehide', cleanupNow);
      window.removeEventListener('beforeunload', cleanupNow);
      cleanupNow();
    };
  }, []);

  return null;
}
