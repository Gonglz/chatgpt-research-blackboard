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

async function runExactHighlightJump(tabId, highlight, durationMs = 5000) {
  const payload = {
    messageId: highlight?.messageId || '',
    quote: cleanText(highlight?.quote || ''),
    paragraph: cleanText(highlight?.localParagraph || ''),
    durationMs: Math.max(1000, Number(durationMs) || 5000)
  };
  if (!payload.quote) return { success: false, method: 'no-quote' };

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      args: [payload],
      func: (input) => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const escapeValue = (value) => window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');
        const duration = Math.max(1000, Number(input.durationMs) || 5000);

        const findContainer = () => {
          if (input.messageId) {
            const id = escapeValue(input.messageId);
            const exact = document.querySelector(`[data-turn-id="${id}"]`) || document.querySelector(`[data-message-id="${id}"]`);
            if (exact) return exact.closest('section[data-turn-id], article') || exact;
          }
          return Array.from(document.querySelectorAll('section[data-turn-id], article'))
            .find((el) => normalize(el.innerText || el.textContent || '').includes(input.quote)) || null;
        };

        const container = findContainer();
        if (!container) return { success: false, method: 'message-not-found' };
        const blocks = Array.from(container.querySelectorAll('p, li, blockquote, td, th, h1, h2, h3, h4, h5, h6, div'));
        let target = blocks.find((el) => normalize(el.innerText || el.textContent || '').includes(input.quote));
        if (!target && input.paragraph) {
          const probe = input.paragraph.slice(0, 120);
          target = blocks.find((el) => normalize(el.innerText || el.textContent || '').includes(probe));
        }
        target ||= container;

        const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
        const chars = [];
        const map = [];
        let lastWasSpace = false;
        let node;
        while ((node = walker.nextNode())) {
          const text = node.nodeValue || '';
          for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (/\s/.test(ch)) {
              if (chars.length && !lastWasSpace) {
                chars.push(' ');
                map.push({ node, offset: i });
                lastWasSpace = true;
              }
            } else {
              chars.push(ch);
              map.push({ node, offset: i });
              lastWasSpace = false;
            }
          }
        }

        const normalizedTarget = chars.join('').trim();
        const quote = normalize(input.quote);
        const start = normalizedTarget.indexOf(quote);
        if (start >= 0 && map[start] && map[start + quote.length - 1]) {
          const startPoint = map[start];
          const endPoint = map[start + quote.length - 1];
          const range = document.createRange();
          range.setStart(startPoint.node, startPoint.offset);
          range.setEnd(endPoint.node, Math.min((endPoint.node.nodeValue || '').length, endPoint.offset + 1));
          (range.startContainer.parentElement || target).scrollIntoView({ behavior: 'smooth', block: 'center' });
          try {
            if (window.Highlight && window.CSS?.highlights) {
              let style = document.getElementById('research-blackboard-exact-highlight-style');
              if (!style) {
                style = document.createElement('style');
                style.id = 'research-blackboard-exact-highlight-style';
                style.textContent = '::highlight(research-blackboard-exact){ background: #fde68a; color: inherit; }';
                document.head.appendChild(style);
              }
              window.CSS.highlights.set('research-blackboard-exact', new Highlight(range));
              window.setTimeout(() => window.CSS.highlights.delete('research-blackboard-exact'), duration);
              return { success: true, method: 'exact-range' };
            }
          } catch {
            // fall through
          }
        }

        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const previous = target.style.backgroundColor;
        target.style.backgroundColor = '#fef3c7';
        window.setTimeout(() => { target.style.backgroundColor = previous; }, duration);
        return { success: true, method: 'block-fallback' };
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
      if (conversationIdFromUrl(tab?.url || '') === conversationId && tab?.status === 'complete') return true;
    } catch {
      return false;
    }
    await delay(180);
  }
  return false;
}

async function navigateToConversation(tabId, conversationId) {
  await chrome.tabs.update(tabId, { url: `https://chatgpt.com/c/${encodeURIComponent(conversationId)}` });
  return waitForConversationTab(tabId, conversationId);
}

/** Project-aware node/message source jump; never clicks branch navigation. */
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
  if (!(await navigateToConversation(tab.id, sourceConversationId))) return false;

  for (let attempt = 0; attempt < 10; attempt++) {
    await delay(attempt === 0 ? 350 : 420);
    const result = await runAnchorJump(tab.id, anchor);
    if (result.success) return true;
  }
  return false;
}

/** Project-aware exact Highlight jump with a persistent 5s default highlight. */
export async function jumpToResearchHighlightSource(highlight, durationMs = 5000) {
  if (!cleanText(highlight?.quote)) return false;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return false;
  const currentConversationId = conversationIdFromUrl(tab.url || '');
  if (!currentConversationId) return false;

  // Always try current Chat first: imported/legacy Highlights may lack conversationId.
  const local = await runExactHighlightJump(tab.id, highlight, durationMs);
  if (local.success) return true;

  const anchor = {
    messageId: highlight?.messageId || null,
    preview: highlight?.messagePreview || '',
    tail: highlight?.messageTail || ''
  };
  const sourceConversationId = highlight?.conversationId
    || await projectSourceConversation(currentConversationId, anchor);
  if (!sourceConversationId || sourceConversationId === currentConversationId) return false;
  if (!(await navigateToConversation(tab.id, sourceConversationId))) return false;

  for (let attempt = 0; attempt < 10; attempt++) {
    await delay(attempt === 0 ? 350 : 420);
    const result = await runExactHighlightJump(tab.id, highlight, durationMs);
    if (result.success) return true;
  }
  return false;
}
