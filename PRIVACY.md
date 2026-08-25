# Privacy

**English** | [简体中文](./PRIVACY_ZH.md)

ChatGPT Research Blackboard is a browser extension that runs alongside ChatGPT. This document describes the data behavior of the current source tree after the `v0.1.0` security cleanup.

This project does **not** operate a developer-owned cloud backend for collecting Research Blackboard data.

> Historical note: the published `v0.1.0` pre-release inherited a ChatGPT token-capture/internal-API compatibility layer from the upstream fork. That path has been removed from the current source tree and is not part of the next release candidate.

## Data handled by the extension

Depending on the features a user actually uses, the extension may handle:

- ChatGPT conversation content currently rendered and visible to the extension;
- message IDs, conversation IDs, and message-order metadata;
- Research Nodes, semantic edges, checkpoints, keywords, node positions, and layout metadata;
- saved Highlights, quoted text, and user notes;
- quote/message anchors used for source navigation;
- Research Project membership and conversation provenance;
- Research Blackboard data explicitly imported or exported by the user.

The current source does **not** capture or store ChatGPT Bearer access tokens, read ChatGPT authentication cookies for API access, or call ChatGPT private `/backend-api/` conversation endpoints.

## Local storage

Research Blackboard primarily stores state in browser-local extension storage (`chrome.storage.local`), including graph state, Highlights, notes, project/provenance metadata, layout state, and local UI state.

The inherited conversation cache may also keep DOM-derived conversation snapshots in extension-local IndexedDB for compatibility with source navigation and refresh behavior.

The project does not automatically upload these local stores to a developer-operated server. Data can remain in the current browser profile until it is cleared by the extension, the user, or the browser environment.

When the current version starts, it also removes legacy `v0.1.0` auth-storage keys (`accessToken`, `tokenTimestamp`, `tokenSource`, and `tokenInfo`) if they exist.

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

User-initiated source navigation uses the Chrome `scripting` API on the permitted ChatGPT hosts to locate the corresponding rendered message or exact quoted text, scroll it into view, and temporarily highlight it. This scripting path is not used to capture credentials or call ChatGPT private APIs.

## DOM-only conversation compatibility

The current source uses a DOM-only compatibility path for conversation snapshots and manual Refresh:

- it reads messages already rendered in the current ChatGPT page;
- it reconstructs a minimal local conversation mapping;
- it does not make authenticated private ChatGPT API requests;
- it does not use hidden ChatGPT branch controls to reveal non-rendered alternate branches.

This reduces credential and account-risk surface, but it means a snapshot can only contain conversation material available in the current DOM. Very long conversations or hidden alternate branches may therefore be incomplete in the compatibility cache.

## Browser permissions

The current manifest requests:

- `storage` — local Research Blackboard state and DOM-derived compatibility cache state;
- `sidePanel` — the Research Blackboard side panel;
- `scripting` — explicit source-location and exact Highlight navigation on the permitted ChatGPT pages.

Host access is limited to:

- `https://chatgpt.com/*`
- `https://chat.openai.com/*`

The current source does **not** request `webRequest` or broad `tabs` permission. `scripting` is retained because the current source-jump implementation uses `chrome.scripting.executeScript()` for user-initiated DOM location/highlighting. It is not used for request-header interception or dynamic content-script recovery.

Because host access is required for the extension's core purpose, the content scripts can read and modify ChatGPT pages on those hosts. They are not granted host access to unrelated websites.

## Extension reload behavior

The extension does not dynamically inject `dist/content.js` after an extension reload or update. If an already-open ChatGPT page has an invalidated extension context, refresh that ChatGPT tab to restore the manifest-declared content scripts.

## Third-party sharing and commercial use

The current project does not operate a developer-owned user-data backend and is not designed to:

- sell Research Graph data, ChatGPT content, or Highlights;
- transfer this data to advertising platforms, data brokers, or information resellers;
- use this data for personalized, retargeted, or interest-based advertising;
- allow project developers to read users' Research Graph or ChatGPT content through a developer backend.

Use of user data should remain limited to the extension's disclosed single purpose: helping users maintain, navigate, and export semantic research structure alongside long ChatGPT conversations.

## Chrome Web Store Limited Use statement

ChatGPT Research Blackboard's use of user data will comply with the Chrome Web Store User Data Policy, including the Limited Use requirements. User data will not be sold, used for personalized advertising, or used for purposes unrelated to the extension's disclosed single purpose.

The removal of credential interception plus `webRequest` and broad `tabs` permissions addresses the primary privacy blocker identified in `v0.1.0`. The retained `scripting` permission is scoped by ChatGPT host permissions and supports explicit source navigation/highlighting. A separate Chrome Web Store submission review is still required before claiming store readiness.

## Exports

When the user exports `.rbb.json`, Markdown, JSON Canvas, or PNG, the extension creates a local file. Exported files may contain research titles, checkpoints, quotes, notes, and conversation/message source metadata. The user controls how those files are stored or shared after export.

## Cross-chat projects

Research Projects may combine semantic nodes from multiple ChatGPT conversations in the local canonical project graph. Provenance records can contain conversation/message identifiers needed to return to source chats.

## Security and limitations

ChatGPT's DOM can change. Source navigation, DOM parsing, and DOM-derived refresh logic are best-effort and may break when ChatGPT changes its interface.

Do not use extension-local data as the only copy of important research. Use `.rbb.json` export for backups when the data matters.

This extension is not affiliated with, endorsed by, or sponsored by OpenAI.

For repository provenance and licensing status, see [NOTICE.md](./NOTICE.md) and [LICENSE_STATUS.md](./LICENSE_STATUS.md).
