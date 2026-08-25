# Privacy

**English** | [简体中文](./PRIVACY_ZH.md)

ChatGPT Research Blackboard is a browser extension that runs alongside ChatGPT. This document describes the actual data behavior of the current source tree, including the `v0.1.0` pre-release.

This project does **not** operate a developer-owned cloud backend for collecting Research Blackboard data.

## Data handled by the extension

Depending on the features a user actually uses, the extension may handle:

- ChatGPT conversation content visible to the extension, message IDs, conversation IDs, and message-order metadata;
- Research Nodes, semantic edges, checkpoints, keywords, node positions, and layout metadata;
- saved Highlights, quoted text, and user notes;
- quote/message anchors used for source navigation;
- Research Project membership and conversation provenance;
- Research Blackboard data explicitly imported or exported by the user;
- ChatGPT authentication/account metadata used by the inherited compatibility layer described below.

## Local storage

Research Blackboard primarily stores state in browser-local extension storage (`chrome.storage.local`), including graph state, Highlights, notes, project/provenance metadata, layout/UI state, and compatibility auth state.

The inherited conversation compatibility layer may also cache ChatGPT conversation data in extension-local IndexedDB.

The project does not automatically upload these local stores to a developer-operated server. Data can remain in the current browser profile until it is cleared by the extension, the user, or the browser environment.

## Research Mode protocol sent to ChatGPT

When the Research Blackboard side panel is open, Research Mode appends a compact hidden Research Blackboard instruction (`RBREQ`) to the user's outgoing ChatGPT turn.

RBREQ may contain:

- semantic node IDs;
- compressed node titles, keywords, and checkpoint context;
- a small set of semantic relationships;
- an internal context focus or semantic anchor.

Because RBREQ is appended to the ChatGPT turn, **that protocol text is sent to ChatGPT/OpenAI as part of the normal conversation request**.

When ChatGPT returns a machine-readable `RGΔ` block, the extension hides that block from the visible conversation UI and applies the graph delta locally. The response is still generated within ChatGPT and is therefore subject to ChatGPT/OpenAI's own data handling and retention policies.

## Highlights and source anchors

When the user selects text in a ChatGPT assistant response and chooses `★ Save`, the extension may store the selected quote, local message/conversation anchor information, nearby text needed for exact source recovery, and an optional user note.

Saved Highlights are not sent to a separate project-operated server.

## Inherited conversation-cache/auth compatibility layer

This repository is a fork of `Robbings/chatgpt-graph-navigator` and `v0.1.0` still contains an inherited compatibility layer used for explicit Refresh/fallback and conversation caching.

That layer currently can:

- use `webRequest` to observe requests sent to ChatGPT;
- capture a ChatGPT Bearer access token from request headers;
- store the access token, timestamp, and related metadata in `chrome.storage.local`;
- read accessible ChatGPT page cookie values such as `_account` and `oai-did`;
- send authenticated requests to ChatGPT's own internal conversation endpoints when fallback/refresh behavior is invoked.

**The current code is not designed to send captured ChatGPT credentials to a developer-operated third-party server.**

This is nevertheless security-sensitive behavior. The current compatibility code stores the captured access token in extension-local storage and does not add a separate application-level at-rest encryption layer.

## Chrome Web Store readiness

The current `v0.1.0` GitHub pre-release is **not yet recommended for Chrome Web Store submission**.

The primary privacy blocker is that the inherited token-capture path is initialized in the background without a dedicated explicit opt-in / informed-consent flow before capture begins.

Before a Chrome Web Store submission, the recommended direction is to:

1. remove the token-capture / `webRequest` compatibility layer entirely if possible, or gate it behind explicit informed consent;
2. re-audit `tabs`, `scripting`, `webRequest`, and host permissions so that only the narrowest permissions necessary for current user-facing features remain;
3. accurately disclose handling of ChatGPT page content, conversation text, Highlights, and conversation/message identifiers in the Store listing and Privacy practices tab;
4. redesign token storage and lifecycle if authentication handling remains necessary.

## Browser permissions

The current manifest requests:

- `storage` — local Research Blackboard and compatibility state;
- `sidePanel` — the Research Blackboard side panel;
- `tabs` — follow the active ChatGPT conversation and support cross-chat source navigation;
- `scripting` — inherited/compatibility behavior;
- `webRequest` — inherited ChatGPT token-capture/compatibility behavior.

Host access is currently limited to:

- `https://chatgpt.com/*`
- `https://chat.openai.com/*`

## Third-party sharing and commercial use

The current project does not operate a developer-owned user-data backend and is not designed to:

- sell Research Graph data, ChatGPT content, or Highlights;
- transfer this data to advertising platforms, data brokers, or information resellers;
- use this data for personalized, retargeted, or interest-based advertising;
- allow project developers to read users' Research Graph or ChatGPT content through a developer backend.

Use of user data should remain limited to the extension's disclosed single purpose: helping users maintain, navigate, and export semantic research structure alongside long ChatGPT conversations.

## Chrome Web Store Limited Use statement

ChatGPT Research Blackboard's use of user data will comply with the Chrome Web Store User Data Policy, including the Limited Use requirements. User data will not be sold, used for personalized advertising, or used for purposes unrelated to the extension's disclosed single purpose.

## Exports

When the user exports `.rbb.json`, Markdown, JSON Canvas, or PNG, the extension creates a local file. Exported files may contain research titles, checkpoints, quotes, notes, and conversation/message source metadata. The user controls how those files are stored or shared after export.

## Cross-chat projects

Research Projects may combine semantic nodes from multiple ChatGPT conversations in the local canonical project graph. Provenance records can contain conversation/message identifiers needed to return to source chats.

## Security and limitations

ChatGPT's DOM and internal request behavior can change. Source navigation, DOM parsing, and compatibility refresh logic are best-effort and may break when ChatGPT changes its interface.

Do not use extension-local data as the only copy of important research. Use `.rbb.json` export for backups when the data matters.

This extension is not affiliated with, endorsed by, or sponsored by OpenAI.

For repository provenance and licensing status, see [NOTICE.md](./NOTICE.md) and [LICENSE_STATUS.md](./LICENSE_STATUS.md).
