/**
 * Research Blackboard side panel application.
 *
 * The original fork included raw conversation Graph and Git-style Tree views.
 * Public UI now exposes only the semantic Research Blackboard. The underlying
 * conversation cache/parser remains because source anchoring and compatibility
 * refreshes still use it.
 */
import React, { useCallback, useEffect } from 'react';
import ResearchBlackboard from './components/ResearchBlackboard';
import Header from './components/Header';
import { useConversationData } from './hooks/useConversationData';
import { jumpToResearchSource } from './utils/researchSourceJump';

const IS_EMBEDDED = (() => {
  try {
    return new URLSearchParams(window.location.search).get('embedded') === '1';
  } catch {
    return false;
  }
})();

function cleanAnchorText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildMessageAnchor(conversationData, input) {
  const supplied = input && typeof input === 'object' ? input : { messageId: input };
  const messageId = supplied?.messageId || null;
  if (!messageId) return null;

  const ordered = (Array.isArray(conversationData?.nodes) ? conversationData.nodes : [])
    .filter((node) => node?.id && cleanAnchorText(node?.content))
    .slice()
    .sort((a, b) => (a.createTime || 0) - (b.createTime || 0));

  const messageIndex = ordered.findIndex((node) => node.id === messageId);
  const sourceNode = messageIndex >= 0 ? ordered[messageIndex] : null;
  const fullText = cleanAnchorText(supplied.fullText || sourceNode?.content || '');
  const role = cleanAnchorText(supplied.role || sourceNode?.role || '').toLowerCase() || null;

  let roleIndex = Number.isInteger(supplied.roleIndex) ? supplied.roleIndex : -1;
  if (roleIndex < 0 && sourceNode && role) {
    roleIndex = ordered
      .slice(0, messageIndex + 1)
      .filter((node) => cleanAnchorText(node?.role).toLowerCase() === role)
      .length - 1;
  }

  return {
    messageId,
    role,
    preview: cleanAnchorText(supplied.preview || fullText.slice(0, 220)),
    tail: cleanAnchorText(supplied.tail || fullText.slice(-180)),
    textLength: Number.isFinite(supplied.textLength) ? supplied.textLength : fullText.length,
    messageIndex: Number.isInteger(supplied.messageIndex) ? supplied.messageIndex : messageIndex,
    roleIndex
  };
}

export default function App() {
  const {
    conversationData,
    isLoading,
    error,
    refreshData,
    activeConversationId
  } = useConversationData();

  // Keep the upstream floating/embedded shell minimally compatible: it only
  // needs a readiness signal and a refresh command now that there are no view modes.
  useEffect(() => {
    if (!IS_EMBEDDED) return undefined;

    const handler = (event) => {
      const data = event?.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'CG_REFRESH') refreshData();
      if (data.type === 'CG_REQUEST_VIEW_MODE') {
        try {
          event.source?.postMessage({ type: 'CG_VIEW_MODE', payload: { mode: 'research' } }, '*');
        } catch {
          // ignore
        }
      }
    };

    window.addEventListener('message', handler);
    try {
      window.parent?.postMessage({ type: 'CG_READY' }, '*');
      window.parent?.postMessage({ type: 'CG_VIEW_MODE', payload: { mode: 'research' } }, '*');
    } catch {
      // ignore
    }

    return () => window.removeEventListener('message', handler);
  }, [refreshData]);

  const jumpToResearchMessage = useCallback((input) => {
    const supplied = input && typeof input === 'object' ? input : { messageId: input };
    const anchor = buildMessageAnchor(conversationData, supplied) || supplied;
    if (!anchor?.messageId) return Promise.resolve(false);

    return jumpToResearchSource(anchor).then((success) => {
      if (!success) {
        console.warn('[ResearchBlackboard] Source not safely locatable:', anchor.messageId);
      }
      return success;
    });
  }, [conversationData]);

  const renderEmptyState = () => (
    <div className="empty-state">
      <div className="empty-icon">
        <img
          src={chrome.runtime.getURL('assets/icon128.png')}
          alt="ChatGPT Research Blackboard"
          style={{ width: '64px', height: '64px' }}
        />
      </div>
      <h2>Open a ChatGPT conversation</h2>
      <p>The Research Blackboard follows the active ChatGPT conversation.</p>
      {activeConversationId && (
        <button type="button" onClick={refreshData} disabled={isLoading}>
          {isLoading ? 'Refreshing…' : 'Refresh source data'}
        </button>
      )}
    </div>
  );

  const renderError = () => (
    <div className="error-message">
      <p>{error}</p>
      <button type="button" onClick={refreshData}>Retry</button>
    </div>
  );

  return (
    <div className={'app' + (IS_EMBEDDED ? ' embedded' : '')}>
      {!IS_EMBEDDED && <Header onRefresh={refreshData} isLoading={isLoading} />}
      <main className="main-content">
        {error
          ? renderError()
          : conversationData
            ? (
              <ResearchBlackboard
                conversationData={conversationData}
                onJumpToMessage={jumpToResearchMessage}
              />
            )
            : renderEmptyState()}
      </main>
    </div>
  );
}
