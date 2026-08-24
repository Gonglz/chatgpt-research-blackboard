import React, { useEffect, useRef, useState } from 'react';
import {
  attachConversationToProject,
  createResearchProject,
  detachConversationFromProject,
  getConversationProject,
  listResearchProjects
} from '../utils/researchProjectStore';

const FONT_STACK = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

async function activeConversation() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = String(tab?.url || '');
  const conversationId = url.match(/\/c\/([a-zA-Z0-9-]+)/)?.[1] || null;
  const title = String(tab?.title || 'ChatGPT conversation').replace(/\s*[|·-]\s*ChatGPT\s*$/i, '').trim();
  return { conversationId, title };
}

export default function ResearchProjectSelector() {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState([]);
  const [current, setCurrent] = useState(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef(null);

  const refresh = async () => {
    const chat = await activeConversation();
    const [items, project] = await Promise.all([
      listResearchProjects(),
      chat.conversationId ? getConversationProject(chat.conversationId) : Promise.resolve(null)
    ]);
    setProjects(items);
    setCurrent(project);
  };

  useEffect(() => {
    void refresh();
    const listener = (changes, area) => {
      if (area !== 'local') return;
      if (Object.keys(changes || {}).some((key) => (
        key === 'researchProjects:index'
        || key.startsWith('researchProject:')
        || key.startsWith('researchConversationProject:')
      ))) void refresh();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [open]);

  const attach = async (projectId) => {
    if (busy) return;
    const chat = await activeConversation();
    if (!chat.conversationId) return;
    setBusy(true);
    try {
      if (current?.id === projectId) return;
      await attachConversationToProject(projectId, chat.conversationId, chat.title);
      setOpen(false);
      window.location.reload();
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (busy) return;
    const chat = await activeConversation();
    if (!chat.conversationId) return;
    const suggested = chat.title || 'Research Project';
    const title = window.prompt('Research project name', suggested);
    if (title === null || !title.trim()) return;
    setBusy(true);
    try {
      await createResearchProject(title.trim(), chat.conversationId, chat.title);
      setOpen(false);
      window.location.reload();
    } finally {
      setBusy(false);
    }
  };

  const detach = async () => {
    if (busy || !current) return;
    const chat = await activeConversation();
    if (!chat.conversationId) return;
    const ok = window.confirm(`Detach this chat from “${current.title}”?\n\nA local snapshot of the current project graph will be kept in this chat.`);
    if (!ok) return;
    setBusy(true);
    try {
      await detachConversationFromProject(chat.conversationId);
      setOpen(false);
      window.location.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={rootRef} style={{ position: 'relative', fontFamily: FONT_STACK }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="Research project"
        aria-label="Research project"
        style={{
          maxWidth: 180,
          height: 24,
          border: '1px solid #dbe3ee',
          borderRadius: 999,
          background: current ? '#f8fafc' : '#fff',
          color: '#475569',
          padding: '0 8px',
          fontFamily: FONT_STACK,
          fontSize: 10.5,
          lineHeight: '22px',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          cursor: 'pointer'
        }}
      >
        {current ? current.title : 'This chat'} ▾
      </button>

      {open ? (
        <div style={{
          position: 'absolute',
          right: 0,
          top: 30,
          width: 260,
          zIndex: 220,
          border: '1px solid #dbe3ee',
          borderRadius: 10,
          background: '#fff',
          boxShadow: '0 15px 36px rgba(15,23,42,.18)',
          padding: 7
        }}>
          <div style={{ padding: '3px 6px 6px', fontSize: 11.5, fontWeight: 700, color: '#111827' }}>Research scope</div>
          <div style={{ padding: '4px 6px 7px', fontSize: 10.5, lineHeight: '15px', color: '#64748b' }}>
            {current ? `Canonical graph: ${current.title}` : 'This conversation currently owns its own graph.'}
          </div>

          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              disabled={busy || current?.id === project.id}
              onClick={() => attach(project.id)}
              style={{
                width: '100%',
                border: 0,
                borderRadius: 7,
                background: current?.id === project.id ? '#f1f5f9' : 'transparent',
                padding: '7px 8px',
                textAlign: 'left',
                fontFamily: FONT_STACK,
                cursor: current?.id === project.id ? 'default' : 'pointer',
                color: '#334155'
              }}
            >
              <div style={{ fontSize: 12, lineHeight: '16px', fontWeight: 600 }}>{project.title}</div>
              <div style={{ marginTop: 1, fontSize: 10.5, lineHeight: '14px', color: '#94a3b8' }}>
                {(project.conversations || []).length} chat{(project.conversations || []).length === 1 ? '' : 's'}{current?.id === project.id ? ' · current' : ''}
              </div>
            </button>
          ))}

          <div style={{ borderTop: '1px solid #eef2f7', marginTop: 4, paddingTop: 5 }}>
            <button type="button" disabled={busy} onClick={create} style={menuButtonStyle}>+ New project…</button>
            {current ? <button type="button" disabled={busy} onClick={detach} style={menuButtonStyle}>Detach → This chat</button> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const menuButtonStyle = {
  width: '100%',
  border: 0,
  borderRadius: 7,
  background: 'transparent',
  padding: '7px 8px',
  textAlign: 'left',
  fontFamily: FONT_STACK,
  fontSize: 11.5,
  lineHeight: '16px',
  color: '#475569',
  cursor: 'pointer'
};
