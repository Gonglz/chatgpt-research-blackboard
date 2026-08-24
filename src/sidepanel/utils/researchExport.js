const GRAPH_PREFIX = 'researchBlackboard:';
const NODE_WIDTH = 200;
const NODE_HEIGHT = 88;

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeFilename(value) {
  const cleaned = cleanText(value)
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/[.\s-]+$/g, '')
    .slice(0, 80);
  return cleaned || 'research-blackboard';
}

async function activeConversationContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = String(tab?.url || '');
  const match = url.match(/\/c\/([a-zA-Z0-9-]+)/);
  const conversationId = match?.[1] || null;
  const rawTitle = cleanText(tab?.title || 'Research Blackboard');
  const title = rawTitle
    .replace(/\s*[|·-]\s*ChatGPT\s*$/i, '')
    .replace(/^ChatGPT\s*[|·-]\s*/i, '')
    .trim() || 'Research Blackboard';
  return { conversationId, title, url };
}

async function loadCurrentGraph() {
  const context = await activeConversationContext();
  if (!context.conversationId) throw new Error('Open a saved ChatGPT conversation before exporting.');
  const key = `${GRAPH_PREFIX}${context.conversationId}`;
  const result = await chrome.storage.local.get([key]);
  const graph = result?.[key];
  if (!graph || !Array.isArray(graph.nodes)) throw new Error('No Research Blackboard graph found for this conversation.');
  return { context, graph };
}

