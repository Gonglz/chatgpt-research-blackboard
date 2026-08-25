/**
 * Research Blackboard content runtime.
 *
 * DOM-only compatibility/runtime layer. It deliberately does not read ChatGPT
 * credentials, call private ChatGPT APIs, dynamically inject scripts, or
 * navigate hidden ChatGPT branches.
 */

import {
  DEFAULT_ASSISTANT_STREAM_SETTINGS,
  MESSAGE_TYPES,
  CONFIG,
  STORAGE_KEYS
} from '../shared/constants.js';
import {
  log,
  extractConversationId,
  delay,
  initDebugLogSetting
} from '../shared/utils.js';
import { fetchConversationWithRetry } from './api/conversation.js';
import { parseMapping, getNodeStatistics } from './parser/mapping-parser.js';
import { normalizeAssistantStreamNodes } from './parser/assistant-stream-normalizer.js';
import { extractBranches, buildRounds, analyzeBranchStructure } from './parser/branch-extractor.js';
import { waitForElement } from './utils/dom-helper.js';
import { createURLObserver } from './observers/url-observer.js';
import { createMessageObserver } from './observers/message-observer.js';
import { conversationState } from './state/conversation-state.js';
import { findArticleByMessageId } from './utils/message-id-helper.js';

let urlObserver = null;
let messageObserver = null;
let activeConversationId = null;
let bootstrapSequence = 0;

const CONTENT_SCRIPT_GUARD = '__researchBlackboardContentInitialized__';

async function loadAssistantStreamSettings() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.ASSISTANT_STREAM_SETTINGS);
    conversationState.setAssistantStreamSettings({
      ...DEFAULT_ASSISTANT_STREAM_SETTINGS,
      ...(result[STORAGE_KEYS.ASSISTANT_STREAM_SETTINGS] || {})
    });
  } catch (error) {
    log('warn', 'ResearchRuntime', 'Failed to load assistant stream settings:', error);
    conversationState.setAssistantStreamSettings(DEFAULT_ASSISTANT_STREAM_SETTINGS);
  }
}

function setupAssistantStreamSettingsListener() {
  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[STORAGE_KEYS.ASSISTANT_STREAM_SETTINGS]) {
      void loadAssistantStreamSettings();
    }
  });
}

function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === MESSAGE_TYPES.SCROLL_TO_MESSAGE) {
      const messageId = message.payload?.messageId;
      scrollToMessage(messageId)
        .then((success) => sendResponse({ success }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    }

    if (message.type === MESSAGE_TYPES.REFRESH_DATA) {
      const conversationId = message.payload?.conversationId || extractConversationId();
      if (!conversationId) {
        sendResponse({ success: false, error: 'No conversationId' });
        return false;
      }

      refreshConversation(conversationId)
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    }

    if (message.type === MESSAGE_TYPES.ASSISTANT_STREAM_SETTINGS_CHANGED) {
      (async () => {
        await loadAssistantStreamSettings();
        const conversationId = extractConversationId();
        if (conversationId) {
          await refreshConversation(conversationId);
        }
      })()
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    }

    return false;
  });
}

async function waitForPageReady() {
  const mainElement = await waitForElement('main', 10000);
  if (!mainElement) {
    throw new Error('ChatGPT page load timeout');
  }
}

async function refreshConversation(conversationId) {
  const sequence = ++bootstrapSequence;
  await waitForPageReady();
  await delay(CONFIG.API_DELAY);

  const data = await fetchConversationWithRetry(conversationId);
  if (sequence !== bootstrapSequence) {
    return;
  }

  if (!data?.mapping) {
    throw new Error('Unable to build a conversation snapshot from the current ChatGPT DOM');
  }

  const parsed = parseMapping(data.mapping, conversationId);
  const normalized = normalizeAssistantStreamNodes(parsed.nodes, {
    mode: conversationState.assistantStreamSettings?.mode || DEFAULT_ASSISTANT_STREAM_SETTINGS.mode,
    conversationId
  });

  const nodes = normalized.nodes;
  const edges = parsed.nodes.length > 0 ? normalized.edges : parsed.edges;
  const stats = getNodeStatistics(nodes);
  const branches = extractBranches(nodes);
  const rounds = buildRounds(nodes);
  const analysis = analyzeBranchStructure(nodes);

  const conversationData = {
    id: conversationId,
    title: data.title,
    createTime: data.create_time,
    updateTime: data.update_time,
    mapping: data.mapping,
    nodes,
    edges,
    rounds,
    branches,
    analysis
  };

  conversationState.initialize(conversationData);
  activeConversationId = conversationId;

  log('info', 'ResearchRuntime', 'DOM conversation snapshot ready', {
    conversationId,
    nodes: nodes.length,
    edges: edges.length,
    userMessages: stats.user || 0,
    assistantMessages: stats.assistant || 0
  });

  try {
    await sendToBackground(MESSAGE_TYPES.CONVERSATION_LOADED, conversationData);
  } catch (error) {
    log('warn', 'ResearchRuntime', 'Could not persist DOM snapshot:', error.message);
  }

  startMessageObserver();
}

