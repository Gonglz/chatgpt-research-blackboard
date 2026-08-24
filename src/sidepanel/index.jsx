/**
 * Side Panel React entrypoint.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import AutoGraphDeltaBridge from './components/AutoGraphDeltaBridge';
import ResearchConversationSyncBridge from './components/ResearchConversationSyncBridge';
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
      <AutoGraphDeltaBridge />
      <App key={`research-revision-${researchRenderRevision}`} />
    </React.StrictMode>
  );
}

// Only auto-delta writes should remount App. Normal research graph saves caused by
// dragging/editing nodes preserve lastDeltaAt and therefore do not disturb the UI.
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    const deltaChanged = Object.entries(changes || {}).some(([key, change]) => {
      if (!key.startsWith('researchBlackboard:')) return false;
      const before = change?.oldValue?.metadata?.lastDeltaAt || null;
      const after = change?.newValue?.metadata?.lastDeltaAt || null;
      return !!after && before !== after;
    });

    if (!deltaChanged) return;
    researchRenderRevision += 1;
    renderApp();
  });
} catch {
  // ignore
}

renderApp();
