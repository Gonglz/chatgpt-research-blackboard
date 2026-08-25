# ChatGPT Research Blackboard

A semantic research-graph sidecar for ChatGPT.

Instead of treating a long chat as a single transcript, Research Blackboard maintains a compact graph of the research itself: analyses, comparisons, open questions, syntheses, decisions, highlights, and the relationships between them.

> **Status:** usable MVP / dogfooding baseline. Desktop Chromium, currently targeting `chatgpt.com`.

> **Fork notice:** this repository is a fork and derivative work of [`Robbings/chatgpt-graph-navigator`](https://github.com/Robbings/chatgpt-graph-navigator). Research Blackboard reuses parts of the upstream browser-extension, ChatGPT DOM observation, conversation-cache, message anchoring, and navigation substrate, while replacing the primary product model and side-panel UI with a semantic research graph. See [NOTICE.md](./NOTICE.md).

> **Unofficial project:** not affiliated with, endorsed by, or sponsored by OpenAI.

## What it does

When the side panel is open, the extension can maintain a semantic graph alongside the active ChatGPT conversation.

- **Automatic graph maintenance** through a compact hidden `RBREQ` / `RGΔ` protocol.
- **Node types:** Analysis, Comparison, Question, Synthesis, Judgment.
- **Relations:** `deepens`, `compares`, `supports`, `contradicts`, `informs`.
- **Research-first layout:** ELK layered layout, `deepens` backbone, collision avoidance, soft drag preferences, curved routing.
- **Anchor-aware context:** explicit returns to older topics are preferred over mere recency.
- **Highlights:** save selected answer text to the best matching node; annotate, reorder, move, delete, promote/demote, and jump back to the quote.
- **Compact detail drawer:** checkpoint, keywords, highlights, relations, and source controls without expanding canvas nodes.
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

### Node semantics

- **Analysis** — one explanatory or reasoning branch.
- **Comparison** — an explicit cross-case comparison.
- **Question** — a genuinely unresolved research question.
- **Synthesis** — a reusable higher-level takeaway created only when multiple existing branches actually converge.
- **Judgment** — an explicit decision, recommendation, ranking, or choice; it should be rare in open-ended exploratory research.

### Structural backbone

Only `deepens` controls vertical hierarchy.

Canonical semantic direction:

```text
specific child --deepens--> broader parent
```

Visual reading direction:

```text
broader parent
      ↓
more specific child
```

Other relations are contextual cross-links and do not determine rank.

## Installation from source

Requirements: Node.js 18+, npm, and a Chromium browser with Manifest V3 side panels.

```bash
git clone https://github.com/Gonglz/chatgpt-research-blackboard.git
cd chatgpt-research-blackboard
npm install
npm test
npm run build
```

Then open `chrome://extensions/`, enable **Developer mode**, choose **Load unpacked**, and select the **repository root** containing `manifest.json` — not `dist/`.

Clicking the extension action opens the Research Blackboard side panel directly.

Development build:

```bash
npm run dev
```

Production-style build:

```bash
npm run build:release
```

## Typical workflow

1. Open a ChatGPT conversation.
2. Open the extension side panel. `● Live` means Research Mode is active.
3. Ask questions normally; no graph commands are required.
4. Use the graph as external spatial memory: inspect nodes, follow the backbone, save Highlights, and jump back to sources.
5. Export important research when needed.

Product principle: **AI maintains structure by default; the user mainly corrects or curates.**

## Highlights

Select text inside a ChatGPT assistant response while the side panel is open:

- `★ Save` attaches the quote to the best matching existing node.
- `+ Node` creates a new Analysis / Comparison / Question from the selection.

Saved Highlights support notes, ordering, move/delete, promote to node, demote back to Highlight, and exact-source jumping when the DOM anchor can be recovered safely.

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

Nodes belong to the project graph; provenance belongs to individual conversations. This feature is implemented but still needs broader real-world testing.

## Export and ownership

- **`.rbb.json`** — lossless Research Blackboard package for backup/import.
- **`.md`** — readable linear research notes.
- **`.canvas`** — JSON Canvas for compatible infinite-canvas tools such as Obsidian.
- **`.png`** — full graph image.

Research state is primarily stored locally in browser extension storage.

## Automatic graph maintenance

While the side panel is open, the content script appends a compact hidden Research Blackboard request (`RBREQ`) to the outgoing user turn. ChatGPT may append a machine-readable `RGΔ` block when the graph meaningfully changes; the extension hides that block visually and applies the delta locally.

Context is deliberately compact. The current protocol prioritizes:

1. explicit semantic anchors in the user's new query;
2. closely related graph nodes/edges;
3. current internal context focus;
4. recency only as a weak tie-breaker.

This supports non-linear research where the user frequently returns to earlier branches.

## Privacy and permissions

Read [PRIVACY.md](./PRIVACY.md).

Important points:

- Research graph data and Highlights are primarily stored in `chrome.storage.local`.
- The project does not operate its own cloud backend.
- While Research Mode is active, the hidden RBREQ text is sent to ChatGPT as part of the normal conversation request.
- The fork still contains an inherited conversation-cache/auth compatibility layer used by explicit refresh/fallback paths.

## Tests and CI

```bash
npm test
npm run build
```

Regression tests cover the RGΔ parser/reducer plus critical layout invariants: canonical `deepens` direction, backbone parent selection, vertical rank, and same-rank collision avoidance.

GitHub Actions runs install, tests, and build on pushes and pull requests.

The stale upstream `package-lock.json` was removed because it no longer matched Research Blackboard dependencies. CI intentionally uses `npm install` for now. A future local `npm install` can regenerate and commit a new lockfile; CI can then switch to `npm ci`.

## Architecture

```text
chatgpt.com
   ↓
content scripts
├─ upstream-derived DOM / conversation substrate
├─ research-producer (RBREQ v7)
└─ research-selection
   ↓
Chrome local storage / background compatibility cache
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

**Do not rely on the old MIT/GPL labels previously present in this fork.**

The upstream repository currently has inconsistent licensing metadata: its README states GPL-3.0, its `package.json` states MIT, and no root `LICENSE` file was present in the upstream snapshot reviewed for this fork.

Because this is a derivative work, this fork does not unilaterally choose a license for upstream code. See [LICENSE_STATUS.md](./LICENSE_STATUS.md) before redistribution or publishing packaged binaries.

## Contributing

Pull requests are welcome. For changes to semantic graph behavior, add or update a regression test whenever practical.

The core product constraint is simple: **reduce cognitive load; do not turn graph maintenance into another manual knowledge-management job.**
