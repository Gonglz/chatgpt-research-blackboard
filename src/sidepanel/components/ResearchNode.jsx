/**
 * Compact semantic node for Research Blackboard.
 *
 * Canvas nodes are intentionally identifiers, not detail containers:
 * - fixed footprint for spatial stability
 * - title + type + compact keywords + highlight count only
 * - checkpoint is available through delayed hover preview / detail drawer
 */
import React, { memo, useEffect, useRef, useState } from 'react';
import { Handle, Position, useStore } from '@xyflow/react';

const TYPE_META = {
  analysis: { label: 'Analysis', accent: '#2563eb' },
  comparison: { label: 'Compare', accent: '#7c3aed' },
  judgment: { label: 'Judgment', accent: '#059669' },
  question: { label: 'Question', accent: '#d97706' }
};

const FONT_STACK = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const HOVER_DELAY_MS = 450;
const POINTER_STABILITY_PX = 4;

function ResearchNode({ data, selected }) {
  const meta = TYPE_META[data.type] || TYPE_META.analysis;
  const highlights = Array.isArray(data.highlights) ? data.highlights : [];
  const keywords = Array.isArray(data.keywords) ? data.keywords.slice(0, 3) : [];
  const zoom = useStore((state) => state.transform?.[2] ?? 1);
  const farZoom = zoom < 0.62;

  const [previewVisible, setPreviewVisible] = useState(false);
  const timerRef = useRef(null);
  const pointerRef = useRef(null);

  const clearPreviewTimer = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const schedulePreview = () => {
    if (selected) return;
    clearPreviewTimer();
    timerRef.current = window.setTimeout(() => {
      setPreviewVisible(true);
    }, HOVER_DELAY_MS);
  };

  useEffect(() => () => clearPreviewTimer(), []);

  useEffect(() => {
    if (!selected) return;
    clearPreviewTimer();
    setPreviewVisible(false);
  }, [selected]);

  const handlePointerEnter = (event) => {
    pointerRef.current = { x: event.clientX, y: event.clientY };
    setPreviewVisible(false);
    schedulePreview();
  };

  const handlePointerMove = (event) => {
    if (selected) return;
    const previous = pointerRef.current;
    if (!previous) {
      pointerRef.current = { x: event.clientX, y: event.clientY };
      return;
    }

    const moved = Math.hypot(event.clientX - previous.x, event.clientY - previous.y);
    if (moved >= POINTER_STABILITY_PX) {
      pointerRef.current = { x: event.clientX, y: event.clientY };
      if (previewVisible) setPreviewVisible(false);
      schedulePreview();
    }
  };

  const handlePointerLeave = () => {
    clearPreviewTimer();
    pointerRef.current = null;
    setPreviewVisible(false);
  };

  return (
    <div
      onPointerEnter={handlePointerEnter}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      style={{
        position: 'relative',
        boxSizing: 'border-box',
        width: 200,
        height: 88,
        borderRadius: 10,
        border: `${selected ? 2 : 1}px solid ${selected ? '#111827' : '#cbd5e1'}`,
        borderTop: `3px solid ${meta.accent}`,
        background: '#ffffff',
        padding: farZoom ? '12px 11px 9px' : '8px 11px 9px',
        boxShadow: selected
          ? '0 0 0 3px rgba(17, 24, 39, 0.10), 0 8px 22px rgba(15,23,42,.10)'
          : '0 2px 8px rgba(15, 23, 42, 0.07)',
        color: '#111827',
        fontFamily: FONT_STACK,
        overflow: 'visible'
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: meta.accent, width: 7, height: 7, border: '1px solid #fff' }} />

      {!farZoom ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 14, gap: 8 }}>
          <span style={{ fontSize: 10.5, lineHeight: '14px', fontWeight: 700, letterSpacing: '.035em', textTransform: 'uppercase', color: meta.accent }}>
            {meta.label}
          </span>
          {highlights.length ? (
            <span title={`${highlights.length} saved highlights`} style={{ fontSize: 11, lineHeight: '14px', fontWeight: 650, color: '#64748b' }}>
              ★ {highlights.length}
            </span>
          ) : null}
        </div>
      ) : null}

      <div
        title={data.title || 'Untitled research node'}
        style={{
          marginTop: farZoom ? 6 : 3,
          minHeight: farZoom ? 37 : 38,
          fontSize: 14,
          fontWeight: 600,
          lineHeight: '18px',
          letterSpacing: '-0.005em',
          color: '#111827',
          wordBreak: 'break-word',
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: 2,
          overflow: 'hidden'
        }}
      >
        {data.title || 'Untitled research node'}
      </div>

      {!farZoom ? (
        <div
          style={{
            marginTop: 2,
            minHeight: 15,
            fontSize: 11.5,
            lineHeight: '15px',
            color: '#64748b',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
          title={keywords.join(' · ')}
        >
          {keywords.length ? keywords.join(' · ') : (highlights.length ? `${highlights.length} saved highlight${highlights.length === 1 ? '' : 's'}` : ' ')}
        </div>
      ) : highlights.length ? (
        <div style={{ position: 'absolute', right: 10, bottom: 7, fontSize: 10.5, color: '#64748b', fontWeight: 650 }}>
          ★ {highlights.length}
        </div>
      ) : null}

      {!selected && previewVisible && (data.checkpoint || highlights.length) ? (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            left: 'calc(100% + 10px)',
            top: 2,
            width: 250,
            pointerEvents: 'none',
            zIndex: 80,
            border: '1px solid #dbe3ee',
            borderRadius: 10,
            background: 'rgba(255,255,255,.98)',
            boxShadow: '0 12px 30px rgba(15,23,42,.16)',
            padding: '10px 11px',
            color: '#334155',
            fontFamily: FONT_STACK
          }}
        >
          <div style={{ fontSize: 13, lineHeight: '18px', fontWeight: 600, color: '#111827' }}>
            {data.title || 'Untitled research node'}
          </div>
          {data.checkpoint ? (
            <div style={{ marginTop: 6, fontSize: 12.5, lineHeight: '18px', color: '#475569' }}>
              {data.checkpoint.length > 230 ? `${data.checkpoint.slice(0, 230)}…` : data.checkpoint}
            </div>
          ) : null}
          {highlights.length ? (
            <div style={{ marginTop: 7, fontSize: 11.5, lineHeight: '16px', color: '#64748b', fontWeight: 600 }}>
              ★ {highlights.length} highlight{highlights.length === 1 ? '' : 's'}
            </div>
          ) : null}
        </div>
      ) : null}

      <Handle type="source" position={Position.Bottom} style={{ background: meta.accent, width: 7, height: 7, border: '1px solid #fff' }} />
    </div>
  );
}

export default memo(ResearchNode);
