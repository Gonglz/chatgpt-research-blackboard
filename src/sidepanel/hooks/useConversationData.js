/**
 * 对话数据 Hook
 *
 * 目标：
 * 1) 始终展示「当前活动 Tab」所在的 ChatGPT 对话，而不是 DB 里的任意一条。
 * 2) 支持分支：优先用 nodes 重新构建 rounds（避免旧数据缺少内容/缺少 parentRoundId）。
 * 3) 支持更新：
 *    - 收到 background 的 DATA_READY / UPDATE_NOTIFICATION 后自动回读本地 DB
 *    - 用户切换 Tab 或 URL 变化时只读取本地 DB，不自动打 conversation API
 *    - 点击刷新按钮才显式触发 content script / conversation API refresh
 *
 * Research Blackboard 的自动 RGΔ 主路径不应依赖这里的 API refresh；
 * 这样新 Chat、API 暂时 404、SPA 切换都不会形成重试风暴。
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ASSISTANT_STREAM_OUTPUT_MODES,
  DEFAULT_ASSISTANT_STREAM_SETTINGS,
  MESSAGE_TYPES,
  STORAGE_KEYS
} from '../../shared/constants';
import { sendMessageToTabWithFallback } from '../../shared/tab-messaging.js';
import { buildRounds as buildRoundsFromParsedNodes } from '../../content/parser/branch-extractor.js';
import { normalizeAssistantStreamNodes } from '../../content/parser/assistant-stream-normalizer.js';

// 与 shared/utils.js 中 extractConversationId 保持一致
const CONVERSATION_ID_REGEX = /\/c\/([a-f0-9-]+)/;

async function getAssistantStreamMode() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.ASSISTANT_STREAM_SETTINGS);
    const mode = result[STORAGE_KEYS.ASSISTANT_STREAM_SETTINGS]?.mode;
    if (Object.values(ASSISTANT_STREAM_OUTPUT_MODES).includes(mode)) {
      return mode;
    }
  } catch (e) {
    console.warn('[Hook] Failed to load assistant stream settings:', e?.message);
  }

  return DEFAULT_ASSISTANT_STREAM_SETTINGS.mode;
}

/**
 * 带重试的消息发送。
 * 只对 extension/background 连接错误重试；业务层 cache miss 不在这里重试。
 */
async function sendMessageWithRetry(message, retries = 3, delay = 500) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (!chrome.runtime?.id) {
        throw new Error('Extension context invalidated');
      }

      const response = await chrome.runtime.sendMessage(message);

      if (chrome.runtime.lastError) {
        throw new Error(chrome.runtime.lastError.message);
      }

      return response;
    } catch (error) {
      const isLastAttempt = attempt === retries;
      const isConnectionError = error.message?.includes('Receiving end does not exist');

      console.warn(`[SidePanel] Message send attempt ${attempt}/${retries} failed:`, error.message);

      if (!isLastAttempt && isConnectionError) {
        await new Promise(resolve => setTimeout(resolve, delay * attempt));
        continue;
      }

      throw error;
    }
  }
}

/**
 * Promise 化 tabs.query（兼容 callback 形式）
 */
function queryActiveTab() {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs || []));
    } catch {
      resolve([]);
    }
  });
}

/**
 * 从当前活动 Tab URL 提取 conversationId
 */
async function getActiveConversationIdFromTab() {
  const tabs = await queryActiveTab();
  const url = tabs?.[0]?.url || '';
  const match = url.match(CONVERSATION_ID_REGEX);
  return match ? match[1] : null;
}

/**
 * 转换对话数据为 sidepanel 图谱格式。
 * background.GET_CONVERSATION 返回：
 * { found, conversation, nodes, edges, rounds }
 */
