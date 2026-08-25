import React from 'react';
import ResearchExportButton from './ResearchExportButton';
import ResearchProjectSelector from './ResearchProjectSelector';

const iconUrl = (name) => chrome.runtime.getURL(`assets/${name}`);

export default function Header({ onRefresh, isLoading }) {
  return (
    <header
      className="header header-toolbar"
      aria-label="Research Blackboard toolbar"
      style={{ minHeight: 38, height: 38, padding: '4px 8px', flexWrap: 'nowrap', gap: 7 }}
    >
      <div className="header-toolbar-left" style={{ minWidth: 0 }}>
        <strong
          style={{
            fontSize: 11.5,
            lineHeight: '16px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          ChatGPT Research Blackboard
        </strong>
      </div>

      <div className="header-toolbar-right" style={{ gap: 6, minWidth: 0 }}>
        <ResearchProjectSelector />
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
        <ResearchExportButton />
        <button
          className="refresh-btn icon-btn"
          onClick={onRefresh}
          disabled={isLoading}
          title="Refresh conversation source data"
          aria-label="Refresh conversation source data"
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
