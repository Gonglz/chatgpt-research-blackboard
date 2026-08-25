import React, { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getBezierPath,
  useStore
} from '@xyflow/react';

const FONT_STACK = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const NODE_WIDTH = 200;
const NODE_HEIGHT = 88;
const STRUCTURAL_PORT_SPACING = 15;
const STRUCTURAL_PORT_MAX_OFFSET = 48;

function relationOf(data, label) {
  return String(data?.relation || label || 'informs').trim().toLowerCase();
}

function edgeRelation(edge) {
  return relationOf(edge?.data, edge?.label);
}

function nodeBounds(node) {
  const x = Number(node?.position?.x ?? 0);
  const y = Number(node?.position?.y ?? 0);
  const width = Number(node?.measured?.width ?? node?.width ?? NODE_WIDTH) || NODE_WIDTH;
  const height = Number(node?.measured?.height ?? node?.height ?? NODE_HEIGHT) || NODE_HEIGHT;
  return { x, y, width, height, cx: x + width / 2, cy: y + height / 2 };
}

function centeredPortOffset(index, count) {
  if (count <= 1 || index < 0) return 0;
  const raw = (index - (count - 1) / 2) * STRUCTURAL_PORT_SPACING;
  return Math.max(-STRUCTURAL_PORT_MAX_OFFSET, Math.min(STRUCTURAL_PORT_MAX_OFFSET, raw));
}

function visualNodeX(node, fallback = 0) {
  return node ? nodeBounds(node).cx : fallback;
}

/**
 * Canonical semantic direction for deepens is child -> parent. The edge renderer
 * intentionally draws the opposite visual direction (parent top -> child down)
 * so the canvas reads from broad concepts toward deeper concepts.
 *
 * Backbone edges use restrained vertical Bezier curves with per-sibling port
 * offsets. This keeps structural edges visually tree-like while preventing the
 * long shared horizontal/vertical "plumbing" produced by orthogonal routing.
 *
 * Non-structural relations are contextual: they stay hidden until one of their
 * endpoint nodes is selected, then appear as lighter, more curved side links.
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
  const allNodes = useStore((state) => state.nodes || []);
  const allEdges = useStore((state) => state.edges || []);
  const selectedNodeId = useStore((state) => {
    const selected = state.nodes?.find((node) => node.selected);
    return selected?.id || null;
  });

  const sourceNode = allNodes.find((node) => node.id === source);
  const targetNode = allNodes.find((node) => node.id === target);
  if (!sourceNode || !targetNode) return null;

  const connectedToSelection = !!selectedNodeId && (source === selectedNodeId || target === selectedNodeId);
  const sourceBox = nodeBounds(sourceNode);
  const targetBox = nodeBounds(targetNode);

  if (relation === 'deepens') {
    // Canonical: child(source) -> parent(target). Visual: parent -> child.
    // Fan siblings out from distinct points along the parent's bottom edge so
    // separate relationships do not share a long orthogonal trunk.
    const siblingsFromParent = allEdges
      .filter((edge) => edgeRelation(edge) === 'deepens' && edge.target === target)
      .slice()
      .sort((a, b) => {
        const ax = visualNodeX(allNodes.find((node) => node.id === a.source));
        const bx = visualNodeX(allNodes.find((node) => node.id === b.source));
        return ax - bx || String(a.id || '').localeCompare(String(b.id || ''));
      });
    const parentIndex = siblingsFromParent.findIndex((edge) => edge.id === id);
    const parentOffset = centeredPortOffset(parentIndex, siblingsFromParent.length);

    // If one child has multiple structural parents, also give those incoming
    // visual paths separate top ports rather than stacking them exactly.
    const parentsForChild = allEdges
      .filter((edge) => edgeRelation(edge) === 'deepens' && edge.source === source)
      .slice()
      .sort((a, b) => {
        const ax = visualNodeX(allNodes.find((node) => node.id === a.target));
        const bx = visualNodeX(allNodes.find((node) => node.id === b.target));
        return ax - bx || String(a.id || '').localeCompare(String(b.id || ''));
      });
    const childIndex = parentsForChild.findIndex((edge) => edge.id === id);
    const childOffset = centeredPortOffset(childIndex, parentsForChild.length);

    const [path] = getBezierPath({
      sourceX: targetBox.cx + parentOffset,
      sourceY: targetBox.y + targetBox.height,
      sourcePosition: Position.Bottom,
      targetX: sourceBox.cx + childOffset,
      targetY: sourceBox.y,
      targetPosition: Position.Top,
      curvature: 0.18
    });

    return (
      <BaseEdge
        id={id}
        path={path}
        markerStart={markerStart}
        markerEnd={markerEnd}
        style={{
          stroke: connectedToSelection ? '#64748b' : '#94a3b8',
          strokeWidth: connectedToSelection ? 1.8 : 1.3,
          opacity: selectedNodeId ? (connectedToSelection ? 0.94 : 0.34) : 0.62
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
    curvature: 0.34
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
          strokeWidth: 1.25,
          opacity: 0.78,
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
