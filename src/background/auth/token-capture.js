/**
 * Legacy auth compatibility shim.
 *
 * Research Blackboard is DOM-first and no longer intercepts ChatGPT request
 * headers or stores ChatGPT access tokens. Keep these exports temporarily so
 * older background/message-handler call sites remain compatible while the
 * public behavior is migrated away from the inherited auth layer.
 */

const LEGACY_AUTH_KEYS = [
  'accessToken',
  'tokenTimestamp',
  'tokenSource',
  'tokenInfo'
];

async function removeLegacyAuthState() {
  try {
    await chrome.storage.local.remove(LEGACY_AUTH_KEYS);
    return true;
  } catch (error) {
    console.warn('[AuthCompat] Failed to clear legacy auth state:', error);
    return false;
  }
}

/**
 * Token capture has intentionally been removed.
 * No webRequest listeners are registered.
 */
export function initTokenCapture() {
  void removeLegacyAuthState();
  console.log('[AuthCompat] Token capture disabled; DOM-only mode active');
  return false;
}

export function getLatestTokenInfo() {
  return {
    value: '',
    timestamp: 0,
    url: '',
    source: 'removed'
  };
}

export async function hasValidToken() {
  await removeLegacyAuthState();
  return false;
}

export async function getTokenStatus() {
  await removeLegacyAuthState();
  return {
    hasToken: false,
    source: 'removed',
    age: null,
    ageMinutes: null,
    isExpired: true,
    removed: true,
    message: 'ChatGPT token capture has been removed; Research Blackboard uses DOM-only mode.'
  };
}

export async function clearToken() {
  return await removeLegacyAuthState();
}
