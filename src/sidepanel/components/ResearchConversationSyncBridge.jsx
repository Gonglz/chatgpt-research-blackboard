import { useEffect } from 'react';
import { MESSAGE_TYPES } from '../../shared/constants.js';

const AUTO_PREFIX = 'researchAutoGraphEnabled:';
const BOOTSTRAP_PREFIX = 'researchProducerBootstrapped:';

function conversationIdFromUrl(url) {
  try {
    const parsed = new URL(url || '');
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

async function migrateNewChatState(conversationId) {
  if (!conversationId) return false;

  const newAutoKey = `${AUTO_PREFIX}new`;
  const conversationAutoKey = `${AUTO_PREFIX}${conversationId}`;
  const newBootstrapKey = `${BOOTSTRAP_PREFIX}new`;
  const conversationBootstrapKey = `${BOOTSTRAP_PREFIX}${conversationId}`;

  const current = await chrome.storage.local.get([
    newAutoKey,
    conversationAutoKey,
    newBootstrapKey,
    conversationBootstrapKey
  ]);

  const patch = {};
  let migrated = false;

  if (current?.[newAutoKey] === true && current?.[conversationAutoKey] !== true) {
    patch[conversationAutoKey] = true;
    migrated = true;
  }

  if (current?.[newBootstrapKey] === true && current?.[conversationBootstrapKey] !== true) {
    patch[conversationBootstrapKey] = true;
    migrated = true;
  }

  if (Object.keys(patch).length) {
    await chrome.storage.local.set(patch);
  }

  // "new" is a staging key for exactly one not-yet-created chat. Clearing it
  // prevents Auto from leaking into the next unrelated chat opened from home.
  if (current?.[newAutoKey] !== undefined || current?.[newBootstrapKey] !== undefined) {
    await chrome.storage.local.remove([newAutoKey, newBootstrapKey]);
  }

  return migrated;
}

async function isAutoEnabled(conversationId) {
  if (!conversationId) return false;
  const key = `${AUTO_PREFIX}${conversationId}`;
  const result = await chrome.storage.local.get([key]);
  return result?.[key] === true;
}

async function requestConversationRefresh(tabId, conversationId) {
  if (!tabId || !conversationId) return false;

  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: MESSAGE_TYPES.REFRESH_DATA,
      payload: { conversationId }
    });
    return response?.success !== false;
  } catch (error) {
    console.warn('[ResearchSync] Conversation refresh failed:', error?.message || error);
    return false;
  }
}

async function readDomConversationState(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const raw = Array.from(document.querySelectorAll('section[data-turn-id], article'));
        const containers = [];
        const seen = new Set();

        for (const element of raw) {
          const canonical = element.matches?.('section[data-turn-id]')
            ? element
            : (element.closest?.('section[data-turn-id]') || element);
          if (!canonical || seen.has(canonical)) continue;
          seen.add(canonical);
          containers.push(canonical);
        }

        const turns = containers.slice(-8).map((container, index) => {
          const roleNode = container.matches?.('[data-message-author-role]')
            ? container
            : container.querySelector?.('[data-message-author-role]');
          const role = normalize(roleNode?.getAttribute?.('data-message-author-role') || '');
          const id = normalize(
            container.getAttribute?.('data-turn-id')
              || roleNode?.getAttribute?.('data-message-id')
              || container.querySelector?.('[data-message-id]')?.getAttribute?.('data-message-id')
              || `dom-${index}`
          );
          const text = normalize(container.innerText || container.textContent || '');
          return `${role}:${id}:${text.length}`;
        });

        const streaming = !!(
          document.querySelector('[data-testid="stop-button"]')
          || document.querySelector('button[aria-label*="Stop"]')
          || document.querySelector('button[aria-label*="停止"]')
        );

        return {
          streaming,
          signature: turns.join('|'),
          turnCount: containers.length
        };
      }
    });

    return results?.[0]?.result || null;
  } catch (error) {
    console.debug('[ResearchSync] DOM state unavailable:', error?.message || error);
    return null;
  }
}

/**
 * Repairs the SPA "new chat" lifecycle without reloading ChatGPT:
 *
 * 1. Auto enabled on https://chatgpt.com/ is staged under the `new` key.
 * 2. When ChatGPT assigns /c/<id>, move that state to the real conversation key.
 * 3. The upstream content script has already installed its REFRESH_DATA listener
 *    even if it returned early on the home page, so request a full refresh here.
 * 4. Refresh once more when streaming settles so RGΔ in the assistant turn is
 *    visible to the side-panel reducer.
 */
export default function ResearchConversationSyncBridge() {
  useEffect(() => {
    let cancelled = false;
    let busy = false;
    let timer = null;

    let lastTabId = null;
    let lastConversationId = null;
    let lastSignature = '';
    let lastStreaming = false;
    let stagedNewTabId = null;

    const tick = async () => {
      if (cancelled || busy) return;
      busy = true;

      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !isChatGPTUrl(tab.url)) {
          lastTabId = null;
          lastConversationId = null;
          lastSignature = '';
          lastStreaming = false;
          stagedNewTabId = null;
          return;
        }

        const conversationId = conversationIdFromUrl(tab.url);

        if (!conversationId) {
          stagedNewTabId = tab.id;
          lastTabId = tab.id;
          lastConversationId = null;
          lastSignature = '';
          lastStreaming = false;
          return;
        }

        const cameFromNewChat = stagedNewTabId === tab.id && lastConversationId == null;
        if (cameFromNewChat) {
          await migrateNewChatState(conversationId);
          stagedNewTabId = null;
        }

        const autoEnabled = await isAutoEnabled(conversationId);
        const conversationChanged = tab.id !== lastTabId || conversationId !== lastConversationId;

        if (!autoEnabled) {
          lastTabId = tab.id;
          lastConversationId = conversationId;
          lastSignature = '';
          lastStreaming = false;
          return;
        }

        const domState = await readDomConversationState(tab.id);

        if (conversationChanged) {
          // The upstream content script may have returned early on the home page.
          // Its REFRESH_DATA listener is still alive and performs full state init.
          await requestConversationRefresh(tab.id, conversationId);
        } else if (domState) {
          const justSettled = lastStreaming && !domState.streaming;
          const settledSignatureChanged = (
            !domState.streaming
            && !!domState.signature
            && !!lastSignature
            && domState.signature !== lastSignature
          );

          if (justSettled || settledSignatureChanged) {
            await requestConversationRefresh(tab.id, conversationId);
          }
        }

        lastTabId = tab.id;
        lastConversationId = conversationId;
        lastSignature = domState?.signature || lastSignature;
        lastStreaming = !!domState?.streaming;
      } catch (error) {
        console.warn('[ResearchSync] Tick failed:', error?.message || error);
      } finally {
        busy = false;
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
