# ChatGPT Research Blackboard

**简体中文** | [English](./README_EN.md)

一个运行在 ChatGPT 旁边的**语义研究图谱 Sidecar**。

它不是把聊天记录重新画成一棵树，而是维护“研究本身”的结构：分析、比较、问题、综合、判断、Highlight，以及这些研究状态之间的关系。

> **状态：** 可用 MVP / Public Pre-release。当前主要面向桌面 Chromium 浏览器和 `chatgpt.com`。

> **Fork 说明：** 本仓库是 [`Robbings/chatgpt-graph-navigator`](https://github.com/Robbings/chatgpt-graph-navigator) 的 fork 和衍生项目。Research Blackboard 复用了部分上游 Chrome 扩展基础设施、ChatGPT DOM 观察、conversation cache、消息锚定和跳转能力，同时把主要产品模型和 Sidepanel 重构为语义研究图。详见 [NOTICE.md](./NOTICE.md)。

> **非官方项目：** 本扩展与 OpenAI 无隶属、背书或赞助关系。

## 它解决什么问题

长研究对话通常不是线性的：会向下深挖、横向比较、回到旧主题，再把多个分支收敛成新的判断。普通 Chat 时间线很容易让研究结构埋在大量消息里。

Research Blackboard 把 ChatGPT 当作局部推理引擎，把语义图当作外部空间记忆：

```text
ChatGPT conversation
        ↓
局部推理 / 原始材料
        ↓
Research Blackboard
├─ Analysis
├─ Comparison
├─ Question
├─ Synthesis
└─ Judgment
```

**ChatGPT Message 是来源容器；Research Node 是语义研究状态。** 两者故意不是 1:1。

## 主要能力

- **AI 自动维护语义图**：通过隐藏的 `RBREQ / RGΔ` 协议维护研究结构。
- **Node 类型**：Analysis、Comparison、Question、Synthesis、Judgment。
- **语义关系**：`deepens`、`compares`、`supports`、`contradicts`、`informs`。
- **Research-first 布局**：ELK Layered + `deepens` Backbone + 防重叠 + soft drag preference + 曲线 routing。
- **Anchor-aware Context**：明确回到旧主题时，语义匹配优先于时序上的“最近讨论”。
- **Highlight**：选中 ChatGPT 回答中的文字，保存到最相关 Node；支持 Note、排序、移动、删除、Promote/Demote 和精确回源。
- **Source Jump**：双击 Node 可回到原始消息并短暂描边；Highlight 可回到原句并临时高亮。
- **Compact Detail Surface**：Checkpoint、关键词、Highlights、Relations、Source 放在 overlay 中，不让 Node 无限长高。
- **Research Project**：实验性的跨 Chat canonical graph + conversation provenance。
- **导出**：`.rbb.json`、Markdown、JSON Canvas、完整 PNG。
- **导入**：从 `.rbb.json` 恢复 Blackboard。

## Backbone 语义

只有 `deepens` 决定纵向层级。

Canonical 语义方向：

```text
更具体 child --deepens--> 更宽泛 parent
```

视觉读取方向：

```text
更宽泛 parent
       ↓
更具体 child
```

其他关系是横向 cross-link，不决定 rank。

## 安装

### 推荐：从 GitHub Release 安装

1. 打开 [Releases](https://github.com/Gonglz/chatgpt-research-blackboard/releases)。
2. 下载最新版本中的 `chatgpt-research-blackboard-v0.1.1.zip`。
3. 解压 ZIP。
4. 打开 `chrome://extensions/`。
5. 开启右上角 **Developer mode / 开发者模式**。
6. 点击 **Load unpacked / 加载已解压的扩展程序**。
7. 选择刚刚解压、且根目录内包含 `manifest.json` 的文件夹。

> `v0.1.1` 是当前推荐的 GitHub **Pre-release**。不要继续使用旧的 `v0.1.0` 包；v0.1.1 已移除上游遗留的 ChatGPT token capture / private API compatibility path。

### 从源码安装

要求：Node.js 18+、npm，以及支持 Manifest V3 Side Panel 的 Chrome / Chromium 浏览器。

```bash
git clone https://github.com/Gonglz/chatgpt-research-blackboard.git
cd chatgpt-research-blackboard
npm ci
npm test
npm run build
```

然后在 `chrome://extensions/` 中加载**仓库根目录**，不要加载 `dist/`。

## 日常使用

1. 打开一个 ChatGPT 对话。
2. 打开扩展 Sidepanel；`● Live` 表示 Research Mode 正在工作。
3. 正常提问，不需要手工输入任何建图命令。
4. 用 Blackboard 做外部空间记忆：看 Backbone、点 Node 看 Detail、保存 Highlight、跳回来源。
5. 重要研究用 `.rbb.json` 等格式导出备份。

产品原则：**AI 默认维护结构，用户主要负责纠错和轻量整理。**

## Highlight 与 Source Jump

Sidepanel 打开时，选中 ChatGPT Assistant 回答里的文字：

- `★ Save`：保存到语义上最匹配的已有 Node；
- `+ Node`：直接从选区创建新的研究 Node。

Highlight 支持 Note、排序、Move、Delete、Promote to Node、Demote back to Highlight。

来源定位：

- 双击 Research Node：回到对应的当前 ChatGPT 原始消息，并短暂显示定位描边；
- Highlight 的 `↗ Source`：尽量定位到精确 quote，并临时黄色高亮约 5 秒。

当前 Source Jump 只保证**当前已渲染 DOM** 内的定位。跨 Chat Source Jump 仍属于实验性能力，当前版本不作为稳定承诺。

## 跨 Chat Project

Research Project 使用 Hybrid 结构：

```text
Project
└─ canonical semantic graph
   ├─ Node A
   │  └─ sources: Chat 1, Chat 3
   └─ Edge X
      └─ sources: Chat 2
```

Node 属于 Project；provenance 属于具体 Chat。Project 数据模型已经实现，但跨 Chat Source Jump 仍需要更多真实使用验证。

## 自动建图怎么工作

Sidepanel 打开时，content script 会给当前用户消息附加一个紧凑的隐藏 Research Blackboard 请求（`RBREQ`）。如果这一轮发生有意义的结构变化，ChatGPT 可以在回答末尾附加机器可读 `RGΔ`；扩展会把它从页面视觉上隐藏，并在本地消费 delta。

当前 Context 策略优先级：

1. 新问题中的明确旧主题 semantic anchor；
2. 与 anchor 高相关的局部 Node / Edge；
3. 内部 context focus；
4. recency 只作为很弱的 tie-break。

## 隐私与安全

请阅读 [PRIVACY.md](./PRIVACY.md) 和 [中文隐私说明](./PRIVACY_ZH.md)。

当前 `v0.1.1` 的关键事实：

- Research Graph、Highlights、Project metadata 等主要保存在 `chrome.storage.local`；
- DOM-derived conversation snapshot 可能缓存在浏览器本地 IndexedDB；
- 本项目**没有自建 Research Blackboard 云端后端**；
- Research Mode 开启时，隐藏 RBREQ 会作为正常 ChatGPT 对话请求的一部分发送给 ChatGPT / OpenAI；
- **不会捕获或保存 ChatGPT Bearer access token**；
- **不会为了 API 访问读取 ChatGPT authentication cookie**；
- **不会调用 ChatGPT 私有 `/backend-api/` conversation endpoint**；
- 当前 manifest 不再请求 `webRequest` 或 broad `tabs`；
- 保留 `scripting`，仅用于用户主动触发的 Source Jump / exact Highlight DOM 定位与临时高亮。

`v0.1.1` 启动时还会主动清理旧 `v0.1.0` 可能遗留在 `chrome.storage.local` 中的 token keys。

### DOM-only 的取舍

Refresh 和 conversation compatibility snapshot 现在只从当前 ChatGPT DOM 重建。因此：

- 当前可见、已渲染的对话可以正常处理；
- 不再通过私有 API 读取 hidden alternative branch；
- 超长 Chat 如果被 ChatGPT virtualization / lazy rendering，未渲染的历史消息可能不进入本次 snapshot。

这是为了缩小账号与凭据风险面而接受的 trade-off。

### Chrome Web Store 状态

v0.1.1 已解决 v0.1.0 审计中最主要的隐私 blocker：token interception、`webRequest` 和 private conversation API 路径都已删除。

仍不直接宣称 Chrome Web Store ready；正式提交前还需要单独完成 Store listing / Privacy practices / permission justification 审核。

## 导出与数据所有权

- **`.rbb.json`**：无损 Research Blackboard package，可重新 Import；
- **`.md`**：线性 Markdown 笔记；
- **`.canvas`**：JSON Canvas，可用于 Obsidian 等兼容工具；
- **`.png`**：完整图图片。

导出文件可能包含研究标题、Checkpoint、原文引用、Note、conversation/message metadata。请把它们视作可能包含敏感研究内容的本地文件。

## Tests / CI

```bash
npm ci
npm test
npm run build
```

回归测试覆盖：

- RGΔ parser / reducer；
- Synthesis / Judgment parsing；
- `deepens` canonical 方向；
- Backbone parent / depth；
- cycle handling；
- vertical rank；
- 同层 Node 防重叠；
- privacy boundary：禁止 `webRequest` / token capture / `/backend-api/`；
- Source Jump / exact Highlight 的 `scripting` 依赖，防止以后再次被误删。

GitHub Actions 使用已经提交的 `package-lock.json`，执行 `npm ci → npm test → npm run build`。

当前 release candidate 的 `npm audit --omit=dev` 为 **0 production vulnerabilities**；剩余 audit 项是 esbuild 开发工具链 advisory，因此没有强制做 breaking upgrade。

## 架构

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

核心 Research Blackboard workflow 不需要额外 OpenAI API key、外部 RAG 服务或项目自建云服务。

## Fork、上游与署名

本仓库保持 GitHub fork 关系：[`Robbings/chatgpt-graph-navigator`](https://github.com/Robbings/chatgpt-graph-navigator)。

重新分发时不要删除 fork / upstream attribution。

本 fork 主要新增/重构包括：语义 Research Model、自动 RGΔ、semantic-anchor retrieval、Highlight 与 provenance、Project canonical graph、ELK Semantic Backbone、Research Blackboard UX，以及 export/import。

详见 [NOTICE.md](./NOTICE.md)。

## License 状态

上游仓库目前存在许可证元数据不一致：README 写 GPL-3.0，`package.json` 写 MIT，而当前检查到的上游根目录没有 `LICENSE` 文件。

由于这是衍生项目，本 fork 不擅自替上游代码重新选择许可证。重新分发或发布二进制 / 商店版本前请阅读 [LICENSE_STATUS.md](./LICENSE_STATUS.md)。

## Contributing

欢迎 PR。修改语义建图、Backbone、layout、Highlight provenance、Source Jump 等核心行为时，尽量同时补回归测试。

最重要的产品约束是：**降低认知负荷，而不是把图谱维护本身变成新的负担。**