function downloadBlob(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function downloadDataUrl(filename, dataUrl) {
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function sortedNodes(graph) {
  return [...(graph.nodes || [])].sort((a, b) => {
    const ay = Number(a?.position?.y || 0);
    const by = Number(b?.position?.y || 0);
    if (ay !== by) return ay - by;
    return Number(a?.position?.x || 0) - Number(b?.position?.x || 0);
  });
}

function relationLines(node, graph, nodeMap) {
  return (graph.edges || [])
    .filter((edge) => edge.source === node.id || edge.target === node.id)
    .map((edge) => {
      const outgoing = edge.source === node.id;
      const otherId = outgoing ? edge.target : edge.source;
      const other = nodeMap.get(otherId);
      const relation = cleanText(edge?.data?.relation || edge?.label || 'informs');
      return `${outgoing ? '→' : '←'} ${relation} — ${cleanText(other?.data?.title || otherId)}`;
    });
}

function markdownForGraph(context, graph) {
  const nodes = sortedNodes(graph);
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const lines = [
    `# ${context.title}`,
    '',
    `> Exported from ChatGPT Research Blackboard · ${new Date().toISOString()}`,
    '',
    `**Nodes:** ${nodes.length} · **Relations:** ${(graph.edges || []).length}`,
    ''
  ];

  for (const node of nodes) {
    const data = node.data || {};
    const title = cleanText(data.title || 'Untitled research node');
    const type = cleanText(data.type || 'analysis');
    const keywords = Array.isArray(data.keywords) ? data.keywords.filter(Boolean) : [];
    const checkpoint = cleanText(data.checkpoint || '');
    const highlights = Array.isArray(data.highlights) ? data.highlights : [];
    const relations = relationLines(node, graph, nodeMap);

    lines.push(`## ${title}`, '', `**Type:** ${type}`);
    if (keywords.length) lines.push(`**Keywords:** ${keywords.join(' · ')}`);
    if (checkpoint) lines.push('', checkpoint);

    if (highlights.length) {
      lines.push('', `### Highlights (${highlights.length})`, '');
      for (const highlight of highlights) {
        const quote = cleanText(highlight?.quote || '');
        if (quote) lines.push(`> ${quote}`, '');
      }
    }

    if (relations.length) {
      lines.push('### Relations', '');
      relations.forEach((line) => lines.push(`- ${line}`));
      lines.push('');
    }
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

function canvasText(node) {
  const data = node.data || {};
  const keywords = Array.isArray(data.keywords) ? data.keywords.filter(Boolean) : [];
  const highlights = Array.isArray(data.highlights) ? data.highlights : [];
  const parts = [
    `# ${cleanText(data.title || 'Untitled research node')}`,
    '',
    `_${cleanText(data.type || 'analysis')}_`
  ];
  if (keywords.length) parts.push('', keywords.join(' · '));
  if (cleanText(data.checkpoint)) parts.push('', cleanText(data.checkpoint));
  if (highlights.length) {
    parts.push('', '## Highlights');
    highlights.forEach((item) => {
      const quote = cleanText(item?.quote || '');
      if (quote) parts.push(`- ${quote}`);
    });
  }
  return parts.join('\n');
}

function jsonCanvasForGraph(graph) {
  const nodes = (graph.nodes || []).map((node) => {
    const highlights = Array.isArray(node?.data?.highlights) ? node.data.highlights : [];
    const checkpointLength = cleanText(node?.data?.checkpoint || '').length;
    const height = clamp(150 + Math.ceil(checkpointLength / 45) * 20 + Math.min(highlights.length, 5) * 32, 150, 380);
    return {
      id: String(node.id),
      type: 'text',
      x: Math.round(Number(node?.position?.x || 0) * 1.5),
      y: Math.round(Number(node?.position?.y || 0) * 1.5),
      width: 320,
      height,
      text: canvasText(node)
    };
  });

  const edges = (graph.edges || []).map((edge, index) => ({
    id: String(edge.id || `edge-${index}`),
    fromNode: String(edge.source),
    fromSide: 'bottom',
    toNode: String(edge.target),
    toSide: 'top',
    label: cleanText(edge?.data?.relation || edge?.label || 'informs')
  }));

  return { nodes, edges };
}

function graphBounds(nodes) {
  if (!nodes.length) return { x: 0, y: 0, width: 800, height: 500 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    const x = Number(node?.position?.x || 0);
    const y = Number(node?.position?.y || 0);
    const width = Number(node?.measured?.width || node?.width || NODE_WIDTH);
    const height = Number(node?.measured?.height || node?.height || NODE_HEIGHT);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

async function clearTransientSelection() {
  const pane = document.querySelector('.main-content .react-flow__pane');
  if (!pane) return;
  pane.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function exportFullGraphPng(context, graph) {
  await clearTransientSelection();
  const viewport = document.querySelector('.main-content .react-flow__viewport');
  if (!viewport) throw new Error('Research graph canvas is not available.');

  const bounds = graphBounds(graph.nodes || []);
  const padding = 90;
  const imageWidth = Math.round(clamp(bounds.width + padding * 2, 900, 5000));
  const imageHeight = Math.round(clamp(bounds.height + padding * 2, 600, 5000));
  const zoom = Math.min(
    (imageWidth - padding * 2) / bounds.width,
    (imageHeight - padding * 2) / bounds.height,
    1.6
  );
  const x = padding - bounds.x * zoom + Math.max(0, (imageWidth - padding * 2 - bounds.width * zoom) / 2);
  const y = padding - bounds.y * zoom + Math.max(0, (imageHeight - padding * 2 - bounds.height * zoom) / 2);
  const maxPixels = 24_000_000;
  const pixelRatio = clamp(Math.sqrt(maxPixels / Math.max(1, imageWidth * imageHeight)), 1, 2);

  const { toPng } = await import('html-to-image');
  const dataUrl = await toPng(viewport, {
    backgroundColor: '#f8fafc',
    width: imageWidth,
    height: imageHeight,
    pixelRatio,
    cacheBust: true,
    filter: (domNode) => {
      if (!(domNode instanceof Element)) return true;
      return !domNode.classList.contains('react-flow__handle');
    },
    style: {
      width: `${imageWidth}px`,
      height: `${imageHeight}px`,
      transform: `translate(${x}px, ${y}px) scale(${zoom})`,
      transformOrigin: '0 0'
    }
  });

  downloadDataUrl(`${safeFilename(context.title)}-blackboard.png`, dataUrl);
}

export async function exportCurrentResearch(format) {
  const { context, graph } = await loadCurrentGraph();
  const base = safeFilename(context.title);

  if (format === 'package') {
    const payload = {
      format: 'chatgpt-research-blackboard',
      version: 1,
      exportedAt: new Date().toISOString(),
      conversation: context,
      graph
    };
    downloadBlob(`${base}.rbb.json`, `${JSON.stringify(payload, null, 2)}\n`, 'application/json;charset=utf-8');
    return 'Research package exported';
  }

  if (format === 'markdown') {
    downloadBlob(`${base}.md`, markdownForGraph(context, graph), 'text/markdown;charset=utf-8');
    return 'Markdown exported';
  }

  if (format === 'canvas') {
    downloadBlob(`${base}.canvas`, `${JSON.stringify(jsonCanvasForGraph(graph), null, 2)}\n`, 'application/json;charset=utf-8');
    return 'JSON Canvas exported';
  }

  if (format === 'png') {
    await exportFullGraphPng(context, graph);
    return 'Full graph PNG exported';
  }

  throw new Error(`Unknown export format: ${format}`);
}
