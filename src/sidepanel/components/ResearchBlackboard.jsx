/**
 * Research Blackboard v0.1
 *
 * Semantic graph layered on top of the current ChatGPT conversation.
 * The MVP keeps the user in normal chat while turning selected messages into
 * compact research nodes with durable message anchors.
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
const GENERIC_KEYWORDS = new Set([
  '问题', '分析', '比较', '对比', '判断', '结论', '情况', '内容', '这个', '那个',
  '可以', '应该', '需要', '现在', '这里', '一个', '一种', '方面', '东西', 'ChatGPT',
  'analysis', 'comparison', 'judgment', 'question'
]);

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

function stripMarkdown(value) {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[\*_~]/g, ' ');
}

function compactTopic(value) {
  return cleanText(value)
    .replace(/^[：:，,。；;\-—–\s]+|[：:，,。；;\-—–\s]+$/g, '')
    .replace(/^(关于|针对|如果把|如果|把|这个|那个|我们来|先看|再看|那么|所以|然后|这里)/, '')
    .replace(/[（(][^）)]{0,28}[）)]/g, '')
    .trim();
}

function inferNodeTitle(content, role = 'message', type = 'analysis') {
  const raw = String(content || '');
  const heading = raw
    .split(/\r?\n/)
    .map((line) => line.match(/^\s{0,3}#{1,6}\s+(.{2,80})\s*$/)?.[1])
    .find(Boolean);

  if (heading) return truncate(compactTopic(heading), 34);

  const text = cleanText(stripMarkdown(raw));
  if (!text) return 'Research node';

  if (type === 'comparison') {
    const placed = text.match(/(?:如果)?把?(.{2,22}?)(?:[（(][^）)]{0,24}[）)])?(?:横向)?(?:放到|放进|放在)(.{2,22}?)(?:里|中|来看|去看|，|。)/);
    if (placed) {
      const left = compactTopic(placed[1]);
      const right = compactTopic(placed[2]);
      if (left && right) return truncate(`${left} × ${right}`, 34);
    }

    const versus = text.match(/(.{2,20}?)(?:和|与|vs\.?|VS)(.{2,20}?)(?:相比|比较|对比|横比)/i);
    if (versus) {
      const left = compactTopic(versus[1]);
      const right = compactTopic(versus[2]);
      if (left && right) return truncate(`${left} × ${right}`, 34);
    }
  }

  if (type === 'judgment') {
    const conclusion = text.match(/(?:结论|判断|因此|所以|这意味着|更可能是|核心是)[：:，,\s]*(.{4,42}?)(?:。|；|;|！|!|$)/);
    if (conclusion?.[1]) return truncate(compactTopic(conclusion[1]), 34);
  }

  const clauses = text
    .split(/[。！？?!；;\n]/)
    .map(compactTopic)
    .filter((part) => part.length >= 4);

  if (type === 'question') {
    const questionClause = clauses.find((part) => /(为什么|怎么|如何|是否|是不是|能不能|会不会|要不要|有没有|哪一个|哪个)/.test(part));
    if (questionClause) return truncate(questionClause, 32);
  }

  let candidate = clauses[0] || text;
  candidate = candidate
    .replace(/^(可以|当然|对|是的|没错|简单说|直接说|先说|我觉得|我认为)[：:，,\s]*/, '')
    .replace(/^(所以|那么|然后|那|这里|现在)[，,\s]*/, '');

  if (role === 'user') {
    candidate = candidate.replace(/^(帮我|你帮我|你觉得|我想问|我在想)[，,\s]*/, '');
  }

  return truncate(compactTopic(candidate) || text, 32);
}

