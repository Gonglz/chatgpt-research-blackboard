import {
  conversationProjectKey,
  projectGraphKey
} from '../../shared/researchScope';

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function conversationIdFromUrl(url) {
  try {
    const parsed = new URL(url || '');
    if (parsed.hostname !== 'chatgpt.com' && parsed.hostname !== 'chat.openai.com') return null;
    return parsed.pathname.match(/\/c\/([a-zA-Z0-9-]+)/)?.[1] || null;
  } catch {
    return null;
  }
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function runAnchorJump(tabId, anchor) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      args: [anchor],
      func: (payload) => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const escapeValue = (value) => (
          window.CSS?.escape
            ? window.CSS.escape(value)
            : String(value).replace(/["\\]/g, '\\$&')
        );

        const messageId = payload?.messageId || '';
        const expectedRole = normalize(payload?.role).toLowerCase();
        const preview = normalize(payload?.preview);
        const tail = normalize(payload?.tail);
        const expectedLength = Number(payload?.textLength) || 0;
        const expectedMessageIndex = Number.isInteger(payload?.messageIndex) ? payload.messageIndex : -1;
        const expectedRoleIndex = Number.isInteger(payload?.roleIndex) ? payload.roleIndex : -1;

        const findContainer = (node) => {
          if (!node) return null;
          const section = node.matches?.('section[data-turn-id]')
            ? node
            : node.closest?.('section[data-turn-id]');
          if (section) return section;
          if (node.matches?.('article')) return node;
          return node.closest?.('article') || node;
        };

        const highlightAndScroll = (element, method, score = null) => {
          const target = findContainer(element);
          if (!target) return { success: false, method };
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const previousOutline = target.style.outline;
          const previousOutlineOffset = target.style.outlineOffset;
          target.style.outline = '2px solid rgba(59, 130, 246, 0.75)';
          target.style.outlineOffset = '4px';
          window.setTimeout(() => {
            target.style.outline = previousOutline;
            target.style.outlineOffset = previousOutlineOffset;
          }, 2200);
          return { success: true, method, score };
        };

        if (messageId) {
          const escaped = escapeValue(messageId);
          const exact =
            document.querySelector(`[data-message-id="${escaped}"]`) ||
            document.querySelector(`[data-turn-id="${escaped}"]`) ||
            document.querySelector(`[id="image-${escaped}"]`);
          if (exact) return highlightAndScroll(exact, 'exact-id');
        }

        if (!preview) return { success: false, method: 'no-preview' };

        const rawContainers = Array.from(document.querySelectorAll('section[data-turn-id], article'));
        const containers = [];
        const seen = new Set();
        for (const raw of rawContainers) {
          const canonical = findContainer(raw);
          if (!canonical || seen.has(canonical)) continue;
          seen.add(canonical);
          containers.push(canonical);
        }

        const candidates = [];
        const roleCounters = new Map();
        const startNeedle = preview.slice(0, Math.min(180, preview.length));
        const shortNeedle = startNeedle.slice(0, Math.min(84, startNeedle.length));
        const tailNeedle = tail.slice(-Math.min(140, tail.length));

        containers.forEach((container, index) => {
          const roleNode = container.matches?.('[data-message-author-role]')
            ? container
            : container.querySelector?.('[data-message-author-role]');
          const candidateRole = normalize(roleNode?.getAttribute?.('data-message-author-role')).toLowerCase();
          const currentRoleIndex = roleCounters.get(candidateRole) || 0;
          roleCounters.set(candidateRole, currentRoleIndex + 1);
          if (expectedRole && candidateRole && expectedRole !== candidateRole) return;

          const text = normalize(container.innerText || container.textContent || '');
          if (!text) return;
          let score = 0;
          let fingerprintHits = 0;
          if (expectedRole && candidateRole === expectedRole) score += 4;
          if (startNeedle.length >= 24 && text.includes(startNeedle)) {
            score += 14;
            fingerprintHits += 1;
          } else if (shortNeedle.length >= 24 && text.includes(shortNeedle)) {
            score += 9;
            fingerprintHits += 1;
          }
          if (tailNeedle.length >= 24 && text.includes(tailNeedle)) {
            score += 12;
            fingerprintHits += 1;
          }
          if (expectedLength > 0) {
            const ratio = Math.abs(text.length - expectedLength) / Math.max(expectedLength, 1);
            if (ratio <= 0.08) score += 5;
            else if (ratio <= 0.20) score += 3;
            else if (ratio <= 0.40) score += 1;
          }
          if (expectedRoleIndex >= 0 && candidateRole === expectedRole) {
            const distance = Math.abs(currentRoleIndex - expectedRoleIndex);
            if (distance === 0) score += 7;
            else if (distance === 1) score += 2;
          }
          if (expectedMessageIndex >= 0) {
            const distance = Math.abs(index - expectedMessageIndex);
            if (distance === 0) score += 4;
            else if (distance === 1) score += 1;
          }
          candidates.push({ container, score, fingerprintHits });
        });

        candidates.sort((a, b) => b.score - a.score);
        const best = candidates[0];
        const second = candidates[1];
        if (!best || best.score < 10) return { success: false, method: 'not-found', bestScore: best?.score || 0 };
        const margin = best.score - (second?.score || 0);
        if (second && margin < 3 && best.fingerprintHits < 2) {
          return { success: false, method: 'ambiguous', bestScore: best.score, secondScore: second.score };
        }
        return highlightAndScroll(best.container, 'fingerprint', best.score);
      }
    });
    return results?.[0]?.result || { success: false, method: 'no-result' };
  } catch (error) {
    return { success: false, method: 'execute-failed', error: error?.message || String(error) };
  }
}

