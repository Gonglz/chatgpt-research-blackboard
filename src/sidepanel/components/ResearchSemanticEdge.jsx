import React, { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getBezierPath,
  getSmoothStepPath,
  useStore
} from '@xyflow/react';

const FONT_STACK = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const NODE_WIDTH = 200;
const NODE_HEIGHT = 88;

function relationOf(data, label) {
  return String(data?.relation || label || 'informs').trim().toLowerCase();
}

function nodeBounds(node) {
  const x = Number(node?.internals?.positionAbsolute?.x ?? node?.position?.x ?? 0);
  const y = Number(node?.internals?.positionAbsolute?.y ?? node?.position?.y ?? 0);
  const width = Number(node?.measured?.width ?? node?.width ?? NODE_WIDTH) || NODE_WIDTH;
  const height = Number(node?.measured?.height ?? node?.height ?? NODE_HEIGHT) || NODE_HEIGHT;
  return { x, y, width, height, cx: x + width / 2, cy: y + height / 2 };
}

/**
 * Canonical semantic direction for deepens is child -> parent. The edge renderer
 * intentionally draws the opposite visual direction (parent top -> child down)
 * so the canvas reads from broad concepts toward deeper concepts.
 *
 * Non-structural relations are contextual: they stay hidden until one of their
 * endpoint nodes is selected, then appear as lighter left/right curves.
 */
function ResearchSemanticEdge({
  id,
  source,
  target,
  data,
  label,
  markerEnd,
  markerStart
}) {
  const relation = relationOf(data, label);
  const sourceNode = useStore((state) => state.nodeLookup?.get(source));
  const targetNode = useStore((state) => state.nodeLookup?.get(target));
  const selectedNodeId = useStore((state) => {
    const selected = state.nodes?.find((node) => node.selected);
    return selected?.id || null;
  });

  if (!sourceNode || !targetNode) return null;

  const connectedToSelection = !!selectedNodeId && (source === selectedNodeId || target === selectedNodeId);
  const sourceBox = nodeBounds(sourceNode);
  const targetBox = nodeBounds(targetNode);

  if (relation === 'deepens') {
    // Canonical: child(source) -> parent(target). Visual: parent -> child.
    const [path] = getSmoothStepPath({
      sourceX: targetBox.cx,
      sourceY: targetBox.y + targetBox.height,
      sourcePosition: Position.Bottom,
      targetX: sourceBox.cx,
      targetY: sourceBox.y,
      targetPosition: Position.Top,
      borderRadius: 9,
      offset: 24
    });

    return (
      <BaseEdge
        id={id}
        path={path}
        markerStart={markerStart}
        markerEnd={markerEnd}
        style={{
          stroke: connectedToSelection ? '#64748b' : '#94a3b8',
          strokeWidth: connectedToSelection ? 1.8 : 1.25,
          opacity: selectedNodeId ? (connectedToSelection ? 0.94 : 0.38) : 0.58
        }}
      />
    );
  }

  // Lateral semantic relations should not create permanent visual plumbing.
  if (!connectedToSelection) return null;

  const goesRight = sourceBox.cx <= targetBox.cx;
  const sourceX = goesRight ? sourceBox.x + sourceBox.width : sourceBox.x;
  const targetX = goesRight ? targetBox.x : targetBox.x + targetBox.width;
  const sourcePosition = goesRight ? Position.Right : Position.Left;
  const targetPosition = goesRight ? Position.Left : Position.Right;

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY: sourceBox.cy,
    sourcePosition,
    targetX,
    targetY: targetBox.cy,
    targetPosition,
    curvature: 0.28
  });

  const dashed = relation === 'contradicts';

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerStart={markerStart}
        markerEnd={markerEnd}
        style={{
          stroke: '#64748b',
          strokeWidth: 1.35,
          opacity: 0.86,
          strokeDasharray: dashed ? '5 4' : undefined
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'none',
            padding: '2px 4px',
            borderRadius: 4,
            background: 'rgba(255,255,255,.94)',
            color: '#64748b',
            fontFamily: FONT_STACK,
            fontSize: 10,
            lineHeight: '13px',
            boxShadow: '0 0 0 1px rgba(226,232,240,.85)'
          }}
        >
          {relation}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export default memo(ResearchSemanticEdge);
