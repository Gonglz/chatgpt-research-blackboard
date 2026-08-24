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
const AUTO_GRAPH_KEY = 'researchAutoGraphEnabled';

export default function Header({
  onRefresh,
  isLoading,
  viewMode = 'graph',
  onViewModeChange,
  miniMapVisible = false,
  onToggleMiniMap
}) {
  const [autoGraphEnabled, setAutoGraphEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    chrome.storage.local.get([AUTO_GRAPH_KEY]).then((result) => {
      if (!cancelled) setAutoGraphEnabled(result?.[AUTO_GRAPH_KEY] === true);
    }).catch(() => {});

    const listener = (changes, area) => {
      if (area !== 'local' || !changes?.[AUTO_GRAPH_KEY]) return;
      setAutoGraphEnabled(changes[AUTO_GRAPH_KEY].newValue === true);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);

  const toggleAutoGraph = () => {
    const next = !autoGraphEnabled;
    setAutoGraphEnabled(next);
    chrome.storage.local.set({ [AUTO_GRAPH_KEY]: next }).catch(() => {});
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
            title={autoGraphEnabled ? 'Pause automatic Research Blackboard hints' : 'Enable automatic Research Blackboard hints'}
            aria-label={autoGraphEnabled ? 'Auto graph on' : 'Auto graph off'}
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
