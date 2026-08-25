/**
 * 消息处理模块
 */

import { MESSAGE_TYPES } from '../../shared/constants.js';
import { sendMessageToTabWithFallback } from '../../shared/tab-messaging.js';
import { db } from '../database/db.js';
import { getTokenStatus, clearToken } from '../auth/token-capture.js';

/**
 * 设置消息监听器
 */
export function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Background] Received message:', message.type);

    handleMessage(message, sender)
      .then(result => {
        sendResponse({ success: true, data: result });
      })
      .catch(error => {
        console.error('[Background] Message handler error:', error);
        sendResponse({ success: false, error: error.message });
      });

    return true;
  });

  console.log('[Background] Message listener setup complete');
}

async function handleMessage(message, sender) {
  const { type, payload } = message;

  switch (type) {
    case MESSAGE_TYPES.CONVERSATION_LOADED:
      return await handleConversationLoaded(payload);
    case MESSAGE_TYPES.CONVERSATION_INCREMENTAL_UPDATE:
      return await handleIncrementalUpdate(payload);
    case MESSAGE_TYPES.GET_CONVERSATION:
      return await handleGetConversation(payload);
    case MESSAGE_TYPES.GET_ALL_CONVERSATIONS:
      return await handleGetAllConversations();
    case MESSAGE_TYPES.SCROLL_TO_MESSAGE:
      return await handleScrollToMessage(payload);
    case MESSAGE_TYPES.ERROR:
      return await handleError(payload, sender);
    case MESSAGE_TYPES.GET_TOKEN_STATUS:
      return await handleGetTokenStatus();
    case MESSAGE_TYPES.CLEAR_TOKEN:
      return await handleClearToken();
    default:
      throw new Error(`Unknown message type: ${type}`);
  }
}

async function handleConversationLoaded(conversationData) {
  console.log('[Background] Handling CONVERSATION_LOADED:', conversationData.id);

  try {
    await db.saveFullConversation(conversationData);

    await notifySidePanel(MESSAGE_TYPES.DATA_READY, {
      conversationId: conversationData.id,
      stats: {
        nodes: conversationData.nodes?.length || 0,
        edges: conversationData.edges?.length || 0,
        rounds: conversationData.rounds?.length || 0,
        branches: conversationData.branches?.length || 0
      }
    });

    return {
      message: 'Conversation saved successfully',
      conversationId: conversationData.id
    };
  } catch (error) {
    console.error('[Background] Failed to save conversation:', error);
    throw error;
  }
}

async function handleIncrementalUpdate(updateData) {
  console.log('[Background] Handling INCREMENTAL_UPDATE:', {
    conversationId: updateData.conversationId,
    newNodeId: updateData.newNode?.id
  });

  try {
    const conversation = await db.getConversation(updateData.conversationId);

    if (!conversation) {
      console.warn('[Background] Conversation not found, saving as new');
      await db.saveFullConversation({
        id: updateData.conversationId,
        nodes: updateData.updatedNodes,
        edges: updateData.updatedEdges || [],
        rounds: updateData.updatedRounds,
        branches: updateData.updatedBranches,
        analysis: updateData.updatedAnalysis,
        updateTime: updateData.timestamp
      });
    } else {
      await db.updateConversation(updateData.conversationId, {
        nodes: updateData.updatedNodes,
        edges: updateData.updatedEdges || [],
        rounds: updateData.updatedRounds,
        branches: updateData.updatedBranches,
        analysis: updateData.updatedAnalysis,
        updateTime: updateData.timestamp,
        lastIncrementalUpdate: updateData.timestamp
      });
    }

    await notifySidePanel(MESSAGE_TYPES.UPDATE_NOTIFICATION, {
      type: 'new_message',
      conversationId: updateData.conversationId,
      newNode: updateData.newNode,
      stats: {
        nodes: updateData.updatedNodes?.length || 0,
        edges: updateData.updatedEdges?.length || 0,
        rounds: updateData.updatedRounds?.length || 0,
        branches: updateData.updatedBranches?.length || 0
      }
    });

    return {
      message: 'Incremental update saved successfully',
      conversationId: updateData.conversationId,
      newNodeId: updateData.newNode?.id
    };

  } catch (error) {
    console.error('[Background] Failed to save incremental update:', error);
    throw error;
  }
}

/**
 * Missing DB rows are a normal cache miss during new-chat / SPA transitions.
 * Return a lightweight in-memory shell so Research Blackboard can render using
 * its own chrome.storage.local graph even when Graph/Tree data has not arrived.
 * The shell is NOT persisted to IndexedDB.
 */
async function handleGetConversation(payload) {
  const { conversationId } = payload;

  console.log('[Background] Getting conversation:', conversationId);

  const conversation = await db.getConversation(conversationId);

  if (!conversation) {
    console.debug('[Background] Conversation cache miss:', conversationId);
    return {
      found: true,
      cached: false,
      conversation: {
        id: conversationId,
        title: 'Research Blackboard',
        createTime: null,
        updateTime: Date.now(),
        nodeCount: 0,
        edgeCount: 0,
        roundCount: 0,
        branchCount: 0,
        ephemeral: true
      },
      nodes: [],
      edges: [],
      rounds: []
    };
  }

  const [nodes, edges, rounds] = await Promise.all([
    db.getNodes(conversationId),
    db.getEdges(conversationId),
    db.getRounds(conversationId)
  ]);

  return {
    found: true,
    cached: true,
    conversation,
    nodes,
    edges,
    rounds
  };
}

async function handleGetAllConversations() {
  console.log('[Background] Getting all conversations');

  let conversations = await db.getAllConversations();
  conversations = conversations
    .slice()
    .sort((a, b) => (b.updateTime || 0) - (a.updateTime || 0));

  const fullConversations = await Promise.all(
    conversations.map(async (conv) => {
      try {
        const [nodes, edges, rounds] = await Promise.all([
          db.getNodes(conv.id),
          db.getEdges(conv.id),
          db.getRounds(conv.id)
        ]);

        return {
          ...conv,
          nodes,
          edges,
          rounds
        };
      } catch (error) {
        console.error(`[Background] Failed to get full data for ${conv.id}:`, error);
        return conv;
      }
    })
  );

  return fullConversations;
}

async function handleError(errorData, sender) {
  console.error('[Background] Error from content script:', errorData);
  return { acknowledged: true };
}

async function handleGetTokenStatus() {
  console.log('[Background] Getting token status');
  return await getTokenStatus();
}

async function handleClearToken() {
  console.log('[Background] Clearing token');
  const success = await clearToken();
  return { success };
}

async function handleScrollToMessage(payload) {
  const { messageId } = payload;
  console.log('[Background] Forwarding SCROLL_TO_MESSAGE:', messageId);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id) {
      throw new Error('No active tab found');
    }

    if (!tab.url?.includes('chatgpt.com') && !tab.url?.includes('chat.openai.com')) {
      throw new Error('Active tab is not a ChatGPT page');
    }

    return await sendMessageToTabWithFallback(tab.id, {
      type: MESSAGE_TYPES.SCROLL_TO_MESSAGE,
      payload: { messageId }
    }, {
      retryDelayMs: 500
    });
  } catch (error) {
    console.error('[Background] Failed to forward SCROLL_TO_MESSAGE:', error);
    throw error;
  }
}

async function notifySidePanel(type, payload) {
  try {
    await chrome.runtime.sendMessage({
      type,
      payload,
      timestamp: Date.now()
    });
  } catch (error) {
    console.warn('[Background] Failed to notify side panel:', error.message);
  }
}
