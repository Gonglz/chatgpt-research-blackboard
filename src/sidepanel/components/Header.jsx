/**
 * Minimal top toolbar (sidepanel only).
 *
 * Views:
 * - Graph: raw ChatGPT conversation graph
 * - Tree: git-style conversation branches
 * - Research: semantic Research Blackboard
 */

import React from 'react';

const iconUrl = (name) => chrome.runtime.getURL(`assets/${name}`);

export default function Header({
  onRefresh,
  isLoading,
  viewMode = 'graph',
  onViewModeChange,
  miniMapVisible = false,
  onToggleMiniMap
}) {
  return (
    <header
      className="header header-toolbar"
      aria-label="ChatGPT Graph Toolbar"
      style={{ minHeight: 38, height: 38, padding: '4px 8px', flexWrap: 'nowrap', gap: 7 }}
    >
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

      <div className="header-toolbar-right" style={{ gap: 6 }}>
        {viewMode === 'research' && (
          <span
            title="Automatic graph maintenance is active while this sidecar is open"
            aria-label="Research auto mode live"
            style={{
              border: '1px solid #16a34a',
              background: '#f0fdf4',
              color: '#166534',
              borderRadius: 999,
              padding: '2px 7px',
              fontSize: 9.5,
              lineHeight: '14px',
              fontWeight: 700,
              whiteSpace: 'nowrap'
            }}
          >
            ● Live
          </span>
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
