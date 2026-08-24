/**
 * Research Blackboard semantic node.
 * A research node represents a question/analysis/comparison/judgment,
 * not a raw ChatGPT message.
 */
import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';

const TYPE_META = {
  analysis: { label: 'Analysis', accent: '#2563eb', bg: '#eff6ff' },
  comparison: { label: 'Compare', accent: '#7c3aed', bg: '#f5f3ff' },
  judgment: { label: 'Judgment', accent: '#059669', bg: '#ecfdf5' },
  question: { label: 'Question', accent: '#d97706', bg: '#fffbeb' }
};

function ResearchNode({ data, selected }) {
  const meta = TYPE_META[data.type] || TYPE_META.analysis;
  const keywords = Array.isArray(data.keywords) ? data.keywords.slice(0, 3) : [];
  const highlights = Array.isArray(data.highlights) ? data.highlights : [];
  const highlightCount = highlights.length;
  const visibleHighlights = selected ? highlights.slice(0, 3) : [];

  return (
    <div
      style={{
        width: 196,
        borderRadius: 12,
        border: `${selected ? 3 : 1}px solid ${selected ? '#111827' : meta.accent}`,
        background: meta.bg,
        padding: '10px 12px',
        boxShadow: selected ? '0 0 0 3px rgba(17, 24, 39, 0.10)' : '0 2px 8px rgba(15, 23, 42, 0.08)',
        color: '#0f172a'
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: meta.accent }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: meta.accent }}>
          {meta.label}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {highlightCount ? (
            <span title={`${highlightCount} saved highlight${highlightCount === 1 ? '' : 's'}`} style={{ fontSize: 10, fontWeight: 700, color: '#64748b' }}>
              ★ {highlightCount}
            </span>
          ) : null}
          {data.messageId ? (
            <span title="Anchored to a ChatGPT message" style={{ fontSize: 11, opacity: 0.65 }}>↗ chat</span>
          ) : null}
        </div>
      </div>

      <div
        title={data.title || 'Untitled research node'}
        style={{
          marginTop: 6,
          fontSize: 13,
          fontWeight: 700,
          lineHeight: 1.35,
          wordBreak: 'break-word',
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: 3,
          overflow: 'hidden'
        }}
      >
        {data.title || 'Untitled research node'}
      </div>

      {keywords.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 7 }}>
          {keywords.map((keyword) => (
            <span
              key={keyword}
              style={{
                maxWidth: 110,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                border: `1px solid ${meta.accent}33`,
                background: '#ffffffaa',
                borderRadius: 999,
                padding: '2px 5px',
                fontSize: 9,
                lineHeight: 1.2,
                color: '#475569'
              }}
            >
              {keyword}
            </span>
          ))}
        </div>
      ) : null}

      {data.checkpoint ? (
        <div
          style={{
            marginTop: 7,
            paddingTop: 7,
            borderTop: '1px solid rgba(148, 163, 184, 0.24)',
            fontSize: 11,
            lineHeight: 1.4,
            color: '#475569'
          }}
        >
          {data.checkpoint.length > 110 ? `${data.checkpoint.slice(0, 110)}…` : data.checkpoint}
        </div>
      ) : null}

      {visibleHighlights.length ? (
        <div style={{ marginTop: 8, paddingTop: 7, borderTop: '1px solid rgba(148, 163, 184, 0.28)' }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>
            Highlights {highlightCount}
          </div>
          {visibleHighlights.map((highlight) => (
            <div
              key={highlight.id || highlight.quote}
              title={highlight.quote || ''}
              style={{
                marginTop: 4,
                padding: '5px 6px',
                borderRadius: 6,
                background: 'rgba(255,255,255,.72)',
                fontSize: 9.5,
                lineHeight: 1.35,
                color: '#475569',
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: 3,
                overflow: 'hidden'
              }}
            >
              ★ “{highlight.quote || ''}”
            </div>
          ))}
          {highlightCount > visibleHighlights.length ? (
            <div style={{ marginTop: 4, fontSize: 9, color: '#94a3b8' }}>
              +{highlightCount - visibleHighlights.length} more
            </div>
          ) : null}
        </div>
      ) : null}

      <Handle type="source" position={Position.Bottom} style={{ background: meta.accent }} />
    </div>
  );
}

export default memo(ResearchNode);
