import React, { useEffect, useRef, useState } from 'react';
import { exportCurrentResearch } from '../utils/researchExport';

const FONT_STACK = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

const OPTIONS = [
  { id: 'package', label: 'Research package', ext: '.rbb.json', hint: 'Lossless backup' },
  { id: 'markdown', label: 'Markdown', ext: '.md', hint: 'Readable research notes' },
  { id: 'canvas', label: 'JSON Canvas', ext: '.canvas', hint: 'Open canvas format' },
  { id: 'png', label: 'Full graph PNG', ext: '.png', hint: 'Presentation image' }
];

export default function ResearchExportButton() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState('');
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  const runExport = async (format) => {
    if (busy) return;
    setBusy(format);
    setStatus('');
    try {
      const message = await exportCurrentResearch(format);
      setStatus(message);
      window.setTimeout(() => setOpen(false), 650);
    } catch (error) {
      console.error('[ResearchExport] failed:', error);
      setStatus(error?.message || 'Export failed');
    } finally {
      setBusy('');
    }
  };

  return (
    <div ref={rootRef} style={{ position: 'relative', fontFamily: FONT_STACK }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="Export Research Blackboard"
        aria-label="Export Research Blackboard"
        style={{
          width: 28,
          height: 28,
          border: open ? '1px solid #94a3b8' : '1px solid #e2e8f0',
          borderRadius: 8,
          background: '#fff',
          color: '#475569',
          display: 'grid',
          placeItems: 'center',
          cursor: 'pointer',
          fontSize: 15,
          lineHeight: 1
        }}
      >
        ⇩
      </button>

      {open ? (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 34,
            width: 260,
            zIndex: 200,
            border: '1px solid #dbe3ee',
            borderRadius: 11,
            background: 'rgba(255,255,255,.99)',
            boxShadow: '0 16px 38px rgba(15,23,42,.18)',
            padding: 7,
            color: '#111827'
          }}
        >
          <div style={{ padding: '3px 6px 6px', fontSize: 12, lineHeight: '16px', fontWeight: 700 }}>Export Blackboard</div>
          {OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => runExport(option.id)}
              disabled={!!busy}
              style={{
                width: '100%',
                border: 0,
                borderRadius: 8,
                background: busy === option.id ? '#f1f5f9' : 'transparent',
                padding: '7px 8px',
                display: 'grid',
                gridTemplateColumns: 'minmax(0,1fr) auto',
                gap: '2px 8px',
                textAlign: 'left',
                cursor: busy ? 'wait' : 'pointer',
                fontFamily: FONT_STACK,
                color: '#111827'
              }}
              onMouseEnter={(event) => { if (!busy) event.currentTarget.style.background = '#f8fafc'; }}
              onMouseLeave={(event) => { if (busy !== option.id) event.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontSize: 12.5, lineHeight: '17px', fontWeight: 600 }}>{busy === option.id ? 'Exporting…' : option.label}</span>
              <span style={{ fontSize: 11, lineHeight: '16px', color: '#94a3b8' }}>{option.ext}</span>
              <span style={{ gridColumn: '1 / -1', fontSize: 10.5, lineHeight: '15px', color: '#64748b' }}>{option.hint}</span>
            </button>
          ))}
          {status ? (
            <div style={{ marginTop: 5, padding: '6px 7px 2px', borderTop: '1px solid #eef2f7', fontSize: 10.5, lineHeight: '15px', color: status.toLowerCase().includes('failed') || status.startsWith('No ') || status.startsWith('Open ') ? '#b91c1c' : '#64748b' }}>
              {status}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