function transformToGraphData(payload, assistantStreamMode = DEFAULT_ASSISTANT_STREAM_SETTINGS.mode) {
  if (!payload || payload.found === false || !payload.conversation) return null;

  const conversation = payload.conversation;
  const rawNodes = payload.nodes || conversation.nodes || [];
  const normalized = normalizeAssistantStreamNodes(rawNodes, {
    mode: assistantStreamMode,
    conversationId: conversation.id
  });
  const nodes = normalized.nodes;
  const edges = rawNodes.length > 0 ? normalized.edges : (payload.edges || conversation.edges || []);
  const roundsFromDB = payload.rounds || conversation.rounds || [];

  // ✅ 强制用 nodes 重建 rounds：
  // - 修复旧 rounds 缺少 userMessage/assistantMessage 导致节点空白
  // - 修复 parentRoundId/branch 连接问题
  // - 增量更新时 nodes 一定是最新的
  let rounds = [];
  if (nodes && nodes.length > 0) {
    try {
      rounds = buildRoundsFromParsedNodes(nodes);
    } catch (e) {
      console.warn('[Transform] Failed to build rounds from nodes, fallback to DB rounds:', e?.message);
      rounds = roundsFromDB;
    }
  } else {
    rounds = roundsFromDB;
  }

  return {
    id: conversation.id,
    title: conversation.title || 'Untitled Conversation',
    nodes,
    edges,
    rounds,
    updatedAt: conversation.lastIncrementalUpdate || conversation.updateTime || Date.now(),
    stats: {
      totalRounds: rounds.length,
      totalNodes: nodes.length || conversation.nodeCount || rounds.length * 2,
      totalEdges: edges.length || conversation.edgeCount || 0
    }
  };
}

