# 隐私说明

[English](./PRIVACY.md) | **简体中文**

ChatGPT Research Blackboard 是一个运行在 ChatGPT 页面旁边的浏览器扩展。本文件描述 `v0.1.0` 安全清理之后当前代码树的实际数据行为。

本项目**不运营用于收集 Research Blackboard 数据的开发者自建云端后端**。

> 历史说明：已经发布的 `v0.1.0` Pre-release 从上游 fork 继承了一套 ChatGPT token capture / internal API compatibility layer。该路径已经从当前代码树移除，不会进入下一版 release candidate。

## 处理的数据

根据用户实际使用功能，扩展可能处理：

- 当前 ChatGPT 页面中已渲染、扩展可见的对话内容；
- message ID、conversation ID 与消息顺序信息；
- Research Node、Semantic Edge、Checkpoint、关键词、Node 位置和 layout metadata；
- 用户保存的 Highlight、原文引用和 Note；
- 用于 source jump 的 quote/message anchor；
- Research Project membership 与 conversation provenance；
- 用户主动导入或导出的 Research Blackboard 数据。

当前源码**不会**捕获或保存 ChatGPT Bearer access token，不会为了 API 访问读取 ChatGPT authentication cookie，也不会调用 ChatGPT 私有 `/backend-api/` conversation endpoint。

## 本地存储

Research Blackboard 主要把 Research Graph、Highlights、Notes、Project / provenance metadata、layout 与本地 UI 状态保存在浏览器扩展本地存储 `chrome.storage.local`。

为兼容 Refresh 与 source navigation，上游遗留的 conversation cache 还可能把**从当前 DOM 重建出的 conversation snapshot** 缓存在扩展本地 IndexedDB 中。

这些数据不会因为本项目而自动上传到开发者自建服务器。它们会保存在当前浏览器 Profile 中，直到扩展、用户或浏览器环境将其清除。

当前版本启动时还会主动删除旧 `v0.1.0` 可能遗留的 auth storage keys：`accessToken`、`tokenTimestamp`、`tokenSource`、`tokenInfo`。

## Research Mode 会发送什么给 ChatGPT

当 Research Blackboard Sidepanel 打开时，Research Mode 会给用户即将发送的 ChatGPT 消息附加一段紧凑的隐藏 `RBREQ`。

RBREQ 可能包含：

- semantic node ID；
- Node title / keyword / checkpoint 的压缩信息；
- 少量 semantic relationship；
- 当前内部 focus 或 semantic anchor。

因此，**RBREQ 会作为正常 ChatGPT 对话请求的一部分发送给 ChatGPT / OpenAI**。

ChatGPT 返回的 `RGΔ` 会由扩展在页面上隐藏并在本地消费，但该回复仍由 ChatGPT 服务生成，因此受 ChatGPT / OpenAI 自身的数据处理与保留政策约束。

## Highlight 与 Source Anchor

当用户在 ChatGPT Assistant 回答中选中文字并点击 `★ Save` 时，扩展可能保存：

- 被选中的 quote；
- message / conversation anchor；
- 为精确 source jump 所需的局部上下文；
- 用户可选的 Note。

这些数据不会被发送到本项目自建服务器。

用户主动执行 source navigation 时，扩展会在已授权的 ChatGPT host 上使用 Chrome `scripting` API：定位对应的已渲染消息或精确 quote、滚动到原始位置，并进行临时高亮。该 scripting 路径不用于捕获凭据，也不调用 ChatGPT 私有 API。

## DOM-only Conversation Compatibility

当前源码的 conversation snapshot 与手动 Refresh 使用 DOM-only 路径：

- 只读取当前 ChatGPT 页面已经渲染的消息；
- 在本地重建最小 conversation mapping；
- 不向 ChatGPT 私有 API 发起带认证的请求；
- 不驱动 ChatGPT 隐藏 branch 控件去读取当前未渲染的替代分支。

这样显著缩小了凭据与账号风险面，但也意味着 compatibility snapshot 只能包含当前 DOM 中实际可获得的内容。超长对话经过 virtualization / lazy rendering，或存在隐藏 alternative branch 时，compatibility cache 可能并不完整。

## 浏览器权限

当前 manifest 请求：

- `storage` — Research Blackboard 本地状态与 DOM-derived compatibility cache 状态；
- `sidePanel` — Research Blackboard Sidepanel；
- `scripting` — 在已授权 ChatGPT 页面上执行用户主动触发的 source location / exact Highlight jump。

Host access 限制为：

- `https://chatgpt.com/*`
- `https://chat.openai.com/*`

当前源码**不再请求** `webRequest` 或广泛的 `tabs` 权限。保留 `scripting` 是因为当前 source-jump 实现使用 `chrome.scripting.executeScript()` 完成精确 DOM 定位与高亮；它不用于 request-header interception，也不用于动态恢复 content script。

由于读取 ChatGPT 页面是扩展核心功能所必需，content script 可以在上述两个 ChatGPT host 上读取和修改页面；扩展没有获得对其他无关网站的 host access。

## 扩展 Reload / Update 后的行为

扩展不再为了恢复连接而动态注入 `dist/content.js`。若扩展 Reload / Update 时某个已经打开的 ChatGPT 页面仍保留旧的、已失效的 extension context，请刷新该 ChatGPT 页面，让 manifest 声明的 content scripts 重新加载。

## 第三方共享与商业使用

本项目当前没有开发者自建的用户数据后端，也没有设计：

- 出售用户 Research Graph、Chat 内容或 Highlight；
- 把这些数据提供给广告平台、data broker 或信息转售方；
- 使用这些数据做 personalized / retargeted / interest-based advertising；
- 让项目开发者通过后台人工读取用户的 Research Graph 或 Chat 内容。

Research Blackboard 对用户数据的使用应限定在已披露的单一目的：帮助用户在 ChatGPT 长研究对话中维护、浏览和导出语义研究结构。

## Chrome Web Store Limited Use 声明

ChatGPT Research Blackboard 对用户数据的使用将遵守 Chrome Web Store User Data Policy，包括 Limited Use 要求。用户数据不会被出售，不会用于个性化广告，也不会被用于与扩展已披露单一目的无关的用途。

移除 credential interception 以及 `webRequest` / 广泛 `tabs` 权限，已经解决 `v0.1.0` 审计中发现的主要隐私 blocker。保留的 `scripting` 权限受 ChatGPT host permissions 限制，仅用于显式 source navigation / Highlight 高亮。在正式声明 Chrome Web Store ready 之前，仍应单独完成一次 Store submission review。

## 导出

用户主动导出 `.rbb.json`、Markdown、JSON Canvas 或 PNG 时，导出文件可能包含 Research title、checkpoint、keyword、Highlight quote / Note，以及 conversation/message source metadata。导出后文件如何保存或分享由用户自行控制。

## Cross-chat Project

Research Project 可以把来自多个 ChatGPT conversation 的 semantic node 合并进本地 canonical project graph。Provenance 记录可能包含返回来源 Chat 所需的 conversation/message identifiers。

## 安全限制

ChatGPT DOM 可能随时变化。DOM parsing、source navigation 与 DOM-derived refresh 都属于 best-effort 功能。

不要把浏览器扩展本地数据作为重要研究的唯一副本。重要内容建议定期导出 `.rbb.json`。

本项目与 OpenAI 无隶属、背书或赞助关系。

仓库来源与许可证状态请参阅 [NOTICE.md](./NOTICE.md) 和 [LICENSE_STATUS.md](./LICENSE_STATUS.md)。