function startMessageObserver() {
  if (messageObserver) {
    messageObserver.stop();
  }

  messageObserver = createMessageObserver(async (messageData) => {
    await handleIncrementalMessage(messageData);
  });
}

async function handleIncrementalMessage(messageData) {
  if (!conversationState.isReady()) {
    return;
  }

  const updateResult = conversationState.addIncrementalNode(messageData);
  if (!updateResult.changed) {
    return;
  }

  const incrementalUpdate = conversationState.getIncrementalUpdate(updateResult.nodeId);

  try {
    await sendToBackground(MESSAGE_TYPES.CONVERSATION_INCREMENTAL_UPDATE, incrementalUpdate);
  } catch (error) {
    log('warn', 'ResearchRuntime', 'Could not persist incremental DOM update:', error.message);
  }
}

function startURLObserver() {
  if (urlObserver) {
    urlObserver.stop();
  }

  urlObserver = createURLObserver(async (newConversationId) => {
    if (!newConversationId || newConversationId === activeConversationId) {
      return;
    }

    conversationState.clear();
    activeConversationId = null;

    if (messageObserver) {
      messageObserver.stop();
      messageObserver = null;
    }

    try {
      await refreshConversation(newConversationId);
    } catch (error) {
      log('warn', 'ResearchRuntime', 'Conversation switch bootstrap failed:', error.message);
    }
  });
}

async function scrollToMessage(messageId) {
  if (!messageId) {
    return false;
  }

  const target = findArticleByMessageId(messageId) ||
    document.querySelector(`[data-message-id="${cssEscape(messageId)}"]`);

  if (!target) {
    // DOM-only mode intentionally does not drive ChatGPT's hidden branch controls.
    return false;
  }

  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  highlightElement(target);
  return true;
}

function cssEscape(value) {
  if (window.CSS?.escape) {
    return window.CSS.escape(value);
  }
  return String(value).replace(/["\\]/g, '\\$&');
}

function highlightElement(element) {
  const previous = {
    transition: element.style.transition,
    outline: element.style.outline,
    outlineOffset: element.style.outlineOffset
  };

  element.style.transition = 'outline 0.2s ease, outline-offset 0.2s ease';
  element.style.outline = '3px solid #3b82f6';
  element.style.outlineOffset = '2px';

  setTimeout(() => {
    element.style.transition = previous.transition;
    element.style.outline = previous.outline;
    element.style.outlineOffset = previous.outlineOffset;
  }, 1800);
}

async function sendToBackground(type, payload, retries = 3) {
  if (!chrome.runtime?.id) {
    throw new Error('Extension context invalidated. Refresh the ChatGPT page.');
  }

  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type, payload, timestamp: Date.now() }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response?.success === false) {
            reject(new Error(response.error || 'Background request failed'));
            return;
          }
          resolve(response);
        });
      });
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await delay(250 * attempt);
      }
    }
  }

  throw lastError || new Error('Background request failed');
}

async function main() {
  await initDebugLogSetting();

  if (!chrome.runtime?.id) {
    return;
  }

  await loadAssistantStreamSettings();
  setupAssistantStreamSettingsListener();
  setupMessageListener();
  startURLObserver();

  const conversationId = extractConversationId();
  if (!conversationId) {
    // New-chat pages often migrate from `/` to `/c/<id>` after the first turn.
    // URLObserver remains active and will bootstrap once the canonical ID exists.
    return;
  }

  try {
    await refreshConversation(conversationId);
  } catch (error) {
    log('warn', 'ResearchRuntime', 'Initial DOM bootstrap failed:', error.message);
  }
}

if (!globalThis[CONTENT_SCRIPT_GUARD]) {
  globalThis[CONTENT_SCRIPT_GUARD] = true;
  void main();
}