function inferKeywords(content, title = '') {
  const text = cleanText(stripMarkdown(content));
  const keywords = [];
  const seen = new Set();

  const add = (value) => {
    const keyword = compactTopic(value).replace(/^的|的$/g, '').trim();
    if (!keyword || keyword.length < 2 || keyword.length > 14) return;
    const lower = keyword.toLowerCase();
    if (GENERIC_KEYWORDS.has(keyword) || GENERIC_KEYWORDS.has(lower) || seen.has(lower)) return;
    seen.add(lower);
    keywords.push(keyword);
  };

  String(title || '')
    .split(/[×｜|/：:、，,]|\s+-\s+|\s+vs\.?\s+/i)
    .forEach(add);

  const domainMatches = text.match(/(?:[A-Za-z][A-Za-z0-9.+/#-]{2,}|[\u4e00-\u9fff]{2,10}(?:时期|时代|艺术史|毛利率|估值|定价权|产品结构|商业模式|行业|公司|模型|架构|系统|策略|风险|周期|现金流|增长|竞争力|供给|需求))/g) || [];
  domainMatches.forEach(add);

  if (keywords.length < 3) {
    text
      .split(/[\s，。！？；、：:（）()《》“”"'`~!@#$%^&*+=\[\]{}<>/\\|]+/)
      .flatMap((part) => part.split(/(?:如果|但是|因为|所以|以及|还有|这个|那个|我们|你们|他们|可以|应该|需要|已经|就是|不是|是否|为什么|怎么|如何|一个|一种|对于|关于|通过|进行|比较|对比|分析|判断|结论|把|被|在|里|中|上|下|与|和|或|的|了|是|有|为|到|从)/))
      .filter((part) => part.length >= 2 && part.length <= 10)
      .slice(0, 20)
      .forEach(add);
  }

  return keywords.slice(0, 3);
}

function buildSourceMessages(conversationData) {
  const raw = (Array.isArray(conversationData?.nodes) ? conversationData.nodes : [])
    .filter((node) => node?.id && cleanText(node?.content))
    .slice()
    .sort((a, b) => (a.createTime || 0) - (b.createTime || 0));

  const roleCounts = new Map();
  return raw.map((node, messageIndex) => {
    const role = cleanText(node.role || 'message').toLowerCase() || 'message';
    const roleIndex = roleCounts.get(role) || 0;
    roleCounts.set(role, roleIndex + 1);
    const rawContent = String(node.content || '');
    const content = cleanText(rawContent);

    return {
      id: node.id,
      role,
      rawContent,
      content,
      createTime: node.createTime || 0,
      messageIndex,
      roleIndex,
      textLength: content.length
    };
  });
}

function looksLikeLegacyRawTitle(title, source) {
  if (!title || title === 'Untitled research node') return true;
  if (!source?.content) return false;
  const probe = cleanText(title).replace(/…$/, '');
  return probe.length >= 10 && source.content.startsWith(probe);
}

function normalizeStoredNode(node, source) {
  const existingData = node?.data || {};
  const type = existingData.type || 'analysis';
  const shouldRefreshTitle = !existingData.titleEdited && looksLikeLegacyRawTitle(existingData.title, source);
  const title = shouldRefreshTitle && source
    ? inferNodeTitle(source.rawContent, source.role, type)
    : (existingData.title || 'Untitled research node');

  return {
    ...node,
    type: 'researchNode',
    data: {
      type,
      title,
      checkpoint: '',
      ...existingData,
      title,
      titleSource: shouldRefreshTitle ? 'auto' : (existingData.titleSource || 'manual'),
      keywords: Array.isArray(existingData.keywords) && existingData.keywords.length
        ? existingData.keywords
        : inferKeywords(source?.rawContent || existingData.messagePreview || '', title),
      messageRole: existingData.messageRole || source?.role || null,
      messagePreview: existingData.messagePreview || (source ? truncate(source.content, 180) : ''),
      messageTail: existingData.messageTail || (source ? source.content.slice(-180) : ''),
      messageTextLength: existingData.messageTextLength || source?.textLength || 0,
      messageIndex: Number.isInteger(existingData.messageIndex) ? existingData.messageIndex : (source?.messageIndex ?? -1),
      messageRoleIndex: Number.isInteger(existingData.messageRoleIndex) ? existingData.messageRoleIndex : (source?.roleIndex ?? -1)
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

  const allSourceMessages = useMemo(() => buildSourceMessages(conversationData), [conversationData]);
  const sourceMessages = useMemo(() => allSourceMessages.slice(-80), [allSourceMessages]);
  const sourceMap = useMemo(() => new Map(allSourceMessages.map((message) => [message.id, message])), [allSourceMessages]);

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
      const freshSources = buildSourceMessages(conversationData);
      const freshSourceMap = new Map(freshSources.map((message) => [message.id, message]));
      setNodes((graph.nodes || []).map((node) => normalizeStoredNode(node, freshSourceMap.get(node?.data?.messageId))));
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

  const suggestedTitle = useMemo(
    () => selectedSource ? inferNodeTitle(selectedSource.rawContent, selectedSource.role, draftType) : '',
    [selectedSource, draftType]
  );

  const suggestedKeywords = useMemo(
    () => selectedSource ? inferKeywords(selectedSource.rawContent, suggestedTitle) : [],
    [selectedSource, suggestedTitle]
  );

  const makeJumpAnchor = useCallback((node) => {
    const messageId = node?.data?.messageId;
    if (!messageId) return null;
    const source = sourceMap.get(messageId);
    return {
      messageId,
      role: source?.role || node.data.messageRole || null,
      preview: source?.content.slice(0, 220) || node.data.messagePreview || '',
      tail: source?.content.slice(-180) || node.data.messageTail || '',
      textLength: source?.textLength || node.data.messageTextLength || 0,
      messageIndex: source?.messageIndex ?? node.data.messageIndex ?? -1,
      roleIndex: source?.roleIndex ?? node.data.messageRoleIndex ?? -1
    };
  }, [sourceMap]);

  const addResearchNode = useCallback(() => {
    const source = sourceMap.get(sourceMessageId) || null;
    const autoTitle = source ? inferNodeTitle(source.rawContent, source.role, draftType) : 'Research node';
    const title = cleanText(draftTitle) || autoTitle;
    const keywords = source ? inferKeywords(source.rawContent, title) : [];
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
        titleSource: cleanText(draftTitle) ? 'manual' : 'auto',
        titleEdited: !!cleanText(draftTitle),
        keywords,
        checkpoint: '',
        messageId: source?.id || null,
        messageRole: source?.role || null,
        messagePreview: source ? truncate(source.content, 180) : '',
        messageTail: source ? source.content.slice(-180) : '',
        messageTextLength: source?.textLength || 0,
        messageIndex: source?.messageIndex ?? -1,
        messageRoleIndex: source?.roleIndex ?? -1
      }
    };

    setNodes((current) => current.concat(node));
    setSelectedNodeId(id);
    setDraftTitle('');
    setStatus(source ? 'Pinned message with auto summary' : 'Created research node');
  }, [draftTitle, draftType, nodes.length, setNodes, sourceMessageId, sourceMap]);

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
    const anchor = makeJumpAnchor(node);
    if (anchor) onJumpToMessage?.(anchor);
  }, [makeJumpAnchor, onJumpToMessage]);

  const patchSelectedNode = useCallback((patch) => {
    if (!selectedNodeId) return;
    setNodes((current) => current.map((node) => (
      node.id === selectedNodeId
        ? { ...node, data: { ...node.data, ...patch } }
        : node
    )));
  }, [selectedNodeId, setNodes]);

  const autoSummarizeSelectedNode = useCallback(() => {
    if (!selectedNode) return;
    const source = sourceMap.get(selectedNode.data.messageId);
    if (!source) return;
    const title = inferNodeTitle(source.rawContent, source.role, selectedNode.data.type || 'analysis');
    patchSelectedNode({
      title,
      titleSource: 'auto',
      titleEdited: false,
      keywords: inferKeywords(source.rawContent, title)
    });
  }, [selectedNode, sourceMap, patchSelectedNode]);

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
            placeholder={suggestedTitle ? `Auto: ${suggestedTitle}` : 'Node title (optional)'}
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
            {selectedSource
              ? `${suggestedTitle}${suggestedKeywords.length ? ` · ${suggestedKeywords.join(' / ')}` : ''}`
              : 'Manual node'}
          </span>
        </div>
      </div>

      <div style={{ flex: '1 1 55%', minHeight: 220, position: 'relative', borderBottom: '1px solid #e2e8f0' }}>
        {nodes.length === 0 ? (
          <div className="empty-state" style={{ position: 'absolute' }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>⌘</div>
            <h2 style={{ fontSize: 15 }}>Pin the first research node</h2>
            <p style={{ maxWidth: 260 }}>Choose a message above. The blackboard will generate a compact title and keywords instead of copying the raw message.</p>
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
              <div style={{ display: 'flex', gap: 5 }}>
                <button type="button" onClick={autoSummarizeSelectedNode} style={smallButtonStyle}>Auto title</button>
                <button type="button" onClick={deleteSelectedNode} style={{ ...smallButtonStyle, color: '#b91c1c' }}>Delete</button>
              </div>
            </div>

            <label style={labelStyle}>Type</label>
            <select
              value={selectedNode.data.type || 'analysis'}
              onChange={(event) => {
                const nextType = event.target.value;
                const source = sourceMap.get(selectedNode.data.messageId);
                const nextTitle = !selectedNode.data.titleEdited && source
                  ? inferNodeTitle(source.rawContent, source.role, nextType)
                  : selectedNode.data.title;
                patchSelectedNode({
                  type: nextType,
                  title: nextTitle,
                  keywords: source ? inferKeywords(source.rawContent, nextTitle) : selectedNode.data.keywords
                });
              }}
              style={{ ...inputStyle, width: '100%' }}
            >
              {NODE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>

            <label style={labelStyle}>Title</label>
            <input
              value={selectedNode.data.title || ''}
              onChange={(event) => patchSelectedNode({ title: event.target.value, titleEdited: true, titleSource: 'manual' })}
              style={{ ...inputStyle, width: '100%' }}
            />

            {Array.isArray(selectedNode.data.keywords) && selectedNode.data.keywords.length ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
                {selectedNode.data.keywords.map((keyword) => (
                  <span key={keyword} style={keywordChipStyle}>{keyword}</span>
                ))}
              </div>
            ) : null}

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
                <button
                  type="button"
                  onClick={() => {
                    const anchor = makeJumpAnchor(selectedNode);
                    if (anchor) onJumpToMessage?.(anchor);
                  }}
                  style={{ ...smallButtonStyle, marginTop: 7 }}
                >
                  Jump to source
                </button>
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

const keywordChipStyle = {
  border: '1px solid #dbeafe',
  background: '#f8fafc',
  color: '#475569',
  borderRadius: 999,
  padding: '2px 6px',
  fontSize: 9,
  lineHeight: 1.3
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
