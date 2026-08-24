/**
 * Side Panel main application.
 */
import React, { useEffect, useCallback, useState } from 'react';
import ConversationGraph from './components/ConversationGraph';
import GitTreeView from './components/GitTreeView';
import ResearchBlackboard from './components/ResearchBlackboard';
import Header from './components/Header';
import { useConversationData } from './hooks/useConversationData';
import { useQATree, useBranchChangeListener } from './hooks/useQATree';
import { MESSAGE_TYPES } from '../shared/constants.js';

const IS_EMBEDDED = (() => {
  try {
    return new URLSearchParams(window.location.search).get('embedded') === '1';
  } catch {
    return false;
  }
})();

const MINIMAP_VISIBLE_KEY = IS_EMBEDDED ? 'cg:minimap:visible:embedded' : 'cg:minimap:visible:sidebar';

function cleanAnchorText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function fallbackJumpToMessage(anchor) {
  if (!anchor?.messageId && !anchor?.preview) return false;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return false;
    if (!tab.url?.includes('chatgpt.com') && !tab.url?.includes('chat.openai.com')) return false;

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [anchor],
      func: (payload) => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const escapeValue = (value) => (
          window.CSS?.escape
            ? window.CSS.escape(value)
            : String(value).replace(/["\\]/g, '\\$&')
        );

        const messageId = payload?.messageId || '';
        const expectedRole = normalize(payload?.role).toLowerCase();
        const preview = normalize(payload?.preview);

        const findContainer = (node) => {
          if (!node) return null;
          if (node.matches?.('section[data-turn-id], article')) return node;
          return node.closest?.('section[data-turn-id], article') || node;
        };

        const highlightAndScroll = (element, method) => {
          const target = findContainer(element);
          if (!target) return { success: false, method };

          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const previousOutline = target.style.outline;
          const previousOutlineOffset = target.style.outlineOffset;
          target.style.outline = '2px solid rgba(59, 130, 246, 0.75)';
          target.style.outlineOffset = '4px';
          window.setTimeout(() => {
            target.style.outline = previousOutline;
            target.style.outlineOffset = previousOutlineOffset;
          }, 1400);
          return { success: true, method };
        };

        if (messageId) {
          const escaped = escapeValue(messageId);
          const exact =
            document.querySelector(`[data-message-id="${escaped}"]`) ||
            document.querySelector(`[data-turn-id="${escaped}"]`) ||
            document.querySelector(`[id="image-${escaped}"]`);
          if (exact) return highlightAndScroll(exact, 'exact-id-fallback');
        }

        if (!preview) return { success: false, method: 'no-preview' };

        const needle = preview.slice(0, 160);
        const shortNeedle = needle.slice(0, Math.min(80, needle.length));
        const containers = Array.from(document.querySelectorAll('section[data-turn-id], article'));
        let best = null;
        let bestScore = 0;

        for (const container of containers) {
          const roleNode = container.matches?.('[data-message-author-role]')
            ? container
            : container.querySelector?.('[data-message-author-role]');
          const candidateRole = normalize(roleNode?.getAttribute?.('data-message-author-role')).toLowerCase();

          if (expectedRole && candidateRole && expectedRole !== candidateRole) continue;

          const text = normalize(container.innerText || container.textContent || '');
          if (!text) continue;

          let score = 0;
          if (text.includes(needle)) score = 4;
          else if (shortNeedle.length >= 24 && text.includes(shortNeedle)) score = 3;
          else {
            const candidatePrefix = text.slice(0, 80);
            if (candidatePrefix.length >= 24 && needle.includes(candidatePrefix)) score = 2;
          }

          if (score > bestScore) {
            best = container;
            bestScore = score;
          }
        }

        if (best) return highlightAndScroll(best, 'text-role-fallback');
        return { success: false, method: 'not-found' };
      }
    });

    const result = results?.[0]?.result;
    console.log('[SidePanel] Fallback jump result:', result);
    return !!result?.success;
  } catch (error) {
    console.warn('[SidePanel] Fallback jump failed:', error);
    return false;
  }
}

