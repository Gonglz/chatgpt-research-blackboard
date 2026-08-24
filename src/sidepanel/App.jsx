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
    console.log('[SidePanel] Sending SCROLL_TO_MESSAGE for:', messageId);

    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SCROLL_TO_MESSAGE,
      payload: { messageId }
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[SidePanel] sendMessage error:', chrome.runtime.lastError);
      } else {
        console.log('[SidePanel] sendMessage response:', response);
      }
    });
  }, []);

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
