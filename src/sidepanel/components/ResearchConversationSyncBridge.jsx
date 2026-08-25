import { useEffect } from 'react';

const BOOTSTRAP_PREFIX = 'researchProducerBootstrappedV7:';
const REQUEST_COUNT_PREFIX = 'researchProducerRequestCountV7:';

function conversationIdFromUrl(url) {
  try {
    const parsed = new URL(url || '');
    if (parsed.hostname !== 'chatgpt.com' && parsed.hostname !== 'chat.openai.com') return null;
    return parsed.pathname.match(/\/c\/([a-zA-Z0-9-]+)/)?.[1] || null;
  } catch {
    return null;
  }
}

function isChatGPTUrl(url) {
  return typeof url === 'string'
    && (url.startsWith('https://chatgpt.com/') || url.startsWith('https://chat.openai.com/'));
}

async function migrateProducerState(conversationId) {
  if (!conversationId) return;

  const stagedBootstrap = `${BOOTSTRAP_PREFIX}new`;
  const stagedCount = `${REQUEST_COUNT_PREFIX}new`;
  const chatBootstrap = `${BOOTSTRAP_PREFIX}chat:${conversationId}`;
  const chatCount = `${REQUEST_COUNT_PREFIX}chat:${conversationId}`;
  const current = await chrome.storage.local.get([stagedBootstrap, stagedCount, chatBootstrap, chatCount]);
  const writes = {};

  if (current?.[stagedBootstrap] === true && current?.[chatBootstrap] !== true) writes[chatBootstrap] = true;
  if (Number(current?.[stagedCount] || 0) > Number(current?.[chatCount] || 0)) writes[chatCount] = Number(current[stagedCount]);
  if (Object.keys(writes).length) await chrome.storage.local.set(writes);

  const removals = [];
  if (current?.[stagedBootstrap] !== undefined) removals.push(stagedBootstrap);
  if (current?.[stagedCount] !== undefined) removals.push(stagedCount);
  if (removals.length) await chrome.storage.local.remove(removals);
}

/** Migrate producer counters when ChatGPT turns a staged new chat into /c/<id>. */
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
          await migrateProducerState(conversationId);
          stagedNewTabId = null;
        }
        lastConversationId = conversationId;
      } catch (error) {
        console.debug('[ResearchSync] Lifecycle check failed:', error?.message || error);
      }
    };

    void tick();
    timer = window.setInterval(() => { void tick(); }, 1200);
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, []);

  return null;
}
