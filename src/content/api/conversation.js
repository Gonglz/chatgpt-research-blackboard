/**
 * Conversation bootstrap from the current ChatGPT DOM.
 *
 * The inherited extension fetched ChatGPT's private/internal conversation API
 * with a captured bearer token. Research Blackboard no longer does that. This
 * module preserves the old function names temporarily, but reconstructs the
 * minimal mapping shape from message containers already rendered in the page.
 */

import { log } from '../../shared/utils.js';
import { getAllMessagesFromDOM } from '../extractors/message-extractor.js';

const DOM_WAIT_TIMEOUT_MS = 6000;
const DOM_STABLE_INTERVAL_MS = 250;
const DOM_STABLE_PASSES = 2;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toMappingNode(message, fallbackParent = null, order = 0) {
  const id = message.id;
  const timestamp = Number(message.timestamp) || (Date.now() + order);

  return {
    id,
    message: {
      id,
      author: {
        role: message.role
      },
      content: {
        content_type: 'text',
        parts: [message.content || '']
      },
      create_time: timestamp / 1000,
      metadata: {
        source: 'dom',
        dom_snapshot: true,
        timestamp,
        turn_number: message.turnNumber ?? null,
        stream_group_key: message.streamGroupKey || null,
        stream_group_part_index: message.streamGroupPartIndex ?? null,
        stream_group_part_count: message.streamGroupPartCount ?? null,
        stream_part_ids: [id]
      }
    },
    parent: message.parent || fallbackParent || null,
    children: []
  };
}

function buildMapping(messages) {
  const mapping = {};
  const knownIds = new Set(messages.map((message) => message.id).filter(Boolean));

  messages.forEach((message, index) => {
    if (!message?.id) return;

    const previousId = index > 0 ? messages[index - 1]?.id || null : null;
    const declaredParent = message.parent && knownIds.has(message.parent)
      ? message.parent
      : null;

    mapping[message.id] = toMappingNode(
      message,
      declaredParent || previousId,
      index
    );
  });

  Object.values(mapping).forEach((node) => {
    if (!node.parent || !mapping[node.parent]) {
      node.parent = null;
      return;
    }

    const parentChildren = mapping[node.parent].children;
    if (!parentChildren.includes(node.id)) {
      parentChildren.push(node.id);
    }
  });

  return mapping;
}

async function waitForStableDOMMessages() {
  const startedAt = Date.now();
  let previousSignature = '';
  let stablePasses = 0;
  let latestMessages = [];

  while (Date.now() - startedAt < DOM_WAIT_TIMEOUT_MS) {
    latestMessages = getAllMessagesFromDOM();

    const signature = latestMessages
      .map((message) => `${message.id}:${message.role}:${(message.content || '').length}`)
      .join('|');

    if (latestMessages.length > 0 && signature === previousSignature) {
      stablePasses += 1;
      if (stablePasses >= DOM_STABLE_PASSES) {
        return latestMessages;
      }
    } else {
      stablePasses = 0;
      previousSignature = signature;
    }

    await sleep(DOM_STABLE_INTERVAL_MS);
  }

  return latestMessages;
}

/**
 * Compatibility name retained for callers. No network request is made.
 */
export async function fetchConversationWithRetry(conversationId) {
  log('info', 'DOMSnapshot', `Building conversation snapshot from DOM: ${conversationId}`);

  const messages = await waitForStableDOMMessages();
  const mapping = buildMapping(messages);
  const now = Date.now() / 1000;

  log('info', 'DOMSnapshot', 'Conversation snapshot built', {
    conversationId,
    messageCount: messages.length,
    mappingSize: Object.keys(mapping).length
  });

  return {
    id: conversationId,
    title: document.title || 'Research Blackboard',
    create_time: null,
    update_time: now,
    mapping,
    source: 'dom'
  };
}

/**
 * There is no internal API dependency in DOM-only mode.
 */
export async function checkAPIAvailability() {
  return true;
}