function sourceConversationForAnchor(graph, anchor, currentConversationId) {
  const messageId = anchor?.messageId || null;
  if (!messageId || !graph) return null;
  const candidates = [];

  for (const node of graph.nodes || []) {
    for (const source of node?.data?.sources || []) {
      if (source?.messageId === messageId && source?.conversationId) candidates.push(source.conversationId);
    }
    for (const highlight of node?.data?.highlights || []) {
      if (highlight?.messageId === messageId && highlight?.conversationId) candidates.push(highlight.conversationId);
    }
  }

  return candidates.find((conversationId) => conversationId !== currentConversationId)
    || candidates[0]
    || null;
}

async function projectSourceConversation(currentConversationId, anchor) {
  if (!currentConversationId) return null;
  try {
    const mappingKey = conversationProjectKey(currentConversationId);
    const mapping = await chrome.storage.local.get([mappingKey]);
    const projectId = mapping?.[mappingKey] || null;
    if (!projectId) return null;
    const key = projectGraphKey(projectId);
    const record = await chrome.storage.local.get([key]);
    return sourceConversationForAnchor(record?.[key], anchor, currentConversationId);
  } catch {
    return null;
  }
}

async function waitForConversationTab(tabId, conversationId, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (conversationIdFromUrl(tab?.url || '') === conversationId && tab?.status === 'complete') {
        return true;
      }
    } catch {
      return false;
    }
    await delay(180);
  }
  return false;
}

/**
 * Project-aware Research source jump.
 * 1) Search current Chat fail-closed.
 * 2) If absent, consult canonical Project provenance.
 * 3) Navigate the same ChatGPT tab to the source conversation and retry.
 * Never clicks ChatGPT branch navigation controls.
 */
export async function jumpToResearchSource(anchor) {
  if (!anchor?.messageId && !cleanText(anchor?.preview)) return false;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return false;
  const currentConversationId = conversationIdFromUrl(tab.url || '');
  if (!currentConversationId) return false;

  const local = await runAnchorJump(tab.id, anchor);
  if (local.success) return true;

  const sourceConversationId = await projectSourceConversation(currentConversationId, anchor);
  if (!sourceConversationId || sourceConversationId === currentConversationId) return false;

  const sourceUrl = `https://chatgpt.com/c/${encodeURIComponent(sourceConversationId)}`;
  await chrome.tabs.update(tab.id, { url: sourceUrl });
  const loaded = await waitForConversationTab(tab.id, sourceConversationId);
  if (!loaded) return false;

  // The tab may report complete before ChatGPT has hydrated message DOM. Retry
  // the exact/fingerprint matcher for a short bounded window.
  for (let attempt = 0; attempt < 10; attempt++) {
    await delay(attempt === 0 ? 350 : 420);
    const result = await runAnchorJump(tab.id, anchor);
    if (result.success) return true;
  }

  return false;
}
