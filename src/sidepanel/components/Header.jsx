/**
 * Minimal top toolbar (sidepanel only).
 *
 * Views:
 * - Graph: raw ChatGPT conversation graph
 * - Tree: git-style conversation branches
 * - Research: semantic Research Blackboard
 */

import React, { useEffect, useState } from 'react';

const iconUrl = (name) => chrome.runtime.getURL(`assets/${name}`);
const AUTO_GRAPH_PREFIX = 'researchAutoGraphEnabled:';

function conversationKeyFromUrl(url) {
  try {
    const parsed = new URL(url || '');
    const match = parsed.pathname.match(/\/c\/([a-zA-Z0-9-]+)/);
    return `${AUTO_GRAPH_PREFIX}${match?.[1] || 'new'}`;
  } catch {
    return `${AUTO_GRAPH_PREFIX}new`;
  }
}

async function getActiveConversationKey() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return conversationKeyFromUrl(tab?.url || '');
  } catch {
    return `${AUTO_GRAPH_PREFIX}new`;
  }
}

export default function Header({
  onRefresh,
  isLoading,
  viewMode = 'graph',
  onViewModeChange,
  miniMapVisible = false,
  onToggleMiniMap
}) {
  const [autoGraphEnabled, setAutoGraphEnabled] = useState(false);
  const [autoGraphKey, setAutoGraphKey] = useState(`${AUTO_GRAPH_PREFIX}new`);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      const key = await getActiveConversationKey();
      const newKey = `${AUTO_GRAPH_PREFIX}new`;
      const result = await chrome.storage.local.get(key === newKey ? [key] : [key, newKey]);
      if (cancelled) return;

      let enabled = result?.[key] === true;

      // ChatGPT assigns /c/<id> after the first send. Preserve the staged Auto
      // choice immediately so the button never appears to switch itself off.
      // ResearchConversationSyncBridge later clears the one-shot `new` key.
      if (!enabled && key !== newKey && result?.[newKey] === true) {
        enabled = true;
        await chrome.storage.local.set({ [key]: true }).catch(() => {});
      }

      if (cancelled) return;
      setAutoGraphKey(key);
      setAutoGraphEnabled(enabled);
    };

    void refresh();

    const storageListener = (changes, area) => {
      if (area !== 'local') return;
      if (changes?.[autoGraphKey]) {
        setAutoGraphEnabled(changes[autoGraphKey].newValue === true);
      }
      if (changes?.[`${AUTO_GRAPH_PREFIX}new`]) {
        void refresh();
      }
    };
    chrome.storage.onChanged.addListener(storageListener);

    const tabListener = () => void refresh();
    chrome.tabs?.onActivated?.addListener(tabListener);
    chrome.tabs?.onUpdated?.addListener(tabListener);

    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(storageListener);
      chrome.tabs?.onActivated?.removeListener(tabListener);
      chrome.tabs?.onUpdated?.removeListener(tabListener);
    };
  }, [autoGraphKey]);

  const toggleAutoGraph = async () => {
    const key = await getActiveConversationKey();
    const next = key === autoGraphKey ? !autoGraphEnabled : true;
    setAutoGraphKey(key);
    setAutoGraphEnabled(next);
    chrome.storage.local.set({ [key]: next }).catch(() => {});
  };

  return (
    <header className="header header-toolbar" aria-label="ChatGPT Graph Toolbar">
      <div className="header-toolbar-left">
        <div className="view-toggle" role="tablist" aria-label="View mode">
          <button
            className={'view-toggle-btn' + (viewMode === 'graph' ? ' active' : '')}
            onClick={() => onViewModeChange?.('graph')}
            title="Conversation graph"
            aria-label="Conversation graph"
            type="button"
          >
            <img className="toolbar-icon" src={iconUrl('graph.svg')} alt="Graph" />
          </button>
          <button
            className={'view-toggle-btn' + (viewMode === 'tree' ? ' active' : '')}
            onClick={() => onViewModeChange?.('tree')}
            title="Conversation tree"
            aria-label="Conversation tree"
            type="button"
          >
            <img className="toolbar-icon" src={iconUrl('tree.svg')} alt="Tree" />
          </button>
          <button
            className={'view-toggle-btn' + (viewMode === 'research' ? ' active' : '')}
            onClick={() => onViewModeChange?.('research')}
            title="Research Blackboard"
            aria-label="Research Blackboard"
            type="button"
          >
            <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>⌘</span>
          </button>
        </div>
      </div>

      <div className="header-toolbar-right">
        {viewMode === 'research' && (
          <button
            type="button"
            onClick={toggleAutoGraph}
            title={autoGraphEnabled ? 'Pause automatic graph maintenance for this chat' : 'Enable automatic graph maintenance for this chat'}
            aria-label={autoGraphEnabled ? 'Auto graph on for this chat' : 'Auto graph off for this chat'}
            style={{
              border: `1px solid ${autoGraphEnabled ? '#16a34a' : '#cbd5e1'}`,
              background: autoGraphEnabled ? '#ecfdf5' : '#fff',
              color: autoGraphEnabled ? '#166534' : '#64748b',
              borderRadius: 999,
              padding: '4px 8px',
              fontSize: 10,
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            {autoGraphEnabled ? '● Auto' : '○ Auto'}
          </button>
        )}

        {viewMode === 'graph' && typeof onToggleMiniMap === 'function' && (
          <button
            className={'minimap-btn' + (miniMapVisible ? ' active' : '')}
            onClick={onToggleMiniMap}
            title={miniMapVisible ? 'Hide minimap' : 'Show minimap'}
            aria-label={miniMapVisible ? 'Hide minimap' : 'Show minimap'}
            type="button"
          >
            <img className="toolbar-icon" src={iconUrl('minimap.svg')} alt="Minimap" />
          </button>
        )}
        <button
          className="refresh-btn icon-btn"
          onClick={onRefresh}
          disabled={isLoading}
          title="Refresh"
          aria-label="Refresh"
          type="button"
        >
          <span className={isLoading ? 'spinning' : ''}>
            <img className="toolbar-icon" src={iconUrl('fresh.svg')} alt="Refresh" />
          </span>
        </button>
      </div>
    </header>
  );
}
