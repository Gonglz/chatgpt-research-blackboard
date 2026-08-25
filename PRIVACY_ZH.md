# 隐私说明

[English](./PRIVACY.md) | **简体中文**

ChatGPT Research Blackboard 是一个运行在 ChatGPT 页面旁边的浏览器扩展。本文件描述当前代码树（包括 `v0.1.0` Pre-release）的实际数据行为。

本项目**不运营用于收集 Research Blackboard 数据的自建云端后端**。

## 处理的数据

根据用户实际使用功能，扩展可能处理以下数据：

- ChatGPT 当前页面中可见的对话内容、消息 ID、conversation ID 与消息顺序信息；
- Research Node、Semantic Edge、Checkpoint、关键词、Node 位置和 layout metadata；
- 用户保存的 Highlight、原文引用和 Note；
- 用于 source jump 的 quote/message anchor；
- Research Project membership 与 conversation provenance；
- 用户主动导入或导出的 Research Blackboard 数据；
- inherited compatibility layer 使用的 ChatGPT authentication / account metadata（见下文）。

## 本地存储

Research Blackboard 主要把以下状态存储在浏览器扩展本地存储 `chrome.storage.local`：

- Research Graph；
- Highlights / Notes；
- Project / provenance metadata；
- layout 与本地 UI 状态；
- compatibility auth state。

上游遗留的 conversation compatibility layer 还可能把 ChatGPT conversation data 缓存在扩展本地 IndexedDB 中。

这些数据不会因为本项目而自动上传到开发者自建服务器。它们会持续保存在当前浏览器 Profile 中，直到扩展代码、用户操作或浏览器环境将其清除。

## Research Mode 会发送什么给 ChatGPT

当 Research Blackboard Sidepanel 打开时，Research Mode 会给用户即将发送的 ChatGPT 消息附加一段紧凑的隐藏 `RBREQ`。

RBREQ 可能包含：

- semantic node ID；
- Node title / keyword / checkpoint 的压缩信息；
- 少量 semantic edge；
- 当前内部 focus 或 semantic anchor。

因此，**RBREQ 会作为正常 ChatGPT 对话请求的一部分发送给 ChatGPT / OpenAI**。

ChatGPT 返回的 `RGΔ` 由扩展在页面上隐藏并在本地消费，但该回复仍然由 ChatGPT 服务生成，因此受 ChatGPT / OpenAI 自身的数据处理和保留政策约束。

## Highlight 与 Source Anchor

当用户在 ChatGPT Assistant 回答中选中文字并点击 `★ Save` 时，扩展会保存：

- 被选中的 quote；
- message/conversation anchor；
- 为精确 source jump 所需的局部上下文信息；
- 用户可选的 Note。

这些数据不会被发送到本项目自建服务器。

## 上游遗留的 Auth / Conversation Compatibility Layer

本仓库 fork 自 `Robbings/chatgpt-graph-navigator`，当前 `v0.1.0` 仍保留一层上游 compatibility code，用于 explicit Refresh / fallback 与 conversation cache。

该层目前可以：

- 使用 `webRequest` 观察发往 ChatGPT 的请求；
- 从 ChatGPT 请求头中捕获 Bearer access token；
- 把 access token、时间戳和相关 metadata 存到 `chrome.storage.local`；
- 从 ChatGPT 页面读取 `_account` 和 `oai-did` 等可访问 cookie 值；
- 在需要时向 ChatGPT 自身的内部 conversation endpoint 发起请求。

**当前扩展没有把这些 ChatGPT 凭据发送到开发者自建第三方服务器的设计路径。**

但是，这部分属于 security-sensitive 行为。当前 token 是由扩展自身保存在本地扩展存储中，扩展没有额外提供独立的 at-rest encryption 层。

## Chrome Web Store 适配状态

当前 `v0.1.0` 是 GitHub Pre-release，**还不建议直接提交 Chrome Web Store**。

主要原因是 inherited token capture 会在后台自动启用，而当前没有独立的、在捕获开始前完成的 explicit opt-in / informed-consent 流程。

在正式提交 Chrome Web Store 前，建议优先：

1. 完全移除 token capture 和 `webRequest` compatibility；或至少改成用户主动启用后才工作；
2. 重新审计 `tabs`、`scripting`、`webRequest` 等权限，只保留产品当前功能必需的最小权限；
3. 在 Chrome Web Store Listing 与 Privacy practices 中准确披露 ChatGPT 页面内容、对话文本、Highlight、conversation/message identifiers 等数据处理；
4. 如果仍保留 authentication handling，重新设计 token storage 与 lifecycle，避免不必要的长期凭据存储。

## 浏览器权限

当前 manifest 请求：

- `storage` — Research Blackboard 与 compatibility 本地状态；
- `sidePanel` — Research Blackboard Sidepanel；
- `tabs` — 跟随当前 ChatGPT tab、跨 Chat Source Navigation；
- `scripting` — inherited / compatibility 行为；
- `webRequest` — inherited ChatGPT token capture / compatibility 行为。

Host access 当前限制在：

- `https://chatgpt.com/*`
- `https://chat.openai.com/*`

## 第三方共享与商业使用

本项目当前没有开发者自建的用户数据后端，也没有设计：

- 出售用户 Research Graph、Chat 内容或 Highlight；
- 把这些数据提供给广告平台 / data broker；
- 使用这些数据做 personalized / retargeted advertising；
- 让项目开发者通过后台人工读取用户的 Research Graph 或 Chat 内容。

Research Blackboard 对用户数据的使用应限定在提供和改进其单一用户可见目的：帮助用户在 ChatGPT 长研究对话中维护、浏览和导出语义研究结构。

## Chrome Web Store Limited Use 声明

ChatGPT Research Blackboard 对用户数据的使用将遵守 Chrome Web Store User Data Policy，包括 Limited Use 要求。用户数据不会被出售，不会用于个性化广告，也不会被用于与扩展已披露单一目的无关的用途。

## 导出

当用户主动导出 `.rbb.json`、Markdown、JSON Canvas 或 PNG 时，导出文件可能包含：

- Research title / checkpoint / keyword；
- Highlight quote / Note；
- conversation/message source metadata。

导出后，文件的保存与分享由用户自行控制。

## 安全限制

ChatGPT 的 DOM 和内部 API 行为可能随时变化。DOM parsing、source navigation 和 compatibility refresh 均属于 best-effort 功能。

不要把浏览器扩展本地数据作为重要研究的唯一副本。重要内容建议定期导出 `.rbb.json`。

本项目与 OpenAI 无隶属、背书或赞助关系。

仓库来源与许可证状态请参阅 [NOTICE.md](./NOTICE.md) 和 [LICENSE_STATUS.md](./LICENSE_STATUS.md)。
