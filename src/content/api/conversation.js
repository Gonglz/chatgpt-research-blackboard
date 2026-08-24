/**
 * ChatGPT API 调用模块
 */

import { API_ENDPOINTS } from '../../shared/constants.js';
import { log, delay } from '../../shared/utils.js';
import { buildAuthHeaders, clearAuthCache } from '../auth/token-manager.js';

function apiError(message, retryable = true) {
  const error = new Error(message);
  error.retryable = retryable;
  return error;
}

/**
 * 获取对话完整数据
 * @param {string} conversationId - 对话 ID
 * @returns {Promise<Object>} 对话数据（包含 mapping）
 * @throws {Error} API 调用失败
 */
async function fetchConversation(conversationId, isRetry = false) {
  log('info', 'API', `Fetching conversation: ${conversationId}${isRetry ? ' (retry)' : ''}`);

  try {
    const response = await fetch(
      `${API_ENDPOINTS.CONVERSATION}/${conversationId}`,
      {
        method: 'GET',
        credentials: 'include',
        headers: buildAuthHeaders()
      }
    );

    if (!response.ok) {
      let errorDetail = '';
      let errorData = null;

      try {
        errorData = await response.json();
        errorDetail = JSON.stringify(errorData);
      } catch (e) {
        errorDetail = await response.text();
      }

      if (response.status === 401) {
        log('warn', 'API', 'Authentication failed (401), clearing auth cache');
        clearAuthCache();

        if (!isRetry) {
          log('info', 'API', 'Retrying once with fresh auth info...');
          await delay(500);
          return await fetchConversation(conversationId, true);
        }

        throw apiError(
          'Authentication failed (401). Please ensure you are logged into ChatGPT and refresh the page.',
          false
        );
      }

      const detail = errorData?.detail || {};
      const nonRetryable = detail?.can_retry === false
        || detail?.code === 'conversation_not_found'
        || detail?.code === 'conversation_inaccessible'
        || response.status === 404;

      if (detail?.code === 'conversation_not_found') {
        log('warn', 'API', `Conversation not found: ${conversationId}`);
      } else if (detail?.code === 'conversation_inaccessible') {
        log('warn', 'API', `Conversation inaccessible to API: ${conversationId}`);
      } else {
        log('error', 'API', `HTTP ${response.status}:`, errorDetail);
      }

      throw apiError(
        `API Error: ${response.status} - ${errorDetail}`,
        !nonRetryable
      );
    }

    const data = await response.json();

    log('info', 'API', 'Conversation loaded successfully', {
      id: data.id || conversationId,
      title: data.title,
      mappingSize: Object.keys(data.mapping || {}).length
    });

    return data;
  } catch (error) {
    log('error', 'API', 'Failed to fetch conversation:', error);
    throw error;
  }
}

/**
 * 带重试的获取对话数据。
 * 服务端明确 can_retry=false / conversation_inaccessible / 404 时立即停止，
 * 避免同一个无效请求连续轰三遍。
 * @param {string} conversationId - 对话 ID
 * @param {number} maxRetries - 最大尝试次数
 * @returns {Promise<Object>}
 */
export async function fetchConversationWithRetry(conversationId, maxRetries = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fetchConversation(conversationId);
    } catch (error) {
      lastError = error;

      if (error?.retryable === false || attempt >= maxRetries) {
        throw error;
      }

      log('warn', 'API', `Retry ${attempt}/${maxRetries} failed:`, error.message);
      await delay(1000);
    }
  }

  throw lastError;
}

/**
 * 检查 API 是否可用
 * @returns {Promise<boolean>}
 */
export async function checkAPIAvailability() {
  try {
    const response = await fetch(API_ENDPOINTS.ME, {
      credentials: 'include'
    });
    return response.ok;
  } catch (error) {
    log('warn', 'API', 'API availability check failed:', error);
    return false;
  }
}
