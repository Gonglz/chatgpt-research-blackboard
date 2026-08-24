/**
 * Research Blackboard v0.1
 *
 * Manual semantic graph layered on top of the current ChatGPT conversation.
 * The core UX hypothesis is intentionally small:
 *   1) pin a ChatGPT message as a semantic research node,
 *   2) arrange/link nodes spatially,
 *   3) persist the structure locally,
 *   4) click a node to jump back to its source message.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState
} from '@xyflow/react';
import ResearchNode from './ResearchNode';
import { clearResearchGraph, loadResearchGraph, saveResearchGraph } from '../utils/researchStore';

const nodeTypes = { researchNode: ResearchNode };
const RELATIONS = ['deepens', 'compares', 'supports', 'contradicts', 'informs'];
const NODE_TYPES = ['analysis', 'comparison', 'judgment', 'question'];

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncate(value, max = 72) {
  const text = cleanText(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function makeId(prefix) {
  try {
    return `${prefix}_${crypto.randomUUID()}`;
  } catch {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

function normalizeStoredNode(node) {
  return {
    ...node,
    type: 'researchNode',
    data: {
      type: 'analysis',
      title: 'Untitled research node',
      checkpoint: '',
      ...node.data
    }
  };
}

function ResearchBlackboardInner({ conversationData, onJumpToMessage }) {
  const conversationId = conversationData?.id || null;
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [sourceMessageId, setSourceMessageId] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftType, setDraftType] = useState('analysis');
  const [linkTargetId, setLinkTargetId] = useState('');
  const [linkRelation, setLinkRelation] = useState('informs');
  const [status, setStatus] = useState('');
  const loadedConversationRef = useRef(null);

  const sourceMessages = useMemo(() => {
    const raw = Array.isArray(conversationData?.nodes) ? conversationData.nodes : [];
    return raw
      .filter((node) => node?.id && cleanText(node?.content))
      .slice()
      .sort((a, b) => (a.createTime || 0) - (b.createTime || 0))
      .slice(-60)
      .map((node) => ({
        id: node.id,
        role: node.role || 'message',
        content: cleanText(node.content),
        createTime: node.createTime || 0
      }));
  }, [conversationData]);

  useEffect(() => {
    let cancelled = false;
    loadedConversationRef.current = null;
    setNodes([]);
    setEdges([]);
    setSelectedNodeId(null);
    setStatus('Loading research graph…');

    (async () => {
      const graph = await loadResearchGraph(conversationId);
      if (cancelled) return;
      setNodes((graph.nodes || []).map(normalizeStoredNode));
      setEdges(graph.edges || []);
      loadedConversationRef.current = conversationId;
      setStatus(graph.nodes?.length ? 'Local graph loaded' : 'Start by pinning a message');
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, setNodes, setEdges]);

  useEffect(() => {
    if (!sourceMessages.length) {
      setSourceMessageId('');
      return;
    }
    if (!sourceMessages.some((message) => message.id === sourceMessageId)) {
      setSourceMessageId(sourceMessages[sourceMessages.length - 1].id);
    }
  }, [sourceMessages, sourceMessageId]);

  useEffect(() => {
    if (!conversationId || loadedConversationRef.current !== conversationId) return undefined;

    const timer = setTimeout(() => {
      saveResearchGraph(conversationId, nodes, edges)
        .then(() => setStatus('Saved locally'))
        .catch((error) => {
          console.error('[ResearchBlackboard] save failed:', error);
          setStatus('Save failed');
        });
    }, 250);

    return () => clearTimeout(timer);
  }, [conversationId, nodes, edges]);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) || null,
    [nodes, selectedNodeId]
  );

  const selectedSource = useMemo(
    () => sourceMessages.find((message) => message.id === sourceMessageId) || null,
    [sourceMessages, sourceMessageId]
  );

  const addResearchNode = useCallback(() => {
    const source = sourceMessages.find((message) => message.id === sourceMessageId) || null;
    const title = cleanText(draftTitle) || truncate(source?.content || 'Research node', 48);
    const index = nodes.length;
    const id = makeId('research');

    const node = {
      id,
      type: 'researchNode',
      position: {
        x: 40 + (index % 3) * 230,
        y: 50 + Math.floor(index / 3) * 155
      },
      data: {
        type: draftType,
        title,
        checkpoint: '',
        messageId: source?.id || null,
        messageRole: source?.role || null,
        messagePreview: source ? truncate(source.content, 160) : ''
      }
    };

    setNodes((current) => current.concat(node));
    setSelectedNodeId(id);
    setDraftTitle('');
    setStatus(source ? 'Pinned message as research node' : 'Created research node');
  }, [draftTitle, draftType, nodes.length, setNodes, sourceMessageId, sourceMessages]);

  const onConnect = useCallback((connection) => {
    setEdges((current) => addEdge({
      ...connection,
      id: makeId('edge'),
      type: 'smoothstep',
      label: 'informs',
      data: { relation: 'informs' }
    }, current));
  }, [setEdges]);

  const handleNodeClick = useCallback((event, node) => {
    setSelectedNodeId(node.id);
    const messageId = node?.data?.messageId;
    if (messageId) onJumpToMessage?.(messageId);
  }, [onJumpToMessage]);

  const patchSelectedNode = useCallback((patch) => {
    if (!selectedNodeId) return;
    setNodes((current) => current.map((node) => (
      node.id === selectedNodeId
        ? { ...node, data: { ...node.data, ...patch } }
        : node
    )));
  }, [selectedNodeId, setNodes]);

  const deleteSelectedNode = useCallback(() => {
    if (!selectedNodeId) return;
    setNodes((current) => current.filter((node) => node.id !== selectedNodeId));
    setEdges((current) => current.filter((edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId));
    setSelectedNodeId(null);
    setLinkTargetId('');
  }, [selectedNodeId, setNodes, setEdges]);

  const addSemanticEdge = useCallback(() => {
    if (!selectedNodeId || !linkTargetId || selectedNodeId === linkTargetId) return;
    setEdges((current) => current.concat({
      id: makeId('edge'),
      source: selectedNodeId,
      target: linkTargetId,
      type: 'smoothstep',
      label: linkRelation,
      data: { relation: linkRelation }
    }));
    setLinkTargetId('');
  }, [selectedNodeId, linkTargetId, linkRelation, setEdges]);

  const deleteEdge = useCallback((edgeId) => {
    setEdges((current) => current.filter((edge) => edge.id !== edgeId));
  }, [setEdges]);

  const resetGraph = useCallback(async () => {
    if (!conversationId) return;
    const ok = window.confirm('Clear the local Research Blackboard for this conversation?');
    if (!ok) return;
    await clearResearchGraph(conversationId);
    setNodes([]);
    setEdges([]);
    setSelectedNodeId(null);
    setStatus('Local graph cleared');
  }, [conversationId, setNodes, setEdges]);

  const selectedEdges = useMemo(() => {
    if (!selectedNodeId) return [];
    return edges.filter((edge) => edge.source === selectedNodeId || edge.target === selectedNodeId);
  }, [edges, selectedNodeId]);

  if (!conversationData) {
    return <div className="empty-state"><h2>No Conversation Loaded</h2><p>Open a ChatGPT conversation first.</p></div>;
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#f8fafc' }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', background: '#fff', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Research Blackboard</div>
            <div style={{ fontSize: 10, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {conversationData.title}
            </div>
          </div>
          <button type="button" onClick={resetGraph} style={smallButtonStyle}>Clear</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr)', gap: 6 }}>
          <select value={draftType} onChange={(event) => setDraftType(event.target.value)} style={inputStyle}>
            {NODE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <input
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            placeholder="Node title (optional)"
            style={inputStyle}
          />
        </div>

        <select
          value={sourceMessageId}
          onChange={(event) => setSourceMessageId(event.target.value)}
          style={{ ...inputStyle, marginTop: 6, width: '100%' }}
        >
          <option value="">No message anchor</option>
          {sourceMessages.map((message) => (
            <option key={message.id} value={message.id}>
              {message.role === 'user' ? 'You' : 'GPT'} · {truncate(message.content, 88)}
            </option>
          ))}
        </select>

        <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
          <button type="button" onClick={addResearchNode} style={primaryButtonStyle}>+ Pin as node</button>
          <span style={{ fontSize: 10, color: '#64748b', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {selectedSource ? truncate(selectedSource.content, 64) : 'Manual node'}
          </span>
        </div>
      </div>

      <div style={{ flex: '1 1 55%', minHeight: 220, position: 'relative', borderBottom: '1px solid #e2e8f0' }}>
        {nodes.length === 0 ? (
          <div className="empty-state" style={{ position: 'absolute' }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>⌘</div>
            <h2 style={{ fontSize: 15 }}>Pin the first research node</h2>
            <p style={{ maxWidth: 260 }}>Choose a message above, then arrange semantic nodes instead of raw message history.</p>
          </div>
        ) : null}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={handleNodeClick}
          onPaneClick={() => setSelectedNodeId(null)}
          fitView
          fitViewOptions={{ padding: 0.22 }}
          defaultEdgeOptions={{ type: 'smoothstep' }}
          minZoom={0.25}
          maxZoom={1.8}
        >
          <Background gap={20} size={1} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>

      <div style={{ flex: '0 0 auto', maxHeight: '42%', overflow: 'auto', padding: 12, background: '#fff' }}>
        {selectedNode ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <strong style={{ fontSize: 12 }}>Node inspector</strong>
              <button type="button" onClick={deleteSelectedNode} style={{ ...smallButtonStyle, color: '#b91c1c' }}>Delete node</button>
            </div>

            <label style={labelStyle}>Type</label>
            <select value={selectedNode.data.type || 'analysis'} onChange={(event) => patchSelectedNode({ type: event.target.value })} style={{ ...inputStyle, width: '100%' }}>
              {NODE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>

            <label style={labelStyle}>Title</label>
            <input value={selectedNode.data.title || ''} onChange={(event) => patchSelectedNode({ title: event.target.value })} style={{ ...inputStyle, width: '100%' }} />

            <label style={labelStyle}>Checkpoint</label>
            <textarea
              value={selectedNode.data.checkpoint || ''}
              onChange={(event) => patchSelectedNode({ checkpoint: event.target.value })}
              placeholder="One short conclusion / open question"
              rows={3}
              style={{ ...inputStyle, width: '100%', resize: 'vertical', lineHeight: 1.35 }}
            />

            {selectedNode.data.messageId ? (
              <div style={{ marginTop: 8, padding: 8, borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 10, color: '#64748b' }}>Chat anchor · {selectedNode.data.messageRole || 'message'}</div>
                <div style={{ marginTop: 4, fontSize: 11, lineHeight: 1.35 }}>{selectedNode.data.messagePreview || selectedNode.data.messageId}</div>
                <button type="button" onClick={() => onJumpToMessage?.(selectedNode.data.messageId)} style={{ ...smallButtonStyle, marginTop: 7 }}>Jump to source</button>
              </div>
            ) : null}

            <label style={labelStyle}>Link this node</label>
            <div style={{ display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr)', gap: 6 }}>
              <select value={linkRelation} onChange={(event) => setLinkRelation(event.target.value)} style={inputStyle}>
                {RELATIONS.map((relation) => <option key={relation} value={relation}>{relation}</option>)}
              </select>
              <select value={linkTargetId} onChange={(event) => setLinkTargetId(event.target.value)} style={inputStyle}>
                <option value="">Target node…</option>
                {nodes.filter((node) => node.id !== selectedNodeId).map((node) => (
                  <option key={node.id} value={node.id}>{truncate(node.data?.title || node.id, 50)}</option>
                ))}
              </select>
            </div>
            <button type="button" onClick={addSemanticEdge} disabled={!linkTargetId} style={{ ...primaryButtonStyle, marginTop: 6, opacity: linkTargetId ? 1 : 0.5 }}>Create relation</button>

            {selectedEdges.length ? (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>Relations</div>
                {selectedEdges.map((edge) => {
                  const otherId = edge.source === selectedNodeId ? edge.target : edge.source;
                  const other = nodes.find((node) => node.id === otherId);
                  return (
                    <div key={edge.id} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '4px 0', fontSize: 10 }}>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {edge.source === selectedNodeId ? '→' : '←'} {edge.data?.relation || edge.label || 'informs'} · {other?.data?.title || otherId}
                      </span>
                      <button type="button" onClick={() => deleteEdge(edge.id)} style={tinyButtonStyle}>×</button>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </>
        ) : (
          <div style={{ fontSize: 11, color: '#64748b' }}>
            Select a research node to edit its title, checkpoint, anchor, and semantic relations.
          </div>
        )}

        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #f1f5f9', fontSize: 9, color: '#94a3b8' }}>
          v0.1 · {nodes.length} nodes · {edges.length} relations · {status}
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  minWidth: 0,
  border: '1px solid #cbd5e1',
  borderRadius: 7,
  padding: '7px 8px',
  fontSize: 11,
  background: '#fff',
  color: '#0f172a',
  outline: 'none'
};

const primaryButtonStyle = {
  border: '1px solid #1d4ed8',
  background: '#2563eb',
  color: '#fff',
  borderRadius: 7,
  padding: '7px 10px',
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer'
};

const smallButtonStyle = {
  border: '1px solid #cbd5e1',
  background: '#fff',
  color: '#334155',
  borderRadius: 6,
  padding: '5px 7px',
  fontSize: 10,
  cursor: 'pointer'
};

const tinyButtonStyle = {
  border: '1px solid #e2e8f0',
  background: '#fff',
  borderRadius: 5,
  width: 22,
  height: 22,
  cursor: 'pointer',
  color: '#64748b'
};

const labelStyle = {
  display: 'block',
  marginTop: 8,
  marginBottom: 4,
  fontSize: 10,
  fontWeight: 700,
  color: '#475569'
};

export default function ResearchBlackboard(props) {
  return (
    <ReactFlowProvider>
      <ResearchBlackboardInner {...props} />
    </ReactFlowProvider>
  );
}