export function useConversationData() {
  const [conversationData, setConversationData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentNodeId, setCurrentNodeId] = useState(null);
  const [activeConversationId, setActiveConversationId] = useState(null);

  const runtimeListenerSetRef = useRef(false);
  const pendingContentRefreshRef = useRef(new Set());

  /**
   * 显式触发 content script 抓取 conversation API。
   * 只有手动刷新、设置变化或专门的同步 bridge 应该调用它。
   */
  const triggerContentRefresh = useCallback(async (conversationId) => {
    if (!conversationId) return false;

    if (pendingContentRefreshRef.current.has(conversationId)) {
      console.log('[Hook] Content refresh already pending for:', conversationId);
      return false;
    }

    const tabs = await queryActiveTab();
    const tab = tabs?.[0];
    if (!tab?.id) return false;

    pendingContentRefreshRef.current.add(conversationId);

    // 8 秒后自动清除 pending 状态（防止 API 失败后永久卡死）
    setTimeout(() => {
      pendingContentRefreshRef.current.delete(conversationId);
    }, 8000);

    try {
      console.log('[Hook] Explicit content refresh:', conversationId);
      const response = await sendMessageToTabWithFallback(tab.id, {
        type: MESSAGE_TYPES.REFRESH_DATA,
        payload: { conversationId }
      });
      console.log('[Hook] ✓ Content refresh finished for:', conversationId);
      return response?.success !== false;
    } catch (e) {
      console.warn('[Hook] Content refresh failed:', e?.message);
      pendingContentRefreshRef.current.delete(conversationId);
      return false;
    }
  }, []);

  /**
   * 只从 background / IndexedDB 拉取指定 conversationId。
   *
   * @param {string} conversationId
   * @param {boolean} triggerIfMissing - 仅供显式恢复流程使用；默认 false。
   */
  const fetchConversation = useCallback(async (conversationId, triggerIfMissing = false) => {
    if (!conversationId) {
      setConversationData(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await sendMessageWithRetry({
        type: MESSAGE_TYPES.GET_CONVERSATION,
        payload: { conversationId }
      }, 3, 500);

      if (!response?.success) {
        throw new Error(response?.error || 'Failed to read conversation cache');
      }

      const payload = response.data;
      if (!payload || payload.found === false || !payload.conversation) {
        // Cache miss 是新 Chat / SPA 切换中的正常状态，不作为错误。
        console.debug('[Hook] Conversation cache miss:', conversationId);
        setActiveConversationId(conversationId);
        setConversationData(null);

        if (triggerIfMissing) {
          void triggerContentRefresh(conversationId);
        }
        return;
      }

      const assistantStreamMode = await getAssistantStreamMode();
      const graphData = transformToGraphData(payload, assistantStreamMode);
      setConversationData(graphData);
      setActiveConversationId(conversationId);
      pendingContentRefreshRef.current.delete(conversationId);

      // IMPORTANT: successful DB reads never trigger another API refresh.
      // This removes the previous read -> refresh -> DATA_READY -> read loop.
    } catch (err) {
      console.error('[Hook] Failed to read conversation cache:', err);
      setError(err.message || 'Failed to load conversation data');
      setConversationData(null);
    } finally {
      setIsLoading(false);
    }
  }, [triggerContentRefresh]);

  /**
   * 根据当前活动 Tab 选择要展示的 conversation。
   * 普通 tab/URL 同步只读本地缓存，不打 API。
   */
  const syncWithActiveTab = useCallback(async () => {
    const convId = await getActiveConversationIdFromTab();

    if (!convId) {
      setActiveConversationId(null);
      setConversationData(null);
      setIsLoading(false);
      return;
    }

    if (convId !== activeConversationId) {
      console.log('[Hook] Active tab conversation changed:', activeConversationId, '→', convId);
      await fetchConversation(convId, false);
    }
  }, [activeConversationId, fetchConversation]);

  /**
   * 手动刷新：
   * 1) 显式请求 content script 抓取/解析
   * 2) 完成后回读 DB
   */
  const refreshData = useCallback(async () => {
    console.log('[Hook] Manual refresh requested');

    const convId = await getActiveConversationIdFromTab();
    if (!convId) {
      setConversationData(null);
      setIsLoading(false);
      return;
    }

    setActiveConversationId(convId);
    await triggerContentRefresh(convId);
    await fetchConversation(convId, false);
  }, [fetchConversation, triggerContentRefresh]);

  /**
   * runtime 消息监听：background -> sidepanel
   */
  useEffect(() => {
    if (runtimeListenerSetRef.current) return;
    runtimeListenerSetRef.current = true;

    const handleMessage = (message) => {
      if (!message?.type) return;

      if (message.type === MESSAGE_TYPES.DATA_READY) {
        const convId = message.payload?.conversationId;
        console.log('[Hook] DATA_READY received for:', convId);

        if (convId) {
          pendingContentRefreshRef.current.delete(convId);
          fetchConversation(convId, false);
        } else {
          syncWithActiveTab();
        }
      }

      if (message.type === MESSAGE_TYPES.UPDATE_NOTIFICATION) {
        const convId = message.payload?.conversationId;
        console.log('[Hook] UPDATE_NOTIFICATION received for:', convId);

        if (convId && convId === activeConversationId) {
          fetchConversation(convId, false);
        }
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
      runtimeListenerSetRef.current = false;
    };
  }, [activeConversationId, fetchConversation, syncWithActiveTab]);

  /**
   * Assistant stream parsing setting changed: this is an explicit user setting,
   * so one content refresh is acceptable here.
   */
  useEffect(() => {
    const handleStorageChange = (changes, areaName) => {
      if (areaName !== 'local' || !changes[STORAGE_KEYS.ASSISTANT_STREAM_SETTINGS]) {
        return;
      }

      if (activeConversationId) {
        void (async () => {
          await triggerContentRefresh(activeConversationId);
          await fetchConversation(activeConversationId, false);
        })();
      }
    };

    chrome.storage?.onChanged?.addListener(handleStorageChange);
    return () => {
      chrome.storage?.onChanged?.removeListener(handleStorageChange);
    };
  }, [activeConversationId, fetchConversation, triggerContentRefresh]);

  /**
   * 监听 tab 切换/URL 更新（sidepanel 跟随当前看的对话）。
   */
  useEffect(() => {
    syncWithActiveTab();

    const onActivated = () => {
      syncWithActiveTab();
    };

    const onUpdated = (tabId, changeInfo, tab) => {
      if (tab?.active && changeInfo?.url) {
        syncWithActiveTab();
      }
    };

    try {
      chrome.tabs.onActivated.addListener(onActivated);
      chrome.tabs.onUpdated.addListener(onUpdated);
    } catch (e) {
      console.warn('[Hook] tabs listeners not available in this context:', e?.message);
    }

    return () => {
      try {
        chrome.tabs.onActivated.removeListener(onActivated);
        chrome.tabs.onUpdated.removeListener(onUpdated);
      } catch {
        // ignore
      }
    };
  }, [syncWithActiveTab]);

  // ChatGPT 是 SPA，有时 tabs.onUpdated 不会触发 changeInfo.url。
  // 轻量轮询只检查 URL / DB，不触发 API。
  useEffect(() => {
    const timer = setInterval(() => {
      syncWithActiveTab();
    }, 1500);

    return () => clearInterval(timer);
  }, [syncWithActiveTab]);

  return {
    conversationData,
    isLoading,
    error,
    refreshData,
    currentNodeId,
    setCurrentNodeId,
    activeConversationId
  };
}
