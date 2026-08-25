# ChatGPT Research Blackboard

一个运行在 ChatGPT 旁边的**语义研究图谱 Sidecar**。

它不是把聊天记录画成树，而是尝试维护“研究本身”的结构：分析、比较、问题、综合、判断、Highlight，以及这些研究状态之间的关系。

> **状态：** 可用 MVP / dogfooding baseline。当前主要面向桌面 Chromium 浏览器和 `chatgpt.com`。

> **Fork 说明：** 本仓库是 [`Robbings/chatgpt-graph-navigator`](https://github.com/Robbings/chatgpt-graph-navigator) 的 fork 和衍生项目。Research Blackboard 复用了上游的 Chrome 扩展基础设施、ChatGPT DOM 观察、conversation cache、消息锚定和跳转能力，同时把主要产品模型和 Sidepanel 重构为语义研究图。详见 [NOTICE.md](./NOTICE.md)。

> **非官方项目：** 本扩展与 OpenAI 无隶属、背书或赞助关系。

## 它解决什么问题

长对话不是好的研究仓库。真正的研究往往会：

- 纵向深挖；
- 横向比较；
- 回到几轮甚至几十轮前的旧主题；
- 从多个分支收敛成新的综合判断；
- 反复引用某些关键原句。

Research Blackboard 的目标是：

> **ChatGPT 负责局部推理，Blackboard 负责长期空间记忆。**

当 Sidepanel 打开时，扩展会在后台维护一张紧凑的语义图，而用户仍然可以正常用自然语言和 ChatGPT 对话。

## 主要能力

- **AI 自动维护语义图**：通过紧凑的隐藏 RGΔ 协议更新研究结构。
- **语义节点类型**：Analysis、Comparison、Question、Synthesis、Judgment。
- **语义关系**：`deepens`、`compares`、`supports`、`contradicts`、`informs`。
- **研究优先的自动布局**：ELK Layered + `deepens` Backbone + 防重叠 + soft drag preference + 曲线主干。
- **Anchor-aware Context**：用户明确回到旧主题时，优先匹配旧 Node，而不是被最近讨论的 Node 劫持。
- **Highlight**：选中 ChatGPT 回答中的文字，保存到最相关的研究 Node。
- **Highlight 管理**：批注、排序、移动、删除、Promote 成 Node、Demote 回 Highlight、精确跳回原句。
- **Source Jump**：从 Node / Highlight 回到对应 ChatGPT 消息或原句。
- **Compact Detail Drawer**：Checkpoint、关键词、Highlights、Relations、Source 都放在紧凑 overlay 中，不让 Node 自己无限长高。
- **Research Project**：实验性的跨 Chat canonical graph + conversation provenance。
- **导出**：`.rbb.json`、Markdown、JSON Canvas、Full Graph PNG。
- **导入**：从 `.rbb.json` 恢复 Blackboard。

## 核心心智模型

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

**ChatGPT message 是来源容器；Research Node 是语义研究状态。** 两者故意不是 1:1。

一条回答可以只更新已有 Node，也可以在真正发生结构变化时创建新的 Comparison / Question / Synthesis。

### Node 类型

- **Analysis**：一条解释或推理分支。
- **Comparison**：明确的横向比较。
- **Question**：真正尚未解决的问题。
- **Synthesis**：至少多个已有分支真实收敛后，产生的可复用高层认识。
- **Judgment**：明确的决策、推荐、排序或取舍。开放式历史/艺术/科学研究中应很少出现。

### Backbone

只有 `deepens` 决定纵向层级。

Canonical 语义方向：

```text
更具体 child --deepens--> 更宽泛 parent
```

视觉布局反过来读：

```text
更宽泛 parent
       ↓
更具体 child
```

`compares / supports / contradicts / informs` 都是横向关系，不决定 rank。

## 从源码安装

### 要求

- Node.js 18+
- npm
- 支持 Manifest V3 Side Panel 的 Chrome / Chromium 浏览器

### 构建

```bash
git clone https://github.com/Gonglz/chatgpt-research-blackboard.git
cd chatgpt-research-blackboard
npm install
npm run test
npm run build
```

然后：

1. 打开 `chrome://extensions/`
2. 开启 **Developer mode**
3. 点击 **Load unpacked**
4. 选择**仓库根目录**，也就是包含 `manifest.json` 的目录

不要选择 `dist/`。

安装后点击扩展图标会直接打开 Research Blackboard Sidepanel。

开发模式：

```bash
npm run dev
```

Release-style build：

```bash
npm run build:release
```

## 日常使用

1. 打开一个 ChatGPT 对话。
2. 打开 Sidepanel；看到 `● Live` 表示 Research Mode 正在工作。
3. 正常提问，不需要手工输入建图命令。
4. 用 Blackboard 做外部空间记忆：
   - 看 Backbone；
   - 点 Node 看 Detail；
   - 保存重要原句为 Highlight；
   - 从 Node/Highlight 回源；
   - 必要时轻量纠错。
5. 需要带走研究结果时导出。

产品原则是：

> **AI 默认维护结构，用户主要负责纠错和少量整理，而不是手工维护整张图。**

## Highlight

在 Sidepanel 打开时，选中 ChatGPT Assistant 回答里的文字，会出现：

- `★ Save`：保存到语义上最匹配的已有 Node；
- `+ Node`：直接从选区创建 Analysis / Comparison / Question。

保存后的 Highlight 支持：

- Note；
- ↑ / ↓ 排序；
- Move；
- Delete；
- Promote to Node；
- Demote back to Highlight；
- 在 DOM anchor 可安全恢复时精确跳回原句并短暂高亮。

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

Node 属于 Project，来源属于具体 Chat。这样既能跨 Chat 共用一张研究图，又不会把几张独立图粗暴 merge。

该功能已经实现，但仍属于需要更多真实使用验证的部分。

## 导出与数据所有权

当前支持：

- **`.rbb.json`**：无损 Research Blackboard package，可重新 Import；
- **`.md`**：线性 Markdown 笔记；
- **`.canvas`**：JSON Canvas，可用于兼容的无限画布工具，例如 Obsidian；
- **`.png`**：完整图图片。

## 自动建图是怎么工作的

Sidepanel 打开时，content script 会给当前用户消息附加一个紧凑的隐藏 Research Blackboard 请求（`RBREQ`）。如果这一轮确实发生了结构变化，ChatGPT 可以在回答末尾附加一个机器可读的 `RGΔ` block；扩展会把它从页面视觉上隐藏，并在本地消费这个 delta。

当前 Context 策略不是“永远拿最近几个 Node”，而是：

1. 用户新问题里的明确旧主题 semantic anchor；
2. 和 anchor 高相关的局部 Node / Edge；
3. 内部 context focus；
4. recency 只作为很弱的 tie-break。

这是为了支持真正非线性的研究过程，例如聊了十轮以后突然回到“宇树与智元”这种旧分支。

## 隐私与权限

使用前请阅读 [PRIVACY.md](./PRIVACY.md)。

关键点：

- Research Graph、Highlights 等主要保存在 `chrome.storage.local`；
- 本项目没有自建云端后端；
- Research Mode 开启时，隐藏 RBREQ 会附加到发送给 ChatGPT 的请求里，因此这部分协议文本会随当前对话请求发送给 ChatGPT；
- fork 中仍保留上游 conversation-cache/auth compatibility 层，用于显式 Refresh / fallback；详细行为见 Privacy 文档。

## Tests

```bash
npm test
npm run build
```

回归测试重点覆盖：

- RGΔ parser / reducer；
- `deepens` canonical 方向；
- Backbone parent 选择；
- vertical rank；
- 同层 Node 防重叠。

GitHub Actions 会在 push / pull request 时自动跑 tests + build。

> 当前仓库中的 `package-lock.json` 来自上游，尚未完整同步新增依赖，因此 CI 暂时使用 `npm install`，而不是 `npm ci`。下一次本地重新生成并提交 lock 后，可以再切回 `npm ci`。

## 架构

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

核心 Research Blackboard workflow 不需要额外 OpenAI API key，也不依赖外部 RAG 或项目自建云服务。

## Fork、上游与署名

本仓库保持 GitHub fork 关系：

[`Robbings/chatgpt-graph-navigator`](https://github.com/Robbings/chatgpt-graph-navigator)

不要在重新分发时删除 fork/upstream attribution。

本 fork 主要新增/重构包括：

- semantic Research Node / Edge 模型；
- 自动 RGΔ 建图与 compact context protocol；
- anchor-aware 旧主题回跳；
- Highlight 与 quote-level provenance；
- Project canonical graph；
- ELK Semantic Backbone 布局与 routing；
- Research Blackboard Detail / Hover UX；
- export / import。

详见 [NOTICE.md](./NOTICE.md)。

## License 状态

**不要继续沿用本 fork 之前同时出现的 MIT / GPL 标签。**

上游仓库目前存在许可证元数据不一致：

- README 写 GPL-3.0；
- `package.json` 写 MIT；
- 当前检查到的上游根目录没有 `LICENSE` 文件。

由于这是衍生项目，本 fork 不擅自替上游代码重新选择许可证。重新分发或发布二进制/商店版本前请阅读 [LICENSE_STATUS.md](./LICENSE_STATUS.md)。

## Contributing

欢迎 PR。

对语义建图、Backbone、layout、Highlight provenance 等核心行为的修改，尽量同时补回归测试。

最重要的产品约束仍然是：**降低认知负荷，而不是把图谱维护本身变成新的负担。**
