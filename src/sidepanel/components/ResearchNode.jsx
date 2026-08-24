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

  return (
    <div
      style={{
        width: 190,
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
        {data.messageId ? (
          <span title="Anchored to a ChatGPT message" style={{ fontSize: 11, opacity: 0.65 }}>↗ chat</span>
        ) : null}
      </div>

      <div style={{ marginTop: 6, fontSize: 13, fontWeight: 700, lineHeight: 1.35, wordBreak: 'break-word' }}>
        {data.title || 'Untitled research node'}
      </div>

      {data.checkpoint ? (
        <div style={{ marginTop: 7, fontSize: 11, lineHeight: 1.4, color: '#475569' }}>
          {data.checkpoint.length > 110 ? `${data.checkpoint.slice(0, 110)}…` : data.checkpoint}
        </div>
      ) : null}

      <Handle type="source" position={Position.Bottom} style={{ background: meta.accent }} />
    </div>
  );
}

export default memo(ResearchNode);
