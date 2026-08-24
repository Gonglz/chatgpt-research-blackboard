import React, { useEffect, useRef } from 'react';
import { loadScopedGraphRecord, writeScopedGraphRecord } from '../../shared/researchScope';
import {
  capturePreferredPositions,
  layoutResearchGraph,
  researchStructuralSignature,
  RESEARCH_LAYOUT_ALGORITHM
} from '../utils/researchLayout';

const STORAGE_PREFIXES = ['researchBlackboard:', 'researchProjectGraph:', 'researchConversationProject:'];
const DEBOUNCE_MS = 180;

function conversationIdFromUrl(url) {
  return String(url || '').match(/\/c\/([a-zA-Z0-9-]+)/)?.[1] || null;
}

async function activeConversationId() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return conversationIdFromUrl(tab?.url || '');
  } catch {
    return null;
  }
}

function isRelevantStorageChange(changes) {
  return Object.keys(changes || {}).some((key) => STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix)));
}

/**
 * Automatic layout lives outside ResearchBlackboard on purpose.
 *
 * Canonical graph owns semantics. This bridge owns only derived layout state:
 * - node/deepens structural changes -> ELK layout
 * - normal text/focus/selection/cross-edge changes -> no layout
 * - position-only changes -> remember as a soft user preference
 * - layout algorithm upgrades -> one clean relayout, preserving true drag prefs
 */
export default function ResearchLayoutBridge() {
  const timerRef = useRef(null);
  const runningRef = useRef(false);
  const rerunRef = useRef(false);

  useEffect(() => {
    let disposed = false;

    const process = async () => {
      if (disposed) return;
      if (runningRef.current) {
        rerunRef.current = true;
        return;
      }

      runningRef.current = true;
      try {
        const conversationId = await activeConversationId();
        if (!conversationId) return;

        const { graph } = await loadScopedGraphRecord(conversationId);
        if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || !graph.nodes.length) return;

        const nodes = graph.nodes;
        const edges = graph.edges;
        const signature = researchStructuralSignature(nodes, edges);
        const previousLayoutState = graph.metadata?.layoutState || {};
        const algorithmCurrent = previousLayoutState.algorithm === RESEARCH_LAYOUT_ALGORITHM;

        if (algorithmCurrent && previousLayoutState.structuralSignature === signature) {
          const captured = capturePreferredPositions(nodes, previousLayoutState);
          if (!captured.changed) return;

          const now = Date.now();
          await writeScopedGraphRecord(conversationId, {
            ...graph,
            metadata: {
              ...(graph.metadata || {}),
              layoutState: captured.layoutState,
              lastLayoutPreferenceAt: now
            },
            updatedAt: now
          });
          return;
        }

        // v1 interpreted canonical deepens direction backwards. On the v2
        // migration we intentionally discard old ELK positions/backbone parents
        // once, while retaining only explicit soft drag preferences.
        const layoutInputState = algorithmCurrent
          ? previousLayoutState
          : {
              preferredPositions: { ...(previousLayoutState?.preferredPositions || {}) },
              backboneParentByNodeId: {},
              lastAppliedPositions: {}
            };

        const result = await layoutResearchGraph(nodes, edges, layoutInputState);
        if (disposed) return;

        const now = Date.now();
        await writeScopedGraphRecord(conversationId, {
          ...graph,
          nodes: result.nodes,
          metadata: {
            ...(graph.metadata || {}),
            layoutState: result.layoutState,
            lastLayoutAt: now,
            layoutMigratedAt: algorithmCurrent ? graph.metadata?.layoutMigratedAt : now
          },
          updatedAt: now
        });
      } catch (error) {
        console.warn('[ResearchLayout] layout skipped:', error?.message || error);
      } finally {
        runningRef.current = false;
        if (rerunRef.current && !disposed) {
          rerunRef.current = false;
          schedule();
        }
      }
    };

    const schedule = () => {
      if (disposed) return;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void process();
      }, DEBOUNCE_MS);
    };

    const onStorageChanged = (changes, area) => {
      if (area !== 'local' || !isRelevantStorageChange(changes)) return;
      schedule();
    };

    const onTabUpdated = (_tabId, changeInfo) => {
      if (changeInfo?.url || changeInfo?.status === 'complete') schedule();
    };

    chrome.storage.onChanged.addListener(onStorageChanged);
    chrome.tabs.onUpdated.addListener(onTabUpdated);
    schedule();

    return () => {
      disposed = true;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      chrome.storage.onChanged.removeListener(onStorageChanged);
      chrome.tabs.onUpdated.removeListener(onTabUpdated);
    };
  }, []);

  return null;
}
