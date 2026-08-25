# Notice and upstream attribution

`ChatGPT Research Blackboard` is a derivative work based on the GitHub repository:

- **Upstream project:** `Robbings/chatgpt-graph-navigator`
- **Upstream repository:** https://github.com/Robbings/chatgpt-graph-navigator
- **Fork repository:** https://github.com/Gonglz/chatgpt-research-blackboard

The GitHub fork relationship should be preserved.

## Upstream-derived areas

Substantial portions of the browser-extension substrate originate from or were adapted from the upstream project, including parts of:

- Chrome Manifest V3 extension scaffolding;
- ChatGPT DOM observation and conversation parsing;
- message and branch anchoring/navigation infrastructure;
- background service worker, cache/database, and authentication compatibility code;
- side-panel shell and shared browser-extension utilities;
- selected assets and localization resources that remain in the repository.

Those areas have also received modifications in this fork.

## Research Blackboard-specific work

The fork substantially changes the primary product model and adds, among other work:

- semantic research nodes: Analysis, Comparison, Question, Synthesis, Judgment;
- semantic research relations and the `deepens` structural backbone;
- automatic `RBREQ` / `RGΔ` graph maintenance;
- compact graph-local context retrieval and semantic-anchor topic return;
- Highlight capture, annotation, move/order/delete, promote/demote, and quote provenance;
- project-level canonical graphs with conversation provenance;
- ELK layered research layout, collision avoidance, soft drag preference, and curved backbone routing;
- compact node cards, hover preview, detail drawer, and Research Blackboard-specific UI;
- `.rbb.json`, Markdown, JSON Canvas, PNG export and package import.

## OpenAI / ChatGPT

This project is an independent browser extension. It is not affiliated with, endorsed by, or sponsored by OpenAI.

## Licensing

The upstream repository's licensing metadata is internally inconsistent. See [LICENSE_STATUS.md](./LICENSE_STATUS.md). This notice is attribution and provenance documentation; it does not itself grant or replace a software license.
