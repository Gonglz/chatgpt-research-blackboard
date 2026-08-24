/**
 * Compact semantic node for Research Blackboard.
 *
 * Canvas nodes are intentionally identifiers, not detail containers:
 * - fixed footprint for spatial stability
 * - title + type + compact keywords + highlight count only
 * - checkpoint is available through delayed hover preview / detail drawer
 * - top/bottom ports carry structural backbone edges
 * - left/right ports carry contextual lateral relations
 */
import React, { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
const PREVIEW_WIDTH = 260;
const PREVIEW_GAP = 10;
const PREVIEW_MARGIN = 8;
const HIDDEN_PORT_STYLE = {
  width: 7,
  height: 7,
  opacity: 0,
  border: 0,
  background: 'transparent',
  pointerEvents: 'none'
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function ResearchNode({ id, data, selected }) {
  const meta = TYPE_META[data.type] || TYPE_META.analysis;
  const highlights = Array.isArray(data.highlights) ? data.highlights : [];
  const keywords = Array.isArray(data.keywords) ? data.keywords.slice(0, 3) : [];
  const zoom = useStore((state) => state.transform?.[2] ?? 1);
  const farZoom = zoom < 0.62;

  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewPosition, setPreviewPosition] = useState(null);
  const timerRef = useRef(null);
  const pointerRef = useRef(null);
  const nodeRef = useRef(null);

  const clearPreviewTimer = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const resolvePreviewPosition = () => {
    const rect = nodeRef.current?.getBoundingClientRect?.();
    if (!rect) return null;

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || PREVIEW_WIDTH + PREVIEW_MARGIN * 2;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 600;
    const estimatedHeight = data.checkpoint ? 190 : 110;

    let left = rect.right + PREVIEW_GAP;
    let side = 'right';

    if (left + PREVIEW_WIDTH > viewportWidth - PREVIEW_MARGIN) {
      const leftCandidate = rect.left - PREVIEW_WIDTH - PREVIEW_GAP;
      if (leftCandidate >= PREVIEW_MARGIN) {
        left = leftCandidate;
        side = 'left';
      } else {
        left = clamp(rect.left, PREVIEW_MARGIN, Math.max(PREVIEW_MARGIN, viewportWidth - PREVIEW_WIDTH - PREVIEW_MARGIN));
        side = 'overlay';
      }
    }

    const top = clamp(
      rect.top,
      PREVIEW_MARGIN,
      Math.max(PREVIEW_MARGIN, viewportHeight - estimatedHeight - PREVIEW_MARGIN)
    );

    return { left, top, side };
  };

  const schedulePreview = () => {
    if (selected) return;
    clearPreviewTimer();
    timerRef.current = window.setTimeout(() => {
      const position = resolvePreviewPosition();
      if (!position) return;
      setPreviewPosition(position);
      setPreviewVisible(true);
    }, HOVER_DELAY_MS);
  };

  useEffect(() => () => clearPreviewTimer(), []);

  useEffect(() => {
    if (!selected) return;
    clearPreviewTimer();
    setPreviewVisible(false);
    setPreviewPosition(null);
  }, [selected]);

  const handlePointerEnter = (event) => {
    pointerRef.current = { x: event.clientX, y: event.clientY };
    data?.onHoverChange?.(id);
    setPreviewVisible(false);
    setPreviewPosition(null);
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
      setPreviewPosition(null);
      schedulePreview();
    }
  };

  const handlePointerLeave = () => {
    clearPreviewTimer();
    pointerRef.current = null;
    data?.onHoverChange?.(null);
    setPreviewVisible(false);
    setPreviewPosition(null);
  };

  const preview = !selected
    && previewVisible
    && previewPosition
    && (data.checkpoint || highlights.length)
    && document?.body
    ? createPortal(
        <div
          role="tooltip"
          data-research-hover-preview="1"
          style={{
            position: 'fixed',
            left: previewPosition.left,
            top: previewPosition.top,
            width: PREVIEW_WIDTH,
            maxHeight: 240,
            overflow: 'hidden',
            pointerEvents: 'none',
            zIndex: 2147483000,
            boxSizing: 'border-box',
            border: '1px solid #dbe3ee',
            borderRadius: 10,
            background: 'rgba(255,255,255,.985)',
            boxShadow: '0 14px 34px rgba(15,23,42,.20)',
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
        </div>,
        document.body
      )
    : null;

  return (
    <div
      ref={nodeRef}
      onPointerEnter={handlePointerEnter}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      aria-label={`${meta.label}: ${data.title || 'Untitled research node'}${highlights.length ? `, ${highlights.length} saved highlights` : ''}`}
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
      <Handle id="struct-target" type="target" position={Position.Top} style={{ background: meta.accent, width: 7, height: 7, border: '1px solid #fff' }} />
      <Handle id="lateral-source-left" type="source" position={Position.Left} style={{ ...HIDDEN_PORT_STYLE, top: '45%' }} />
      <Handle id="lateral-target-left" type="target" position={Position.Left} style={{ ...HIDDEN_PORT_STYLE, top: '56%' }} />
      <Handle id="lateral-source-right" type="source" position={Position.Right} style={{ ...HIDDEN_PORT_STYLE, top: '45%' }} />
      <Handle id="lateral-target-right" type="target" position={Position.Right} style={{ ...HIDDEN_PORT_STYLE, top: '56%' }} />

      {!farZoom ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 14, gap: 8 }}>
          <span style={{ fontSize: 10.5, lineHeight: '14px', fontWeight: 700, letterSpacing: '.035em', textTransform: 'uppercase', color: meta.accent }}>
            {meta.label}
          </span>
          {highlights.length ? (
            <span aria-label={`${highlights.length} saved highlights`} style={{ fontSize: 11, lineHeight: '14px', fontWeight: 650, color: '#64748b' }}>
              ★ {highlights.length}
            </span>
          ) : null}
        </div>
      ) : null}

      <div
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
          aria-label={keywords.length ? `Keywords: ${keywords.join(', ')}` : undefined}
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
        >
          {keywords.length ? keywords.join(' · ') : (highlights.length ? `${highlights.length} saved highlight${highlights.length === 1 ? '' : 's'}` : ' ')}
        </div>
      ) : highlights.length ? (
        <div style={{ position: 'absolute', right: 10, bottom: 7, fontSize: 10.5, color: '#64748b', fontWeight: 650 }}>
          ★ {highlights.length}
        </div>
      ) : null}

      {preview}

      <Handle id="struct-source" type="source" position={Position.Bottom} style={{ background: meta.accent, width: 7, height: 7, border: '1px solid #fff' }} />
    </div>
  );
}

export default memo(ResearchNode);
