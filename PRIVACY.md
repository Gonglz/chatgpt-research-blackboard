# Privacy

ChatGPT Research Blackboard is a browser extension that runs alongside ChatGPT. This document describes the data behavior of the current source tree.

This project does **not** operate its own cloud backend for Research Blackboard data.

## Research graph data

The extension stores Research Blackboard state primarily in browser-local extension storage (`chrome.storage.local`). This includes, depending on use:

- research nodes and semantic edges;
- node positions and layout metadata;
- checkpoints and keywords;
- Highlights and user notes;
- ChatGPT message/quote anchors used for source navigation;
- project membership and provenance metadata;
- export/import-related local state.

This data remains in the local browser profile unless the user exports it or the browser/extension environment synchronizes storage independently of this project.

## Research Mode protocol sent to ChatGPT

When the Research Blackboard side panel is open, Research Mode is active.

The extension appends a compact hidden Research Blackboard instruction (`RBREQ`) to the user's outgoing ChatGPT turn. The instruction contains a limited local graph context selected for the current question. It may include:

- semantic node IDs;
- compact node titles/keywords;
- a small set of semantic relationships;
- an internal context focus or semantic anchor.

Because RBREQ is appended to the ChatGPT turn, **that protocol text is sent to ChatGPT/OpenAI as part of the normal conversation request**.

When ChatGPT returns a machine-readable `RGΔ` block, the extension hides that block from the visible conversation UI and applies the graph delta locally. The response itself is still generated within the ChatGPT service and may therefore be subject to ChatGPT/OpenAI's own data handling and retention policies.

## Highlights and source anchors

When the user selects text in a ChatGPT assistant response and chooses `★ Save`, the extension stores the selected quote and local source-anchor information so it can reconnect the Highlight to a Research Node and later attempt an exact source jump.

The extension does not send a saved Highlight to a separate project-operated server.

## Inherited conversation-cache/auth compatibility layer

This repository is a fork of `Robbings/chatgpt-graph-navigator` and still contains an inherited compatibility layer for conversation caching and explicit refresh/fallback behavior.

That layer includes code that can observe ChatGPT request traffic to capture a ChatGPT access token and store it locally for ChatGPT backend synchronization. The current Research Blackboard workflow does not require users to manually paste a token, and the legacy popup/setup flow is not part of the public UI.

The token compatibility code is retained to avoid breaking source/cache fallback paths while the fork is being stabilized. It should be treated as security-sensitive code.

The project does not intentionally send captured ChatGPT credentials to a third-party server operated by this project.

## Browser permissions

The extension currently requests permissions including:

- `storage` — local Research Blackboard and compatibility state;
- `sidePanel` — the Research Blackboard side panel;
- `tabs` — follow the active ChatGPT conversation and support cross-chat source navigation;
- `scripting` — inherited/compatibility browser-extension behavior on ChatGPT pages;
- `webRequest` — inherited ChatGPT token/conversation compatibility behavior.

Host access is limited in the manifest to ChatGPT domains used by the extension (`chatgpt.com` and the legacy `chat.openai.com` host).

## Exports

When the user exports `.rbb.json`, Markdown, JSON Canvas, or PNG, the extension creates a local download. Exported files may contain research titles, checkpoints, quotes, notes, and source metadata. The user is responsible for how those files are stored or shared after export.

## Cross-chat projects

Research Projects may combine semantic nodes from multiple ChatGPT conversations in the local canonical project graph. Provenance records can contain conversation/message identifiers needed to return to source chats.

## No affiliation

This extension is not affiliated with, endorsed by, or sponsored by OpenAI.

## Security and limitations

ChatGPT's DOM and internal request behavior can change. Source navigation, DOM parsing, and compatibility refresh logic are best-effort and may break when ChatGPT changes its interface.

Do not use the extension as the only copy of important research data. Use `.rbb.json` export for backups when the data matters.

For repository provenance and licensing status, see [NOTICE.md](./NOTICE.md) and [LICENSE_STATUS.md](./LICENSE_STATUS.md).
