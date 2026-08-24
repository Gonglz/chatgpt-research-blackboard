/**
 * Side Panel React entrypoint.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import AutoGraphDeltaBridge from './components/AutoGraphDeltaBridge';
import DomGraphDeltaBridge from './components/DomGraphDeltaBridge';
import ResearchConversationSyncBridge from './components/ResearchConversationSyncBridge';
import ResearchLayoutBridge from './components/ResearchLayoutBridge';
import ResearchProjectMirrorBridge from './components/ResearchProjectMirrorBridge';
import SidecarPresenceBridge from './components/SidecarPresenceBridge';
import { STORAGE_KEYS } from '../shared/constants';

const container = document.getElementById('root');
const root = createRoot(container);
let researchRenderRevision = 0;

try {
  const params = new URLSearchParams(window.location.search);
  if (params.has('embedded')) {
    document.documentElement.classList.add('embedded');
  }
} catch {
  // ignore
}

/**
 * Apply sidepanel UI zoom (CSS zoom). This is independent from webpage zoom.
 * Note: we intentionally do NOT apply this in embedded mode (floating panel iframe).
 */
(() => {
  const isEmbedded = document.documentElement.classList.contains('embedded');
  if (isEmbedded) return;

  const clampZoom = (v) => {
    const z = Number(v);
    if (!Number.isFinite(z)) return 1;
    return Math.max(0.5, Math.min(2.5, z));
  };

  const applyZoom = (z) => {
    const zoom = clampZoom(z);
    document.documentElement.style.zoom = String(zoom);
  };

  try {
    chrome.storage.local.get(STORAGE_KEYS.SIDEPANEL_UI_ZOOM).then((res) => {
      applyZoom(res?.[STORAGE_KEYS.SIDEPANEL_UI_ZOOM] ?? 1);
    });
  } catch {
    // ignore
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (!changes?.[STORAGE_KEYS.SIDEPANEL_UI_ZOOM]) return;
      applyZoom(changes[STORAGE_KEYS.SIDEPANEL_UI_ZOOM].newValue ?? 1);
    });
  } catch {
    // ignore
  }
})();

function renderApp() {
  root.render(
    <React.StrictMode>
      <SidecarPresenceBridge />
      <ResearchConversationSyncBridge />
      <ResearchProjectMirrorBridge />
      <ResearchLayoutBridge />
      <DomGraphDeltaBridge />
      {/* Legacy reader for existing v2 HTML-comment RGΔ stored in conversation data. */}
      <AutoGraphDeltaBridge />
      <App key={`research-revision-${researchRenderRevision}`} />
    </React.StrictMode>
  );
}

// Automatic graph updates, Selection captures and structural layout writes remount
// App. Normal node dragging/editing does not touch these timestamps, preserving
// the user's current canvas and Detail state.
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    const researchChanged = Object.entries(changes || {}).some(([key, change]) => {
      if (!key.startsWith('researchBlackboard:') && !key.startsWith('researchProjectGraph:')) return false;
      const beforeDelta = change?.oldValue?.metadata?.lastDeltaAt || null;
      const afterDelta = change?.newValue?.metadata?.lastDeltaAt || null;
      const beforeSelection = change?.oldValue?.metadata?.lastSelectionAt || null;
      const afterSelection = change?.newValue?.metadata?.lastSelectionAt || null;
      const beforeLayout = change?.oldValue?.metadata?.lastLayoutAt || null;
      const afterLayout = change?.newValue?.metadata?.lastLayoutAt || null;
      return (!!afterDelta && beforeDelta !== afterDelta)
        || (!!afterSelection && beforeSelection !== afterSelection)
        || (!!afterLayout && beforeLayout !== afterLayout);
    });

    if (!researchChanged) return;
    researchRenderRevision += 1;
    renderApp();
  });
} catch {
  // ignore
}

renderApp();