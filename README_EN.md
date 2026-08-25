# ChatGPT Research Blackboard

[简体中文](./README.md) | **English**

A semantic research-graph sidecar for ChatGPT.

Instead of treating a long chat as one transcript, Research Blackboard maintains the structure of the research itself: analyses, comparisons, open questions, syntheses, judgments, highlights, and the relationships between them.

> **Status:** usable MVP / public pre-release. Desktop Chromium, currently targeting `chatgpt.com`.

> **Fork notice:** this repository is a fork and derivative work of [`Robbings/chatgpt-graph-navigator`](https://github.com/Robbings/chatgpt-graph-navigator). It reuses parts of the upstream Chrome-extension infrastructure, ChatGPT DOM observation, conversation cache, message anchoring, and navigation substrate while replacing the primary product model and side-panel UI with a semantic research graph. See [NOTICE.md](./NOTICE.md).

> **Unofficial project:** not affiliated with, endorsed by, or sponsored by OpenAI.

## What it does

- **Automatic semantic graph maintenance** through the hidden `RBREQ / RGΔ` protocol.
- **Node types:** Analysis, Comparison, Question, Synthesis, Judgment.
- **Relations:** `deepens`, `compares`, `supports`, `contradicts`, `informs`.
- **Research-first layout:** ELK layered layout, `deepens` backbone, collision avoidance, soft drag preferences, curved routing.
- **Anchor-aware context:** explicit returns to older topics outrank mere recency.
- **Highlights:** save selected answer text to the best-matching node; annotate, reorder, move, delete, promote/demote, and jump back to the source quote.
- **Source jumps:** double-click a node to return to its rendered source message; Highlight Source attempts exact quote location with temporary highlighting.
- **Compact detail surface:** checkpoint, keywords, highlights, relations, and source controls without expanding canvas nodes.
- **Research Projects:** experimental project-level canonical graph with per-conversation provenance.
- **Export:** `.rbb.json`, Markdown, JSON Canvas, full-graph PNG.
- **Import:** restore `.rbb.json` packages.

## Mental model

```text
ChatGPT conversation
        ↓
local reasoning / source material
        ↓
Research Blackboard
├─ Analysis
├─ Comparison
├─ Question
├─ Synthesis
└─ Judgment
```

A ChatGPT message is a **source container**. A Research Node is a **semantic research state**. They are intentionally not 1:1.

Only `deepens` controls vertical hierarchy:

```text
specific child --deepens--> broader parent
```

The visual layout reverses that relation for reading:

```text
broader parent
      ↓
more specific child
```

## Installation

### Recommended: GitHub Release

1. Open the [Releases page](https://github.com/Gonglz/chatgpt-research-blackboard/releases).
2. Download `chatgpt-research-blackboard-v0.1.1.zip` from the latest pre-release.
3. Extract the ZIP.
4. Open `chrome://extensions/`.
5. Enable **Developer mode**.
6. Click **Load unpacked** and select the extracted folder containing `manifest.json`.

> `v0.1.1` is the recommended pre-release. Do not continue using the old `v0.1.0` package; v0.1.1 removes the inherited ChatGPT token-capture/private-API compatibility path.

### From source

Requirements: Node.js 18+, npm, and a Chromium browser with Manifest V3 side panels.

```bash
git clone https://github.com/Gonglz/chatgpt-research-blackboard.git
cd chatgpt-research-blackboard
npm ci
npm test
npm run build
```

Then open `chrome://extensions/`, enable **Developer mode**, choose **Load unpacked**, and select the repository root containing `manifest.json` — not `dist/`.

## Typical workflow

1. Open a ChatGPT conversation.
2. Open the extension side panel. `● Live` means Research Mode is active.
3. Ask questions normally; no graph commands are required.
4. Use the graph as external spatial memory: inspect nodes, follow the backbone, save Highlights, and jump back to sources.
5. Export important research when needed.

Product principle: **AI maintains structure by default; the user mainly corrects or curates.**

## Highlights and source jumps

While the side panel is open, select text in a ChatGPT assistant response:

- `★ Save` saves it to the best-matching existing node.
- `+ Node` creates a new Research Node from the selection.

Highlights support notes, reordering, moving, deletion, promotion to a node, and demotion back to a Highlight.

Source behavior:

- double-clicking a Research Node returns to the corresponding currently rendered ChatGPT message and briefly outlines it;
- `↗ Source` on a Highlight attempts to locate the exact quote and highlights it for about five seconds.

Source location is guaranteed only for content available in the currently rendered DOM. Cross-chat source jump remains experimental and is not a stable guarantee in this release.

## Research Projects

```text
Project
└─ canonical semantic graph
   ├─ Node A
   │  └─ sources: Chat 1, Chat 3
   └─ Edge X
      └─ sources: Chat 2
```

Nodes belong to the Project; provenance belongs to individual conversations. The Project data model is implemented, while cross-chat source navigation still needs more real-world validation.

## Privacy and security

Read [PRIVACY.md](./PRIVACY.md) and the [Chinese privacy note](./PRIVACY_ZH.md).

Important facts about `v0.1.1`:

- Research Graph state, Highlights, and Project metadata are primarily stored in `chrome.storage.local`.
- DOM-derived conversation snapshots may also be cached locally in IndexedDB.
- The project operates **no developer-owned cloud backend** for Research Blackboard data.
- While Research Mode is active, hidden RBREQ context is sent to ChatGPT/OpenAI as part of the normal conversation request.
- It **does not capture or store ChatGPT Bearer access tokens**.
- It **does not read ChatGPT authentication cookies for API access**.
- It **does not call ChatGPT private `/backend-api/` conversation endpoints**.
- The manifest no longer requests `webRequest` or broad `tabs` permission.
- `scripting` remains only for explicit user-initiated source-location and exact-Highlight DOM highlighting on the permitted ChatGPT hosts.

On startup, v0.1.1 also removes legacy v0.1.0 token-storage keys if they still exist in `chrome.storage.local`.

### DOM-only trade-off

Manual Refresh and the compatibility snapshot are reconstructed from the current ChatGPT DOM:

- currently rendered conversation content is supported;
- hidden alternative branches are no longer read through private APIs;
- very long conversations may have incomplete snapshots if ChatGPT virtualizes or lazily renders older messages.

This trade-off intentionally reduces credential and account-risk surface.

### Chrome Web Store readiness

v0.1.1 removes the primary privacy blockers found in v0.1.0: token interception, `webRequest`, and private conversation API access.

It is still not labeled Chrome Web Store ready. A separate review of Store listing disclosures, Privacy practices, and permission justification is required before submission.

## Automatic graph maintenance

While the side panel is open, the content script appends a compact hidden Research Blackboard request (`RBREQ`) to the outgoing user turn. ChatGPT may append a machine-readable `RGΔ` block when the graph meaningfully changes; the extension hides that block visually and applies the delta locally.

Context selection prioritizes:

1. explicit semantic anchors in the new query;
2. closely related graph nodes and edges;
3. current internal context focus;
4. recency only as a weak tie-breaker.

## Export and ownership

- **`.rbb.json`** — lossless Research Blackboard package for backup/import.
- **`.md`** — readable linear research notes.
- **`.canvas`** — JSON Canvas for compatible infinite-canvas tools such as Obsidian.
- **`.png`** — full graph image.

Exported files may contain research titles, checkpoints, quotes, notes, and source metadata. Treat them as potentially sensitive research material.

## Tests and CI

```bash
npm ci
npm test
npm run build
```

Regression coverage includes:

- RGΔ parser/reducer behavior;
- Synthesis/Judgment parsing;
- canonical `deepens` direction;
- backbone parent/depth selection;
- cycle handling, vertical rank, same-rank collision avoidance;
- privacy boundaries preventing `webRequest`, token capture, and `/backend-api/` access;
- source-jump / exact-Highlight dependency on `scripting`, preventing accidental permission removal from breaking those features again.

GitHub Actions runs `npm ci`, tests, and build on pushes and pull requests.

`npm audit --omit=dev` reports zero production dependency vulnerabilities for the current release candidate. The remaining audit item is an esbuild development-tool advisory and is intentionally not force-upgraded.

## Architecture

```text
chatgpt.com
   ↓
content scripts
├─ research-runtime (DOM-only conversation bootstrap)
├─ research-producer (RBREQ v7)
└─ research-selection
   ↓
Chrome local storage / DOM-derived compatibility cache
   ↓
Research Blackboard side panel
├─ semantic graph reducer
├─ project / provenance scope
├─ ELK structural layout
├─ Highlight manager
├─ source jump
└─ export / import
```

The core Research Blackboard workflow does not require a separate OpenAI API key, external RAG service, or project-operated cloud backend.

## Upstream and attribution

This repository remains a GitHub fork of [`Robbings/chatgpt-graph-navigator`](https://github.com/Robbings/chatgpt-graph-navigator). Do not remove the fork relationship or upstream attribution when redistributing this derivative work.

Research Blackboard-specific work includes the semantic research model, automatic graph protocol, semantic-anchor retrieval, Highlights/provenance, project graphs, ELK backbone layout/routing, Research Blackboard UX, and export/import.

See [NOTICE.md](./NOTICE.md).

## License status

The upstream repository currently has inconsistent licensing metadata: its README states GPL-3.0, its `package.json` states MIT, and no root `LICENSE` file was present in the upstream snapshot reviewed for this fork.

Because this is a derivative work, this fork does not unilaterally choose a license for upstream code. See [LICENSE_STATUS.md](./LICENSE_STATUS.md) before redistribution or publishing packaged binaries.

## Contributing

Pull requests are welcome. For changes to semantic graph behavior, source navigation, layout, or Highlight provenance, add or update a regression test whenever practical.

The core product constraint is simple: **reduce cognitive load; do not turn graph maintenance into another manual knowledge-management job.**
