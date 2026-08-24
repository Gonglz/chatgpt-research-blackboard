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

function relationOf(edge) {
  return String(edge?.data?.relation || edge?.label || 'informs').trim().toLowerCase();
}

/**
 * Early Selection/Highlight promotion code emitted generated deepens edges as
 * parent -> child, while RGΔ has always used child -> parent. Those edges are
 * identifiable by their provenance flags, so migrate them deterministically.
 *
 * New legacy-generated edges are also corrected here until all producers have
 * been converted. deepensDirectionVersion prevents a second reversal.
 */
function normalizeGeneratedDeepensDirections(edges = []) {
  let changed = false;
  const normalized = edges.map((edge) => {
    if (relationOf(edge) !== 'deepens') return edge;
    if (edge?.data?.deepensDirectionVersion === 2) return edge;
    const generatedLegacy = !!edge?.data?.createdFromSelection || !!edge?.data?.createdFromHighlight;
    if (!generatedLegacy) return edge;

    changed = true;
    return {
      ...edge,
      source: edge.target,
      target: edge.source,
      data: {
        ...(edge.data || {}),
        deepensDirectionVersion: 2,
        directionMigratedAt: Date.now()
      }
    };
  });
  return { changed, edges: normalized };
}

/**
 * Automatic layout lives outside ResearchBlackboard on purpose.
 *
 * Canonical graph owns semantics. This bridge owns only derived layout state:
 * - node/deepens structural changes -> ELK layout
 * - normal text/focus/selection/cross-edge changes -> no layout
 * - position-only changes -> remember as a soft user preference
 * - layout algorithm upgrades -> one clean relayout
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

        const directionMigration = normalizeGeneratedDeepensDirections(graph.edges);
        const workingGraph = directionMigration.changed
          ? { ...graph, edges: directionMigration.edges }
          : graph;

        const nodes = workingGraph.nodes;
        const edges = workingGraph.edges;
        const signature = researchStructuralSignature(nodes, edges);
        const previousLayoutState = workingGraph.metadata?.layoutState || {};
        const algorithmCurrent = previousLayoutState.algorithm === RESEARCH_LAYOUT_ALGORITHM;

        if (algorithmCurrent && previousLayoutState.structuralSignature === signature && !directionMigration.changed) {
          const captured = capturePreferredPositions(nodes, previousLayoutState);
          if (!captured.changed) return;

          const now = Date.now();
          await writeScopedGraphRecord(conversationId, {
            ...workingGraph,
            metadata: {
              ...(workingGraph.metadata || {}),
              layoutState: captured.layoutState,
              lastLayoutPreferenceAt: now
            },
            updatedAt: now
          });
          return;
        }

        // v3 is intentionally a true clean relayout. Earlier versions could
        // accidentally capture bad automatic positions as soft preferences, and
        // their vertical blending allowed children to drift back onto parent
        // ranks. Drop all old layout coordinates/preferences once on upgrade.
        const layoutInputState = algorithmCurrent
          ? previousLayoutState
          : {
              preferredPositions: {},
              backboneParentByNodeId: {},
              lastAppliedPositions: {}
            };

        const result = await layoutResearchGraph(nodes, edges, layoutInputState);
        if (disposed) return;

        const now = Date.now();
        await writeScopedGraphRecord(conversationId, {
          ...workingGraph,
          nodes: result.nodes,
          edges,
          metadata: {
            ...(workingGraph.metadata || {}),
            layoutState: result.layoutState,
            lastLayoutAt: now,
            layoutMigratedAt: algorithmCurrent ? workingGraph.metadata?.layoutMigratedAt : now,
            generatedDeepensMigratedAt: directionMigration.changed ? now : workingGraph.metadata?.generatedDeepensMigratedAt
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
