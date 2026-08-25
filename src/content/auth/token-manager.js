/**
 * DOM-only auth compatibility shim.
 *
 * Research Blackboard no longer reads ChatGPT cookies, loads/stores ChatGPT
 * access tokens, or builds authenticated headers for internal ChatGPT APIs.
 * These exports remain temporarily so the inherited content-script bootstrap
 * can keep its existing control flow without handling credentials.
 */

import { log } from '../../shared/utils.js';

const LEGACY_AUTH_KEYS = [
  'accessToken',
  'tokenTimestamp',
  'tokenSource',
  'tokenInfo'
];

async function clearLegacyAuthState() {
  try {
    await chrome.storage.local.remove(LEGACY_AUTH_KEYS);
  } catch (error) {
    log('warn', 'AuthCompat', 'Failed to clear legacy auth state:', error);
  }
}

/**
 * Compatibility bootstrap: DOM-only mode does not require a token.
 */
export async function loadToken() {
  await clearLegacyAuthState();
  return true;
}

export function initTokenListener() {
  log('debug', 'AuthCompat', 'Token listener disabled; DOM-only mode active');
}

/**
 * Kept for the inherited bootstrap guard. In DOM-only mode authentication is
 * not required, so the bootstrap should proceed.
 */
export function hasToken() {
  return true;
}

export function getToken() {
  return null;
}

export function getTokenSource() {
  return 'removed';
}

export function clearAuthCache() {
  // No auth cache exists in DOM-only mode.
}

export function buildAuthHeaders() {
  return {};
}

export async function getTokenStatus() {
  await clearLegacyAuthState();
  return {
    hasToken: false,
    source: 'removed',
    isExpired: true,
    removed: true,
    message: 'ChatGPT token handling has been removed; Research Blackboard uses DOM-only mode.'
  };
}
