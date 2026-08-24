import React, { useEffect } from 'react';
import { useConversationData } from '../hooks/useConversationData';
import { useAutoGraphDelta } from '../hooks/useAutoGraphDelta';

/**
 * Headless bridge: reuse the existing conversation-data pipeline and apply RGΔ
 * messages even when the user is currently looking at Graph/Tree instead of the
 * Research Blackboard view.
 */
export default function AutoGraphDeltaBridge() {
  const { conversationData } = useConversationData();
  const { revision, lastResult } = useAutoGraphDelta(conversationData);

  useEffect(() => {
    window.__researchDeltaRevision = revision;
    window.__researchDeltaResult = lastResult;
  }, [revision, lastResult]);

  return null;
}
