# ChatGPT Research Blackboard

A semantic research-graph sidecar for ChatGPT.

Instead of treating a long chat as a single scrollable transcript, Research Blackboard maintains a compact graph of the research itself: analyses, comparisons, open questions, syntheses, decisions, highlights, and the relationships between them.

> **Status:** usable MVP / dogfooding baseline. The extension is intended for desktop Chromium browsers and currently targets `chatgpt.com`.

> **Fork notice:** this repository is a fork and derivative work of [`Robbings/chatgpt-graph-navigator`](https://github.com/Robbings/chatgpt-graph-navigator). Research Blackboard reuses parts of the upstream browser-extension, ChatGPT DOM observation, conversation-cache, message anchoring, and navigation substrate, while replacing the primary product model and side-panel UI with a semantic research graph. See [NOTICE.md](./NOTICE.md).

> **Unofficial project:** this extension is not affiliated with, endorsed by, or sponsored by OpenAI.

## What it does

When the Research Blackboard side panel is open, the extension can maintain a semantic graph alongside the current ChatGPT conversation.

Core capabilities:

- **Automatic semantic graph maintenance** using a compact hidden graph-delta protocol attached to the active ChatGPT turn.
- **Semantic node types:** Analysis, Comparison, Question, Synthesis, and Judgment.
- **Semantic relationships:** `deepens`, `compares`, `supports`, `contradicts`, and `informs`.
- **Research-first layout:** ELK layered layout with `deepens` as the structural backbone, collision avoidance, soft drag preferences, and curved backbone routing.
- **Anchor-aware context retrieval:** when a prompt explicitly returns to an older topic, semantic anchors are preferred over recency so new nodes reconnect to the correct branch.
- **Highlights:** select text in a ChatGPT answer and save it to the most relevant research node.
- **Highlight management:** notes, ordering, move, delete, promote to node, demote back to highlight, and exact-source jumping.
- **Source navigation:** jump from research nodes/highlights back to the source ChatGPT message or quote.
- **Compact detail drawer:** node checkpoint, keywords, highlights, relations, and source controls without expanding nodes on the canvas.
- **Research Projects:** an experimental hybrid project graph that can be shared across attached chats while retaining conversation provenance.
- **Export:** Research Blackboard JSON (`.rbb.json`), Markdown, JSON Canvas (`.canvas`), and full-graph PNG.
- **Import:** restore a Research Blackboard package from `.rbb.json`.

## Mental model

Research Blackboard separates the conversation from the research structure.

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

A ChatGPT message is a **source container**. A Research Node is a **semantic research state**. They are intentionally not 1:1: one answer can update an existing node and, when warranted, create a genuinely new comparison, question, or synthesis.

### Node semantics

- **Analysis** — one explanatory or reasoning branch.
- **Comparison** — an explicit cross-case comparison.
- **Question** — a genuinely unresolved research question.
- **Synthesis** — a reusable higher-level takeaway created only when multiple existing branches actually converge.
- **Judgment** — an explicit decision, recommendation, ranking, or choice. It should be rare in open-ended exploratory research.

### Structural backbone

`deepens` is the only relation that controls vertical hierarchy.

The canonical semantic direction is:

```text
specific child --deepens--> broader parent
```

The visual layout reverses that for reading:

```text
broader parent
      ↓
more specific child
```

Other relations are contextual cross-links and do not determine rank.

## Installation from source

### Requirements

- Node.js 18+
- npm
- Chrome or another Chromium browser with Manifest V3 side panels

### Build

```bash
git clone https://github.com/Gonglz/chatgpt-research-blackboard.git
cd chatgpt-research-blackboard
npm install
npm run test
npm run build
```

Then open `chrome://extensions/`, enable **Developer mode**, choose **Load unpacked**, and select the **repository root** (the folder containing `manifest.json`). Do not select `dist/`.

The extension action opens the Research Blackboard side panel directly.

### Development

```bash
npm run dev
```

For a production-style build:

```bash
npm run build:release
```

## Typical workflow

1. Open a ChatGPT conversation.
2. Open the extension side panel. `● Live` means Research Mode is active.
3. Ask questions normally. The visible ChatGPT interaction does not need special graph commands.
4. Use the graph as an external spatial memory:
   - inspect a node for its checkpoint;
   - follow the semantic backbone;
   - click a node to inspect details;
   - save important answer text as Highlights;
   - jump back to source material when needed.
5. Export the research when needed.

The product principle is: **AI maintains structure by default; the user mainly corrects or curates.**

## Highlights

Select text inside a ChatGPT assistant response while the side panel is open. The selection toolbar offers:

- `★ Save` — attach the quote to the best matching existing node.
- `+ Node` — create a new Analysis / Comparison / Question from the selected text.

Each saved Highlight can be reordered, annotated, moved, deleted, promoted to a node, or opened at its exact source quote when the DOM anchor can be recovered safely.

## Projects

Research Projects use a hybrid model:

```text
Project
└─ canonical semantic graph
   ├─ Node A
   │  └─ sources: Chat 1, Chat 3
   └─ Edge X
      └─ sources: Chat 2
```

Nodes belong to the project-level graph; provenance belongs to individual conversations. This avoids blindly merging independent per-chat graphs while allowing multiple chats to contribute to the same research structure.

This feature is implemented but still needs broader real-world testing.

## Export and ownership

Available deterministic exports:

- **`.rbb.json`** — lossless Research Blackboard package for backup/import.
- **`.md`** — readable linear research notes.
- **`.canvas`** — JSON Canvas for compatible infinite-canvas tools such as Obsidian.
- **`.png`** — full graph image.

Research data is stored locally in the browser extension storage unless it is explicitly represented in the ChatGPT conversation through the graph-maintenance protocol described below.

## How automatic graph maintenance works

While the side panel is open, the content script appends a compact hidden Research Blackboard request (`RBREQ`) to the user turn. ChatGPT may append a machine-readable `RGΔ` block to its answer when the research graph meaningfully changes. The extension hides that block visually and applies the delta locally.

Context is deliberately compact. The current protocol prefers:

1. explicit semantic anchors in the user's new query;
2. closely related graph nodes/edges;
3. current internal context focus;
4. recency only as a weak tie-breaker.

This is intended to support non-linear research where the user frequently returns to earlier branches.

## Privacy and permissions

Read [PRIVACY.md](./PRIVACY.md) before using the extension.

Important points:

- Research graph data and highlights are primarily stored in `chrome.storage.local`.
- The extension does not operate its own cloud backend.
- When Research Mode is active, the hidden RBREQ instructions are appended to the ChatGPT request, so that protocol text is sent to ChatGPT as part of the conversation request.
- The fork still contains an inherited ChatGPT conversation-cache/auth compatibility layer used by explicit refresh/fallback paths. See the privacy document for details.

## Tests

```bash
npm test
npm run build
```

The regression suite covers the RGΔ parser/reducer and the structural layout invariants that previously caused the most serious graph errors: canonical `deepens` direction, backbone parent selection, vertical rank, and same-rank collision avoidance.

GitHub Actions runs tests and a build on pushes and pull requests.

> The current committed `package-lock.json` originated from the upstream project and is not yet synchronized with all new dependencies. CI intentionally uses `npm install` rather than `npm ci` until a regenerated lockfile is committed.

## Architecture

```text
chatgpt.com
   ↓
content scripts
├─ inherited DOM/conversation substrate
├─ research-producer (RBREQ v7)
└─ research-selection
   ↓
Chrome local storage / background compatibility cache
   ↓
Research Blackboard side panel
├─ semantic graph reducer
├─ project/provenance scope
├─ ELK structural layout
├─ Highlight manager
├─ source jumping
└─ export/import
```

The extension intentionally does **not** use a separate OpenAI API key, external RAG service, or project-specific cloud backend for the core Research Blackboard workflow.

## Upstream and attribution

This repository remains a GitHub fork of [`Robbings/chatgpt-graph-navigator`](https://github.com/Robbings/chatgpt-graph-navigator). Do not remove the GitHub fork relationship or upstream attribution when redistributing this derivative work.

Research Blackboard-specific work includes, among other changes:

- semantic research node/edge model;
- automatic RGΔ graph maintenance and compact context protocol;
- anchor-aware topic return;
- Highlights and quote-level provenance;
- project-level canonical graphs;
- ELK semantic-backbone layout and routing;
- Research Blackboard detail/hover UX;
- export/import formats.

See [NOTICE.md](./NOTICE.md) for a clearer separation of upstream-derived and fork-specific areas.

## License status

**Do not rely on the old MIT/GPL labels previously present in this fork.**

The upstream repository currently has inconsistent licensing metadata: its README states GPL-3.0, while its `package.json` states MIT, and no root `LICENSE` file is present in the upstream repository snapshot reviewed for this fork.

Because this is a derivative work, this fork does not unilaterally choose a license for upstream code. See [LICENSE_STATUS.md](./LICENSE_STATUS.md) before redistribution or publishing packaged binaries.

## Contributing

Pull requests are welcome. Please keep the core product constraint in mind: Research Blackboard should reduce cognitive load, not turn graph maintenance into another manual knowledge-management job.

For changes that affect semantic graph behavior, include or update a regression test whenever practical.
