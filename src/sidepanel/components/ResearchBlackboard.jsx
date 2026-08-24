/**
 * Research Blackboard — canvas-first semantic research graph.
 *
 * Design rules:
 * - the canvas owns almost all persistent space
 * - nodes stay compact and fixed-size
 * - details are progressive disclosure via delayed hover + overlay drawer
 * - manual pinning/settings are low-frequency popovers from a narrow rail
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
import ResearchSemanticEdge from './ResearchSemanticEdge';
import { clearResearchGraph, loadResearchGraph, saveResearchGraph } from '../utils/researchStore';

const nodeTypes = { researchNode: ResearchNode };
const edgeTypes = { smoothstep: ResearchSemanticEdge };
const RELATIONS = ['deepens', 'compares', 'supports', 'contradicts', 'informs'];
const NODE_TYPES = ['analysis', 'comparison', 'judgment', 'question'];
const DETAIL_PLACEMENT_KEY = 'researchBlackboard:detailPlacement';
const MINIMAP_PREF_KEY = 'researchBlackboard:minimapPreference';
const FONT_STACK = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

const TYPE_META = {
  analysis: { label: 'Analysis', accent: '#2563eb' },
  comparison: { label: 'Compare', accent: '#7c3aed' },
  judgment: { label: 'Judgment', accent: '#059669' },
  question: { label: 'Question', accent: '#d97706' }
};

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
      highlights: Array.isArray(existingData.highlights) ? existingData.highlights : [],
      messageRole: existingData.messageRole || source?.role || null,
      messagePreview: existingData.messagePreview || (source ? truncate(source.content, 180) : ''),
      messageTail: existingData.messageTail || (source ? source.content.slice(-180) : ''),
      messageTextLength: existingData.messageTextLength || source?.textLength || 0,
      messageIndex: Number.isInteger(existingData.messageIndex) ? existingData.messageIndex : (source?.messageIndex ?? -1),
      messageRoleIndex: Number.isInteger(existingData.messageRoleIndex) ? existingData.messageRoleIndex : (source?.roleIndex ?? -1)
    }
  };
}

function readLocalPreference(key, allowed, fallback) {
  try {
    const value = localStorage.getItem(key);
    return allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function RailButton({ active = false, title, children, onClick }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      style={{
        width: 32,
        height: 32,
        borderRadius: 8,
        border: active ? '1px solid #94a3b8' : '1px solid transparent',
        background: active ? '#f1f5f9' : 'rgba(255,255,255,.92)',
        color: active ? '#111827' : '#475569',
        fontFamily: FONT_STACK,
        fontSize: 15,
        fontWeight: 600,
        display: 'grid',
        placeItems: 'center',
        cursor: 'pointer',
        boxShadow: active ? '0 1px 3px rgba(15,23,42,.08)' : 'none'
      }}
    >
      {children}
    </button>
  );
}

function HighlightList({ highlights, onJump }) {
  if (!highlights.length) {
    return (
      <div style={{ padding: '12px 2px', fontSize: 12, lineHeight: '18px', color: '#94a3b8' }}>
        No saved highlights yet. Select text in a ChatGPT answer and choose ★ Save.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {highlights.map((highlight) => (
        <div
          key={highlight.id || `${highlight.messageId}:${highlight.quote}`}
          style={{
            border: '1px solid #e2e8f0',
            borderRadius: 9,
            background: '#f8fafc',
            padding: '8px 9px'
          }}
        >
          <div style={{ fontSize: 12.5, lineHeight: '18px', color: '#334155' }}>
            ★ “{highlight.quote || ''}”
          </div>
          {highlight.messageId ? (
            <button
              type="button"
              onClick={() => onJump?.(highlight)}
              style={{
                marginTop: 5,
                border: 0,
                background: 'transparent',
                padding: 0,
                fontSize: 11.5,
                lineHeight: '16px',
                color: '#2563eb',
                cursor: 'pointer',
                fontFamily: FONT_STACK
              }}
            >
              ↗ Source
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function DetailSurface({
  node,
  placement,
  selectedEdges,
  nodes,
  sourceMap,
  editMode,
  setEditMode,
  close,
  patchNode,
  autoTitle,
  deleteNode,
  jumpToNode,
  jumpToHighlight,
  linkRelation,
  setLinkRelation,
  linkTargetId,
  setLinkTargetId,
  createRelation,
  deleteEdge
}) {
  if (!node) return null;
  const meta = TYPE_META[node.data?.type] || TYPE_META.analysis;
  const highlights = Array.isArray(node.data?.highlights) ? node.data.highlights : [];
  const keywords = Array.isArray(node.data?.keywords) ? node.data.keywords : [];
  const bottom = placement === 'bottom';

  const baseStyle = bottom
    ? {
        left: 52,
        right: 10,
        bottom: 10,
        height: 'min(340px, 43%)'
      }
    : {
        left: 52,
        top: 10,
        bottom: 10,
        width: 'clamp(300px, 38%, 400px)'
      };

  const selectedSource = sourceMap.get(node.data?.messageId);

  return (
    <section
      aria-label="Research node detail"
      style={{
        position: 'absolute',
        ...baseStyle,
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        border: '1px solid #dbe3ee',
        borderRadius: 12,
        background: 'rgba(255,255,255,.985)',
        boxShadow: '0 18px 45px rgba(15,23,42,.20)',
        overflow: 'hidden',
        fontFamily: FONT_STACK,
        color: '#111827'
      }}
    >
      <div style={{ flex: '0 0 auto', padding: '11px 12px 9px', borderBottom: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 10.5, lineHeight: '14px', color: meta.accent, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.035em' }}>
              {meta.label}
            </div>
            <div style={{ marginTop: 2, fontSize: 16, lineHeight: '22px', fontWeight: 600, color: '#111827' }}>
              {node.data?.title || 'Untitled research node'}
            </div>
            {keywords.length ? (
              <div style={{ marginTop: 4, fontSize: 12, lineHeight: '16px', color: '#64748b' }}>
                {keywords.slice(0, 5).join(' · ')}
              </div>
            ) : null}
          </div>
          <button type="button" onClick={close} style={iconButtonStyle} title="Close detail" aria-label="Close detail">×</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 8 }}>
          {node.data?.messageId ? (
            <button type="button" onClick={jumpToNode} style={quietButtonStyle}>↗ Source</button>
          ) : null}
          <button type="button" onClick={() => setEditMode((value) => !value)} style={quietButtonStyle}>
            {editMode ? 'Done' : 'Edit'}
          </button>
        </div>
      </div>

      {editMode ? (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12 }}>
          <label style={labelStyle}>Type</label>
          <select
            value={node.data?.type || 'analysis'}
            onChange={(event) => {
              const nextType = event.target.value;
              const nextTitle = !node.data?.titleEdited && selectedSource
                ? inferNodeTitle(selectedSource.rawContent, selectedSource.role, nextType)
                : node.data?.title;
              patchNode({
                type: nextType,
                typeEdited: true,
                title: nextTitle,
                keywords: selectedSource ? inferKeywords(selectedSource.rawContent, nextTitle) : node.data?.keywords
              });
            }}
            style={inputStyle}
          >
            {NODE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>

          <label style={labelStyle}>Title</label>
          <input
            value={node.data?.title || ''}
            onChange={(event) => patchNode({ title: event.target.value, titleEdited: true, titleSource: 'manual' })}
            style={inputStyle}
          />

          <label style={labelStyle}>Checkpoint</label>
          <textarea
            value={node.data?.checkpoint || ''}
            onChange={(event) => patchNode({ checkpoint: event.target.value, checkpointEdited: true })}
            rows={4}
            style={{ ...inputStyle, resize: 'vertical', lineHeight: '19px' }}
          />

          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button type="button" onClick={autoTitle} style={quietButtonStyle}>Auto title</button>
            <button type="button" onClick={deleteNode} style={{ ...quietButtonStyle, color: '#b91c1c' }}>Delete node</button>
          </div>

          <label style={labelStyle}>Create relation</label>
          <div style={{ display: 'grid', gridTemplateColumns: '110px minmax(0,1fr)', gap: 6 }}>
            <select value={linkRelation} onChange={(event) => setLinkRelation(event.target.value)} style={inputStyle}>
              {RELATIONS.map((relation) => <option key={relation} value={relation}>{relation}</option>)}
            </select>
            <select value={linkTargetId} onChange={(event) => setLinkTargetId(event.target.value)} style={inputStyle}>
              <option value="">Target node…</option>
              {nodes.filter((candidate) => candidate.id !== node.id).map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{truncate(candidate.data?.title || candidate.id, 50)}</option>
              ))}
            </select>
          </div>
          <button type="button" onClick={createRelation} disabled={!linkTargetId} style={{ ...primaryButtonStyle, marginTop: 6, opacity: linkTargetId ? 1 : .45 }}>
            Create relation
          </button>

          {selectedEdges.length ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, lineHeight: '16px', fontWeight: 600, color: '#475569', marginBottom: 4 }}>Relations</div>
              {selectedEdges.map((edge) => {
                const otherId = edge.source === node.id ? edge.target : edge.source;
                const other = nodes.find((candidate) => candidate.id === otherId);
                return (
                  <div key={edge.id} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '4px 0', fontSize: 11.5, lineHeight: '16px' }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#475569' }}>
                      {edge.source === node.id ? '→' : '←'} {edge.data?.relation || edge.label || 'informs'} · {other?.data?.title || otherId}
                    </span>
                    <button type="button" onClick={() => deleteEdge(edge.id)} style={tinyButtonStyle}>×</button>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : bottom ? (
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(240px,.9fr) minmax(0,1.25fr)', gap: 0 }}>
          <div style={{ minWidth: 0, overflowY: 'auto', padding: 12, borderRight: '1px solid #e2e8f0' }}>
            <div style={sectionTitleStyle}>Checkpoint</div>
            <div style={{ fontSize: 14, lineHeight: '20px', color: '#334155' }}>
              {node.data?.checkpoint || 'No checkpoint yet.'}
            </div>
            {selectedEdges.length ? (
              <div style={{ marginTop: 14 }}>
                <div style={sectionTitleStyle}>Relations</div>
                {selectedEdges.map((edge) => {
                  const otherId = edge.source === node.id ? edge.target : edge.source;
                  const other = nodes.find((candidate) => candidate.id === otherId);
                  return (
                    <div key={edge.id} style={{ marginTop: 5, fontSize: 12, lineHeight: '17px', color: '#64748b' }}>
                      {edge.source === node.id ? '→' : '←'} {edge.data?.relation || edge.label || 'informs'} · {other?.data?.title || otherId}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
          <div style={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 12 }}>
            <div style={{ ...sectionTitleStyle, flex: '0 0 auto' }}>Highlights <span style={{ color: '#94a3b8' }}>★ {highlights.length}</span></div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 3 }}>
              <HighlightList highlights={highlights} onJump={jumpToHighlight} />
            </div>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 12 }}>
          <div style={{ flex: '0 0 auto' }}>
            <div style={sectionTitleStyle}>Checkpoint</div>
            <div style={{ fontSize: 14, lineHeight: '20px', color: '#334155' }}>
              {node.data?.checkpoint || 'No checkpoint yet.'}
            </div>
          </div>

          <div style={{ flex: '1 1 auto', minHeight: 110, display: 'flex', flexDirection: 'column', marginTop: 14 }}>
            <div style={{ ...sectionTitleStyle, flex: '0 0 auto' }}>Highlights <span style={{ color: '#94a3b8' }}>★ {highlights.length}</span></div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 3 }}>
              <HighlightList highlights={highlights} onJump={jumpToHighlight} />
            </div>
          </div>

          {selectedEdges.length ? (
            <div style={{ flex: '0 0 auto', marginTop: 12, maxHeight: 120, overflowY: 'auto' }}>
              <div style={sectionTitleStyle}>Relations</div>
              {selectedEdges.map((edge) => {
                const otherId = edge.source === node.id ? edge.target : edge.source;
                const other = nodes.find((candidate) => candidate.id === otherId);
                return (
                  <div key={edge.id} style={{ marginTop: 4, fontSize: 12, lineHeight: '17px', color: '#64748b' }}>
                    {edge.source === node.id ? '→' : '←'} {edge.data?.relation || edge.label || 'informs'} · {other?.data?.title || otherId}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
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
  const [manualOpen, setManualOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [canvasWidth, setCanvasWidth] = useState(0);
  const [detailPlacement, setDetailPlacement] = useState(() => readLocalPreference(DETAIL_PLACEMENT_KEY, ['auto', 'left', 'bottom'], 'auto'));
  const [miniMapPreference, setMiniMapPreference] = useState(() => readLocalPreference(MINIMAP_PREF_KEY, ['auto', 'show', 'hide'], 'auto'));

  const loadedConversationRef = useRef(null);
  const canvasRef = useRef(null);

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
      const normalized = (graph.nodes || []).map((node) => normalizeStoredNode(node, freshSourceMap.get(node?.data?.messageId)));
      setNodes(normalized);
      setEdges(graph.edges || []);
      const requestedSelection = graph.metadata?.selectedNodeId || null;
      setSelectedNodeId(normalized.some((node) => node.id === requestedSelection) ? requestedSelection : null);
      loadedConversationRef.current = conversationId;
      setStatus(graph.nodes?.length ? 'Local graph loaded' : 'Waiting for research nodes');
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, setNodes, setEdges]);

  useEffect(() => {
    const element = canvasRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const width = entries?.[0]?.contentRect?.width || 0;
      setCanvasWidth(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

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

  useEffect(() => {
    try { localStorage.setItem(DETAIL_PLACEMENT_KEY, detailPlacement); } catch { /* ignore */ }
  }, [detailPlacement]);

  useEffect(() => {
    try { localStorage.setItem(MINIMAP_PREF_KEY, miniMapPreference); } catch { /* ignore */ }
  }, [miniMapPreference]);

  useEffect(() => {
    setEditMode(false);
    setLinkTargetId('');
  }, [selectedNodeId]);

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

  const selectedEdges = useMemo(() => {
    if (!selectedNodeId) return [];
    return edges.filter((edge) => edge.source === selectedNodeId || edge.target === selectedNodeId);
  }, [edges, selectedNodeId]);

  const resolvedPlacement = detailPlacement === 'auto'
    ? (canvasWidth >= 700 ? 'left' : 'bottom')
    : detailPlacement;

  const showMiniMap = miniMapPreference === 'show'
    || (miniMapPreference === 'auto' && nodes.length >= 30);

  const displayNodes = useMemo(
    () => nodes.map((node) => ({ ...node, selected: node.id === selectedNodeId })),
    [nodes, selectedNodeId]
  );

  const displayEdges = useMemo(() => edges.map((edge) => {
    const connected = !!selectedNodeId && (edge.source === selectedNodeId || edge.target === selectedNodeId);
    const relation = edge.data?.relation || edge.label || 'informs';
    const selectedStyle = connected
      ? { stroke: '#64748b', strokeWidth: 1.8, opacity: .92 }
      : { stroke: '#94a3b8', strokeWidth: 1.2, opacity: selectedNodeId ? .12 : .34 };
    if (relation === 'contradicts') selectedStyle.strokeDasharray = '5 4';
    if (relation === 'informs' && !connected) selectedStyle.opacity = selectedNodeId ? .08 : .24;

    return {
      ...edge,
      label: connected ? relation : undefined,
      style: { ...(edge.style || {}), ...selectedStyle },
      labelStyle: { fill: '#64748b', fontSize: 10.5, fontFamily: FONT_STACK },
      labelBgStyle: { fill: '#fff', fillOpacity: .9 },
      labelBgPadding: [3, 2],
      labelBgBorderRadius: 4
    };
  }), [edges, selectedNodeId]);

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

  const makeHighlightAnchor = useCallback((highlight) => {
    if (!highlight?.messageId) return null;
    const source = sourceMap.get(highlight.messageId);
    return {
      messageId: highlight.messageId,
      role: source?.role || highlight.messageRole || 'assistant',
      preview: source?.content.slice(0, 220) || highlight.messagePreview || '',
      tail: source?.content.slice(-180) || highlight.messageTail || '',
      textLength: source?.textLength || highlight.messageTextLength || 0,
      messageIndex: source?.messageIndex ?? -1,
      roleIndex: source?.roleIndex ?? -1
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
        highlights: [],
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
    setManualOpen(false);
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
    event?.stopPropagation?.();
    setSelectedNodeId(node.id);
    setManualOpen(false);
    setSettingsOpen(false);
  }, []);

  const handleNodeDoubleClick = useCallback((event, node) => {
    event?.stopPropagation?.();
    const anchor = makeJumpAnchor(node);
    if (anchor) onJumpToMessage?.(anchor);
  }, [makeJumpAnchor, onJumpToMessage]);

  const closeDetail = useCallback(() => {
    setSelectedNodeId(null);
    setEditMode(false);
    if (conversationId) {
      saveResearchGraph(conversationId, nodes, edges, { selectedNodeId: null }).catch(() => {});
    }
  }, [conversationId, nodes, edges]);

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
    setManualOpen(false);
    setSettingsOpen(false);
    setStatus('Local graph cleared');
  }, [conversationId, setNodes, setEdges]);

  if (!conversationData) {
    return <div className="empty-state"><h2>No Conversation Loaded</h2><p>Open a ChatGPT conversation first.</p></div>;
  }

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', background: '#f8fafc', fontFamily: FONT_STACK }}>
      <div
        style={{
          height: 38,
          flex: '0 0 38px',
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '0 11px',
          borderBottom: '1px solid #e2e8f0',
          background: '#fff'
        }}
      >
        <div style={{ fontSize: 13.5, lineHeight: '18px', fontWeight: 650, color: '#111827', whiteSpace: 'nowrap' }}>
          Research Blackboard
        </div>
        <div style={{ minWidth: 0, flex: 1, fontSize: 11.5, lineHeight: '16px', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {conversationData.title}
        </div>
        <div style={{ fontSize: 10.5, lineHeight: '14px', color: '#94a3b8', whiteSpace: 'nowrap' }}>
          {nodes.length} · {edges.length}
        </div>
      </div>

      <div ref={canvasRef} style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {nodes.length === 0 ? (
          <div className="empty-state" style={{ position: 'absolute', zIndex: 1 }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>⌘</div>
            <h2 style={{ fontSize: 15 }}>Research graph is empty</h2>
            <p style={{ maxWidth: 280 }}>Keep chatting with the sidecar open, or use + to create a manual node.</p>
          </div>
        ) : null}

        <ReactFlow
          nodes={displayNodes}
          edges={displayEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick}
          onPaneClick={closeDetail}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          defaultEdgeOptions={{ type: 'smoothstep' }}
          minZoom={0.25}
          maxZoom={1.8}
          style={{ background: '#f8fafc' }}
        >
          <Background gap={22} size={1} color="#dbe3ee" />
          <Controls showInteractive={false} />
          {showMiniMap ? <MiniMap pannable zoomable position="bottom-right" /> : null}
        </ReactFlow>

        <div
          aria-label="Research canvas tools"
          style={{
            position: 'absolute',
            left: 10,
            top: 10,
            zIndex: 35,
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
            padding: 4,
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            background: 'rgba(255,255,255,.94)',
            boxShadow: '0 5px 16px rgba(15,23,42,.10)',
            backdropFilter: 'blur(8px)'
          }}
        >
          <RailButton active={manualOpen} title="Add manual node" onClick={() => { setManualOpen((value) => !value); setSettingsOpen(false); }}>+</RailButton>
          <RailButton active={showMiniMap} title={showMiniMap ? 'Hide minimap' : 'Show minimap'} onClick={() => setMiniMapPreference(showMiniMap ? 'hide' : 'show')}>▧</RailButton>
          <RailButton active={settingsOpen} title="Blackboard settings" onClick={() => { setSettingsOpen((value) => !value); setManualOpen(false); }}>⋯</RailButton>
        </div>

        {manualOpen ? (
          <div style={{ ...popoverStyle, left: 52, top: 10, width: 'min(420px, calc(100% - 66px))' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <strong style={{ fontSize: 13, lineHeight: '18px', color: '#111827' }}>Manual node</strong>
              <button type="button" onClick={() => setManualOpen(false)} style={iconButtonStyle}>×</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '110px minmax(0,1fr)', gap: 6, marginTop: 9 }}>
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
            <select value={sourceMessageId} onChange={(event) => setSourceMessageId(event.target.value)} style={{ ...inputStyle, marginTop: 6 }}>
              <option value="">No message anchor</option>
              {sourceMessages.map((message) => (
                <option key={message.id} value={message.id}>{message.role === 'user' ? 'You' : 'GPT'} · {truncate(message.content, 88)}</option>
              ))}
            </select>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 7 }}>
              <button type="button" onClick={addResearchNode} style={primaryButtonStyle}>+ Pin as node</button>
              <span style={{ minWidth: 0, flex: 1, fontSize: 11.5, lineHeight: '16px', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedSource ? `${suggestedTitle}${suggestedKeywords.length ? ` · ${suggestedKeywords.join(' / ')}` : ''}` : 'Manual node'}
              </span>
            </div>
          </div>
        ) : null}

        {settingsOpen ? (
          <div style={{ ...popoverStyle, left: 52, top: 82, width: 250 }}>
            <div style={{ fontSize: 12.5, lineHeight: '17px', fontWeight: 650, color: '#111827' }}>Canvas settings</div>
            <label style={labelStyle}>Detail placement</label>
            <select value={detailPlacement} onChange={(event) => setDetailPlacement(event.target.value)} style={inputStyle}>
              <option value="auto">Auto</option>
              <option value="left">Left overlay</option>
              <option value="bottom">Bottom overlay</option>
            </select>
            <div style={{ marginTop: 9, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setMiniMapPreference(showMiniMap ? 'hide' : 'show')} style={quietButtonStyle}>
                {showMiniMap ? 'Hide minimap' : 'Show minimap'}
              </button>
              <button type="button" onClick={() => setMiniMapPreference('auto')} style={quietButtonStyle}>Minimap auto</button>
            </div>
            <button type="button" onClick={resetGraph} style={{ ...quietButtonStyle, marginTop: 9, color: '#b91c1c' }}>Clear graph</button>
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #eef2f7', fontSize: 10.5, lineHeight: '15px', color: '#94a3b8' }}>
              {status}
            </div>
          </div>
        ) : null}

        <DetailSurface
          node={selectedNode}
          placement={resolvedPlacement}
          selectedEdges={selectedEdges}
          nodes={nodes}
          sourceMap={sourceMap}
          editMode={editMode}
          setEditMode={setEditMode}
          close={closeDetail}
          patchNode={patchSelectedNode}
          autoTitle={autoSummarizeSelectedNode}
          deleteNode={deleteSelectedNode}
          jumpToNode={() => {
            const anchor = makeJumpAnchor(selectedNode);
            if (anchor) onJumpToMessage?.(anchor);
          }}
          jumpToHighlight={(highlight) => {
            const anchor = makeHighlightAnchor(highlight);
            if (anchor) onJumpToMessage?.(anchor);
          }}
          linkRelation={linkRelation}
          setLinkRelation={setLinkRelation}
          linkTargetId={linkTargetId}
          setLinkTargetId={setLinkTargetId}
          createRelation={addSemanticEdge}
          deleteEdge={deleteEdge}
        />
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  border: '1px solid #cbd5e1',
  borderRadius: 7,
  padding: '7px 8px',
  fontFamily: FONT_STACK,
  fontSize: 12,
  lineHeight: '17px',
  background: '#fff',
  color: '#111827',
  outline: 'none'
};

const primaryButtonStyle = {
  border: '1px solid #1d4ed8',
  background: '#2563eb',
  color: '#fff',
  borderRadius: 7,
  padding: '7px 10px',
  fontFamily: FONT_STACK,
  fontSize: 12,
  lineHeight: '16px',
  fontWeight: 650,
  cursor: 'pointer'
};

const quietButtonStyle = {
  border: '1px solid #cbd5e1',
  background: '#fff',
  color: '#334155',
  borderRadius: 7,
  padding: '5px 8px',
  fontFamily: FONT_STACK,
  fontSize: 11.5,
  lineHeight: '16px',
  fontWeight: 550,
  cursor: 'pointer'
};

const iconButtonStyle = {
  width: 28,
  height: 28,
  flex: '0 0 28px',
  border: '1px solid #e2e8f0',
  borderRadius: 7,
  background: '#fff',
  color: '#64748b',
  fontFamily: FONT_STACK,
  fontSize: 16,
  lineHeight: '24px',
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
  marginTop: 9,
  marginBottom: 4,
  fontSize: 11.5,
  lineHeight: '16px',
  fontWeight: 600,
  color: '#475569'
};

const sectionTitleStyle = {
  marginBottom: 6,
  fontSize: 11.5,
  lineHeight: '16px',
  fontWeight: 650,
  color: '#475569'
};

const popoverStyle = {
  position: 'absolute',
  zIndex: 45,
  boxSizing: 'border-box',
  border: '1px solid #dbe3ee',
  borderRadius: 11,
  background: 'rgba(255,255,255,.985)',
  boxShadow: '0 14px 35px rgba(15,23,42,.16)',
  padding: 11,
  fontFamily: FONT_STACK
};

export default function ResearchBlackboard(props) {
  return (
    <ReactFlowProvider>
      <ResearchBlackboardInner {...props} />
    </ReactFlowProvider>
  );
}