function App() {
  const [viewMode, setViewMode] = useState('graph');

  const [miniMapVisible, setMiniMapVisible] = useState(() => {
    try {
      const saved = localStorage.getItem(MINIMAP_VISIBLE_KEY);
      if (saved === '0') return false;
      if (saved === '1') return true;
    } catch {
      // ignore
    }
    return !IS_EMBEDDED;
  });

  useEffect(() => {
    try {
      localStorage.setItem(MINIMAP_VISIBLE_KEY, miniMapVisible ? '1' : '0');
    } catch {
      // ignore
    }
  }, [miniMapVisible]);

  const toggleMiniMap = useCallback(() => {
    setMiniMapVisible((v) => !v);
  }, []);

  const {
    conversationData,
    isLoading,
    error,
    refreshData,
    currentNodeId,
    setCurrentNodeId
  } = useConversationData();

  // Embedded mode: allow the parent floating panel to control the legacy views.
  useEffect(() => {
    if (!IS_EMBEDDED) return;

    const handler = (event) => {
      const data = event?.data;
      if (!data || typeof data !== 'object') return;
      const { type, payload } = data;
      if (type === 'CG_SET_VIEW_MODE' && payload?.mode) {
        setViewMode(String(payload.mode));
      } else if (type === 'CG_REFRESH') {
        refreshData();
      } else if (type === 'CG_REQUEST_VIEW_MODE') {
        try {
          event.source?.postMessage({ type: 'CG_VIEW_MODE', payload: { mode: viewMode } }, '*');
        } catch {
          // ignore
        }
      } else if (type === 'CG_TOGGLE_MINIMAP') {
        toggleMiniMap();
      } else if (type === 'CG_REQUEST_MINIMAP_STATE') {
        try {
          event.source?.postMessage({ type: 'CG_MINIMAP_STATE', payload: { visible: miniMapVisible } }, '*');
        } catch {
          // ignore
        }
      }
    };

    window.addEventListener('message', handler);
    try {
      window.parent?.postMessage({ type: 'CG_READY' }, '*');
      window.parent?.postMessage({ type: 'CG_VIEW_MODE', payload: { mode: viewMode } }, '*');
      window.parent?.postMessage({ type: 'CG_MINIMAP_STATE', payload: { visible: miniMapVisible } }, '*');
    } catch {
      // ignore
    }

    return () => window.removeEventListener('message', handler);
  }, [viewMode, refreshData, miniMapVisible, toggleMiniMap]);

  useEffect(() => {
    if (!IS_EMBEDDED) return;
    try {
      window.parent?.postMessage({ type: 'CG_VIEW_MODE', payload: { mode: viewMode } }, '*');
    } catch {
      // ignore
    }
  }, [viewMode]);

  useEffect(() => {
    if (!IS_EMBEDDED) return;
    try {
      window.parent?.postMessage({ type: 'CG_MINIMAP_STATE', payload: { visible: miniMapVisible } }, '*');
    } catch {
      // ignore
    }
  }, [miniMapVisible]);

  // Persist view mode, including the new semantic Research view.
  useEffect(() => {
    (async () => {
      try {
        const res = await chrome.storage.local.get(['sidepanelViewMode']);
        if (res.sidepanelViewMode) setViewMode(res.sidepanelViewMode);
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    try {
      chrome.storage.local.set({ sidepanelViewMode: viewMode });
    } catch {
      // ignore
    }
  }, [viewMode]);

  const {
    tree,
    selectedPath,
    activeLeafId,
    selectNode,
    isNodeSelected,
    stats: treeStats,
    printTree,
    isReady: isTreeReady
  } = useQATree(
    conversationData?.nodes || null,
    conversationData?.edges || null,
    { debug: true }
  );

  useBranchChangeListener(useCallback((nodeId) => {
    console.log('[App] External branch change:', nodeId);
    selectNode(nodeId);
  }, [selectNode]));

  useEffect(() => {
    window.__qaTree = tree;
    window.__printTree = printTree;
    window.__treeStats = treeStats;
    window.__conversationData = conversationData;
  }, [tree, printTree, treeStats, conversationData]);

  const jumpToMessage = useCallback((messageId) => {
    if (!messageId) return;

    const sourceNode = Array.isArray(conversationData?.nodes)
      ? conversationData.nodes.find((node) => node?.id === messageId)
      : null;
    const anchor = {
      messageId,
      role: sourceNode?.role || null,
      preview: cleanAnchorText(sourceNode?.content || '').slice(0, 180)
    };

    console.log('[SidePanel] Sending SCROLL_TO_MESSAGE for:', messageId);

    const runFallback = () => {
      if (!anchor.preview) return;
      void fallbackJumpToMessage(anchor);
    };

    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SCROLL_TO_MESSAGE,
      payload: { messageId }
    }, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        console.error('[SidePanel] sendMessage error:', runtimeError);
        runFallback();
        return;
      }

      console.log('[SidePanel] sendMessage response:', response);

      // Background wraps the content-script response as { success: true, data: ... }.
      // Trigger the semantic fallback when the content script explicitly reports failure.
      if (response?.success === false || response?.data?.success === false) {
        runFallback();
      }
    });
  }, [conversationData]);

  const handleNodeClick = useCallback((nodeId, nodeData) => {
    console.log('[SidePanel] Node clicked:', nodeId, nodeData);
    setCurrentNodeId(nodeId);
    selectNode(nodeId);
    jumpToMessage(nodeData?.messageId || nodeId);
  }, [setCurrentNodeId, selectNode, jumpToMessage]);

  const handleNodeDoubleClick = useCallback((nodeId, nodeData) => {
    console.log('[SidePanel] Node double-clicked:', nodeId, nodeData);
  }, []);

  const handleNodeContextMenu = useCallback((event, nodeId, nodeData) => {
    event.preventDefault();
    console.log('[SidePanel] Node context menu:', nodeId, nodeData);
  }, []);

  const renderEmptyState = () => (
    <div className="empty-state">
      <div className="empty-icon">
        <img src={chrome.runtime.getURL('assets/icon128.png')} alt="ChatGPT Graph" style={{ width: '64px', height: '64px' }} />
      </div>
      <h2>No Conversation Loaded</h2>
      <p>Open a ChatGPT conversation to see its graph structure</p>
    </div>
  );

  const renderError = () => (
    <div className="error-message">
      <p>{error}</p>
      <button onClick={refreshData}>Retry</button>
    </div>
  );

  const renderContent = () => {
    // Research Blackboard uses raw conversation messages as anchors and does not
    // depend on the legacy QA-tree transformation being ready.
    if (viewMode === 'research') {
      return (
        <ResearchBlackboard
          conversationData={conversationData}
          onJumpToMessage={jumpToMessage}
        />
      );
    }

    if (!isTreeReady) {
      return (
        <div className="empty-state">
          <div className="empty-icon">⏳</div>
          <h2>Building Tree...</h2>
          <p>Please wait while the conversation tree is being constructed</p>
        </div>
      );
    }

    if (viewMode === 'tree') {
      return (
        <GitTreeView
          qaTree={tree}
          selectedPath={selectedPath}
          currentNodeId={currentNodeId}
          onNodeClick={handleNodeClick}
          showPanelControls={false}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onRefresh={refreshData}
          isLoading={isLoading}
        />
      );
    }

    return (
      <ConversationGraph
        qaTree={tree}
        selectedPath={selectedPath}
        currentNodeId={currentNodeId}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeContextMenu={handleNodeContextMenu}
        showMiniMap={miniMapVisible}
        onToggleMiniMap={toggleMiniMap}
      />
    );
  };

  return (
    <div className={'app' + (IS_EMBEDDED ? ' embedded' : '')}>
      {!IS_EMBEDDED && (
        <Header
          onRefresh={refreshData}
          isLoading={isLoading}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          miniMapVisible={miniMapVisible}
          onToggleMiniMap={toggleMiniMap}
        />
      )}

      <main className="main-content">
        {error ? renderError() :
          !conversationData ? renderEmptyState() :
          renderContent()}
      </main>
    </div>
  );
}

export default App;
