# DeepSeek Harness（dsh）从浅入深学习指导手册

> 本手册基于对 `deepseek-harness` 仓库源码与官方文档（`docs/`）的系统性分析编写，目标是给出一套**可执行的、分层递进**的学习路径。每个阶段都标注了：**学习目标 → 阅读材料 → 动手任务 → 验收标准**。
>
> 阅读对象：希望理解、使用、二次开发乃至为 dsh 贡献代码的开发者。不需要深厚的 TypeScript 功底，但需要熟悉命令行与基础 JS/Node 概念。

---

## 0. 三分钟认识它

**DeepSeek Harness（`dsh`）** 是由 DeepSeek AI 开源的 **agent harness（智能体运行框架）**。你可以把它理解为：

- 一个让你能"组装"出编码智能体（类似 Claude Code / Codex 这类产品）的**框架底座**；
- 核心信条是 **"一切皆插件"（everything is a plugin）**——模型适配器、工具注册表、会话日志、甚至连**智能体主循环（agent loop）本身**都是可替换的插件；
- 底层由内嵌的（vendored）**Cordis** 框架驱动（设计思想见论文《A Programming Paradigm for Spatiotemporal Composability》）。

**它和"一个聊天应用"的本质区别**：聊天应用的循环逻辑是写死的；dsh 的循环是一个插件，你可以在不改动核心的前提下，通过"挂载一个插件"来拦截请求、改写工具策略、注入上下文、替换执行后端。这种"微内核 + 事件扩展点"的设计是贯穿全项目的主线。

**当前状态**：developer preview，快速迭代中，**会有破坏性变更**。

---

## 1. 学习路径总览

建议按以下 7 个阶段推进，每阶段是后一阶段的前置：

| 阶段 | 主题 | 关键产出 | 难度 |
|---|---|---|---|
| ① | 体验与运行 | 跑起 Web UI，理解"agent harness"概念 | ★ |
| ② | Cordis 框架基础 | 完成 7 章 Cordis 教程，掌握插件/服务/事件 | ★★ |
| ③ | 核心架构心智模型 | 看懂 turn/step、会话日志、能力接缝 | ★★★ |
| ④ | 第一个 Harness 插件 | 在 Web UI 里挂载自定义插件/工具 | ★★ |
| ⑤ | 能力接缝（Capability Seam） | 理解"三角色"模式并实现一个可替换能力 | ★★★ |
| ⑥ | 源码深入 | 通读 core 包、agent-loop、会话事件 | ★★★★ |
| ⑦ | 进阶贡献 | 掌握测试/约定/CI，能提 PR | ★★★★ |

> 💡 **元建议**：dsh 官方文档本身就有清晰的学习分层。本手册的价值在于**给出顺序、补足背景、标注关联**，避免你在 ~200 篇文档中迷路。

---

## ⭐ 配套：源码逐行带读系列

本手册讲"怎么学"；如果你想**直接钻进源码、有人逐行带你读**，请配合 **`带读系列/`** 目录（共 7 个文件）。它把 6 个高价值源文件**串成一条线**，每个代码块都带**真实行号、可点击定位源码**，穿插 🎯 设计精华卡片 与 🤔 思考题，并以**全景流程图 + 毕业练习**收束。

**推荐时机**：完成本手册阶段 ②③（Cordis 基础 + 架构心智模型）后，用带读系列完成阶段 ⑥"源码深入"。

| 顺序 | 带读篇 | 源文件 | 一句话 |
|---|---|---|---|
| — | [00 导览（一条线+全景图+毕业练习）](带读系列/00-导览-一条线与全景图.md) | — | **从这里进**，索引与收束 |
| ① | [一个完整的工具](带读系列/01-tool-todo-一个完整的工具.md) | `packages/todo/tool-todo/src/index.ts` | 最小完整工具，起点 |
| ② | [工具注册表与执行管线](带读系列/02-tools-工具注册表与执行管线.md) | `packages/core/tools/src/index.ts` | 五段策略管线 |
| ③ | [会话日志](带读系列/03-session-会话日志.md) | `packages/core/session/src/index.ts` | 唯一真相源 |
| ④ | [主循环](带读系列/04-agent-loop-主循环.md) 👑 | `packages/core/agent-loop/src/agent.ts` | 皇冠 |
| ⑤ | [工具调度器](带读系列/05-tool-calls-工具调度器.md) | `packages/core/agent-loop/src/tool-calls.ts` | 并发/顺序/中断 |
| ⑥ | [组装骨架](带读系列/06-spine-demo-组装骨架.md) | `packages/examples/agent-spine-demo/src/index.ts` + `cordis.yml` | 装回整机 |

> 一条线：**工具定义(①) → 工具管线(②) → 会话日志(③) → 主循环(④) → 调度器(⑤) → 装配(⑥)**——每篇都解决上一篇留下的悬念，最终在 00 的全景图里收束成"一次请求如何流过 dsh"。

---

## 阶段 ① 体验与运行

### 学习目标
- 知道 dsh 跑起来是什么样、能做什么；
- 建立"agent harness = 可组装的智能体运行时"的直觉。

### 阅读材料
- `README.md` / `README.zh.md`（项目简介）
- `docs/user/guide/index.md`（Web UI 指南）

### 动手任务
**方式 A：npm 一键运行（最快）**
```sh
npx @deepseek-ai/dsh web
# 浏览器打开 http://127.0.0.1:3080
```

**方式 B：从源码运行（后续开发都需要）**
```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install      # 需要 Node 22.19+ 或 24+，pnpm@11.7.0（用 corepack enable）
pnpm run build
pnpm dsh web
```

### 试试看
- 在 Web UI 里发起一个编码任务，观察"工具调用卡片"（bash / 文件编辑 / 搜索）如何被触发和渲染——这正是后面你要学习的 **工具注册表 + 渲染意图（render intent）** 的产物。
- 没有官方 API key？headless / Web 演示需要 `DEEPSEEK_API_KEY`，但本手册的大部分学习**不需要 key**。

### 验收标准
- [ ] 能本地从源码启动 Web UI
- [ ] 能用自己的话解释"agent harness 和普通聊天应用的区别"

---

## 阶段 ② Cordis 框架基础（最重要的地基）

### 为什么先学 Cordis
dsh 的**每一个包**都是 Cordis 插件。不理解 Cordis 的 5 个核心思想，后面所有文档都读不懂。Cordis 的官方学习材料是**自包含、无需 API key** 的，是性价比最高的起点。

### 学习目标
掌握 Cordis 的 **5 个核心思想**：
1. 插件是实现 `Service` 的对象（函数 / 对象 / 类三种形态）；
2. **context（ctx）是服务仓库**，插件通过稳定的 `ctx.<key>`（如 `ctx.tools`）拿能力，而不是 `import` 具体实现；
3. 用 `inject` 声明服务依赖，**加载顺序由依赖决定**，而非文件顺序；
4. **类型化事件（typed events）** 通信，有 `emit`/`waterfall`/`parallel`/`serial` 四种派发模式；
5. **注册是可逆副作用**（registration is a reversible effect），卸载插件时自动回滚。

### 阅读材料（按顺序）
1. `docs/cordis-primer.md`——浓缩的概念参考（先读这个建立全貌）
2. `docs/cordis-tutorial/index.md` 及 7 章教程（动手跟做）：
   - `01-first-plugin.md`——插件是个函数
   - `02-lifecycle-and-effects.md`——生命周期与副作用回滚
   - `03-services.md`——在 ctx 上暴露能力 + inject 依赖
   - `04-events.md`——类型化事件、waterfall 短路
   - `05-config.md`——cordis.yml 配置、错误大声报（fail loud）
   - `06-composition-and-hmr.md`——配置即插件树、热重载、诊断"插件不加载"
   - `07-into-the-harness.md`——**把插件接到真实 dsh 的 tools 服务上**
3. `docs/cordis-api/`（context / events / fiber / service / registry）——API 级参考，查阅用

### 动手任务
按教程在 `tmp/cordis-tutorial/` 下创建文件，统一用这条命令跑：
```sh
mkdir -p tmp/cordis-tutorial && cd tmp/cordis-tutorial
node --import tsx ../../vendor/cordis/bin.js
```
**重点完成第 7 章**：它会让你写一个 `greet` 工具注册到真实的 `ctx.tools`，再写一个独立插件通过 `tools/result` 事件观察所有工具调用。跑通后你会顿悟"两个互不相识的插件如何通过服务+事件协作"。

### 关键心智模型（务必内化）

| 概念 | 一句话理解 |
|---|---|
| `apply(ctx)` | 插件入口，所有注册都在这里发生 |
| `inject = ['tools']` | 声明"我需要 tools 服务存在才加载" |
| `ctx.effect(() => disposer)` | 注册一个可逆副作用，返回清理函数 |
| `declare module` | TS 声明合并，让 `ctx.myService` 有类型——**不产生运行时代码** |
| `ctx.on('event', fn)` | 监听事件，随插件卸载自动取消 |
| `waterfall` + `next()` | 串行中间件，**必须调 `next()` 才能传递**，否则短路 |

### 验收标准
- [ ] 跑通 7 章教程全部示例
- [ ] 能解释：为什么交换 `cordis.yml` 里两行顺序，输出不变？（答：依赖驱动加载）
- [ ] 能解释：`waterfall` 监听器为什么**必须**调 `next()`

---

## 阶段 ③ 核心架构心智模型

### 学习目标
在写真实插件前，先建立系统全景图。这一阶段**只读不写**，但极其关键——它决定了你以后"往哪挂"新行为。

### 阅读材料（核心中的核心）
1. `docs/architecture.md`——**改 packages/ 前必读**，本阶段主线
2. `docs/glossary.md`——领域术语表（capability-seam / scope / turn / step / round / Ralph 等）
3. `docs/capability-seams.md`——能力接缝全景图（一张 mermaid + 大表，标注每个 `ctx.*` 的 owner/provider/consumer）
4. `docs/event-producer-consumer.md`——每个事件的生产者/消费者映射
5. `docs/subsystems/`——各子系统专题（core / session / llm-streaming / tools / approval / compaction / subagent …）

### 必须建立的 4 张心智图

**图 1：Turn（回合）流程**（来自 architecture.md，背下来）
```
turn/start
  认领下一步输入 + 一条排队消息
  组装 prompt 段落 + 工具 schema
  -> agent/pre-step            reject | enter(messages)
  step/start
  追加 user/message；从日志推导模型历史
  agent/request -> llm/stream -> assistant/chunk* -> assistant/message
  tool/call* -> tools/pre-execute -> tools/execute -> tools/post-execute -> tool/result*
  step/end
  -> agent/turn-stopping
turn/end
```
- **turn** = 一次输入的排空（含 0 个或多个 step）；
- **step** = 一次模型请求 + 它触发的工具调用；
- **round** = 更外层的策略迭代（如 goal round、Ralph round）。

**图 2：会话日志是唯一真相源**
- `deriveMessages()` 从日志投影出模型历史；
- **核心不变量：凡模型可见的，必可从日志重建**（Model-visible ⟺ logged）；
- fork / resume / 转录 / 遥测 / 持久化全部派生自这条事件流。
- 推论：**新增一个"模型可见的输入"，必须新增一个 session 事件**。

**图 3：能力接缝三角色**（下一阶段重点实践）
```
Service Definition（声明接口，拥有 ctx.<key>）
        ▲                ▲
   继承/实现           inject
        │                │
Service Provider     Consumer（常是模型可见的工具）
（具体实现）          （注入服务、暴露给模型）
```
Provider 和 Consumer **互不依赖**，都只依赖 Definition。换 Provider = 换整个执行世界。

**图 4："新行为该挂在哪里"**（architecture.md 末尾的表格是金矿）
| 目标 | 机制 |
|---|---|
| 加模型供应商 | 在 `ctx.llm` 注册 adapter |
| 加模型可见能力 | 注册到 `ctx.tools` |
| 拦截请求/工具/回合 | 用对应 `agent/*` 或 `tools/*` 事件 |
| 加模型可见上下文 | 调 `agent.inject()` |
| 加持久化会话状态 | 扩展 `SessionEventMap` |

### 验收标准
- [ ] 能画出 turn→step→工具管线 的时序
- [ ] 能解释"为什么换一个 shell provider，bash 工具/PTY/LSP 都跟着走"
- [ ] 能说出新增模型可见输入时，必须同时做什么

---

## 阶段 ④ 第一个 Harness 插件

### 学习目标
从"裸 Cordis 教程"过渡到"在真实 dsh（Web UI 驱动、从 cordis.yml 加载）里挂载插件"。

### 阅读材料
- `docs/user/develop/basic/index.md`——你的第一个 Harness 插件
- `docs/user/develop/basic/tool.md`——构建一个工具
- `docs/user/develop/basic/config.md`——接受用户配置
- `docs/cookbook/adding-a-tool.md`——**工具定义契约权威参考**

### 动手任务
1. 在仓库根建一个 `scratch-plugin/src/my-plugin.ts`：
   ```ts
   import type { Context } from '@deepseek-ai/cordis'
   export const name = 'hello-plugin'
   export function apply(ctx: Context) {
     console.log('[hello-plugin] loaded')
   }
   ```
2. 建 `scratch-plugin/cordis.yml`（注意路径要**绝对路径**）作为 Web 叠加层插入插件：
   ```yaml
   - insert:
       - id: hello
         name: '/绝对路径/deepseek-harness/scratch-plugin/src/my-plugin.ts'
   ```
3. 启动并叠加：
   ```sh
   pnpm dsh web --patch ./scratch-plugin/cordis.yml
   ```

**进阶：写一个模型可见工具**（核心模板）
```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'my-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'read_file',
    description: '读取磁盘文件。',
    parameters: {
      path: { type: 'string', required: true, description: '绝对路径' },
      limit: { type: 'number' },            // 默认可选
    },
    output: {
      schema: { type: 'string' },           // execute 返回值的规范 schema
      render: (_args, value) => [{ type: 'text', text: value }],  // 模型可见内容
    },
    async execute(args, exec) {
      // args 类型由 schema 自动推断；exec.signal 是取消信号
      // ...读取文件并返回字符串
      return content
    },
  }))
}
```

### 工具契约的几条铁律（来自 adding-a-tool.md，反复对照）
- **参数自动校验**：`defineTool` 会在 `execute` 前按 schema 校验模型入参，DSL 表达不了的约束（非空、正数、跨字段）才手动查；
- **execute 返回一个规范 JSON 值**，不要返回 content 块、不要让调用方解析自然语言拿 id；
- **抛异常或返回非法值 = `isError`**；基础设施失败用 throw，领域结果（哪怕非理想）放规范值；
- **遵守 `exec.signal`** 取消；
- **`output.render`（模型可见）与 UI 卡片是两回事**，卡片由 `presentCall`/`presentResult`（**纯函数**，replay 也会跑）声明；
- 长任务用 `ctx.jobs.start({...})` 而非阻塞 execute。

### 验收标准
- [ ] Web UI 启动时看到 `[hello-plugin] loaded`
- [ ] 自己写的工具能被模型调用并返回结果
- [ ] 能说出 `output.render` 和 UI 卡片渲染的区别

---

## 阶段 ⑤ 能力接缝（Capability Seam）三角色

### 学习目标
当一个能力"通用到需要可替换 provider"时（如 Bash 执行、文件系统、子进程、LLM），dsh 把它拆成三个角色。理解并实现一个完整的接缝，是"真正懂 dsh"的分水岭。

### 阅读材料
- `docs/user/develop/practice/index.md`——三角色概念 + 动手教程
- `docs/user/develop/practice/llm-adapter.md`——实现一个 LLM provider
- `docs/cookbook/adding-a-package.md`——新增包的清单
- `docs/capability-seams.md`——内置接缝家族对照表

### 三角色实例：Bash 执行能力
| 角色 | 包 | 职责 |
|---|---|---|
| Service Definition | `dsh-shell` | 声明 Cordis 服务 + Bash request/result 类型 |
| Service Provider | `dsh-bash-local` / `dsh-bash-sandbox` / `dsh-pwsh-local` | 具体执行（本地/沙箱/PowerShell） |
| Consumer | `dsh-tool-bash` | 把能力暴露成模型可见的 `bash` 工具 |

换 provider 只需改 `cordis.yml` 一行，Definition 和工具不动。

### 动手任务（practice/index.md 的教程）
1. **写 Service Definition**（抽象类 + `declare module` 注册 `ctx.myCap`）
2. **写 Service Provider**（继承并实现 `execute`）
3. **写 Consumer**（`inject: ['tools','myCap']`，用 `defineTool` 暴露给模型）
4. 在 `cordis.yml` 组合它们

### 设计要点
- **不要过早拆分**：简单工具一个包就够，只有当角色需要独立演进/替换时才分包；
- **Definition 拥有 Request/Result 类型**，Provider 和 Consumer 只依赖 Definition；
- **显式 > 隐式**：在 `resolve(request): Spec` 这一步显式解析默认值，别把 `?? default` 藏进 `run()`。

### 推荐对照阅读的"接缝"实例
按"从简单到复杂"读这些包的源码，体会三角色落地：
- `packages/shell/`（shell / bash-local / tool-bash）——经典三包范例
- `packages/fs/`（fs / fs-local / fs-sandbox / fs-e2b / tool-fs）——多 provider
- `packages/web/`（web / web-search-* / web-fetch-http / tool-web）——搜索+抓取多 provider
- `packages/subagent/`（subagent / 6 种 provider / tool-subagent）——最复杂的接缝

### 验收标准
- [ ] 实现一个三角色接缝并能在 cordis.yml 切换 provider
- [ ] 能解释 Provider 和 Consumer 为什么不互相依赖

---

## 阶段 ⑥ 源码深入

### 学习目标
从"会用、会扩展"升级到"能读懂、能改核心"。这一阶段直接进 `packages/`。

### 导航：包目录速览（约 50 个分组）
```
packages/
  core/        产品 API 主干：session / system-prompt / tools / agent / agent-loop / scope
  llm/         LLM 能力 + DeepSeek provider + token-meter + retry
  shell/       bash 能力（local/sandbox/pwsh + 工具）
  subprocess/  子进程能力 + local provider
  fs/          文件系统能力 + 多 provider + 观察策略
  sandbox/     进程沙箱（landlock/sandbox-exec/Windows ACL）
  session/     持久化(JSONL/SQLite)、投影、标题、遥测
  compaction/  上下文压缩
  subagent/    子智能体（spawn/fork/acp/codex/claude-code/dsh-sdk）
  workflow/    动态工作流 + worker-thread + Ralph
  web/         web 搜索/抓取
  interaction/ approval / commands / ask-user / 权限预设
  bundle/      base / web-app / headless  ← 组装层
  boot/        app-boot / cmdline  ← 启动胶水
  client/      浏览器侧 UI 包（ui-* 几十个）
  ...（详见 AGENTS.md 的 Repository layout）
```

### 推荐阅读顺序（从核心向外）

> 📖 **想有人逐行带读？** 本手册配套的 **[带读系列](带读系列/00-导览-一条线与全景图.md)** 已把下面"第一圈"的核心文件（session / tools / agent-loop / agent-spine-demo）做成**逐行注释、带真实行号、配设计卡片与思考题**的带读手册，并附全景流程图与毕业练习。建议先用带读系列建立直觉，再回到下面的"第二/第三圈"自主扩展。

**第一圈：核心主干（必读）**
1. `packages/core/session/src`——`SessionEvent` 追加日志 + 内存 store（`ctx.sessions`）
2. `packages/core/system-prompt/src`——prompt 段落 + 工具 schema 组装（`ctx.systemPrompt`）
3. `packages/core/tools/src`——工具注册表 + 守卫执行管线（`ctx.tools`）
4. `packages/core/agent/src`——`Agent` 接口 + 实时注册表 + `agent/*` 事件（`ctx.agents`）
5. `packages/core/agent-loop/src`——默认驱动（`ctx.agentLoop`），文件不多：`agent.ts` / `tool-calls.ts` / `runtime-context.ts` / `invariant.ts`
6. `packages/llm/llm/src`——消息 + 流词汇表 + adapter 接缝（`ctx.llm`）

**第二圈：组装与启动**
7. `packages/examples/agent-spine-demo/src/index.ts`——**最佳入门读物**：一个无 UI、无执行器的"智能体骨架"如何把上述服务 bundle 到一起
8. `examples/headless-agent/cordis.yml`——一份完整可读的真实配置（含 LLM/credentials/bash/fs/subagent/workflow/compaction/persistence），逐行注释
9. `packages/bundle/base/` / `web-app/` / `headless/`——三个 bundle 的 patch 层
10. `packages/boot/app-boot/`——profile/bundle 叠加层如何拼成最终插件树

**第三圈：能力接缝实现**（按阶段⑤的清单读）

### 进阶主题文档
- `docs/agent-lifecycle.md`——时序图
- `docs/tool-execution-pipeline.md`——工具管线细节
- `docs/persistence-catalog.md`、`docs/config-catalog.md`——生成的目录
- `docs/defensive-patterns.md`——**做生命周期/并发/子进程/拆卸工作前必读**
- `docs/graph-atlas.md`、`docs/module-graph.md`——模块依赖图

### 关键不变量（读源码时反复验证）
- **注册即副作用**：每个贡献都走 `ctx.effect()`/`ctx.on()`，`register()` 返回 disposer；
- **运行时不变量断言"拥有关系"**：检查权威事件流/可变数据，而非服务/方法是否存在；
- **switch 用判别标签**：封闭 union 用 `assertNever` 收尾；
- **waterfall 监听器必须调 `next()`**；
- **模型可见 ⟺ 已记录**；
- **新行为走插件/扩展点，不改 loop**——改 loop 必须同步更新 architecture.md。

### 验收标准
- [ ] 能画出"一条用户消息从输入到 assistant 输出"的完整插件协作链路
- [ ] 能在 `agent-spine-demo` 里指出每个 import 对应哪个 `ctx.*` 服务
- [ ] 读 headless-agent 的 cordis.yml 时，每一行都知道它贡献什么

---

## 阶段 ⑦ 进阶贡献与工程规范

### 学习目标
达到能提交合格 PR 的水平：理解测试策略、文档约定、提交规范、CI 组织。

### 阅读材料
- `AGENTS.md`（仓库根）——**面向贡献者/agent 的最高行为准则**，逐条读
- `docs/development.md`——开发指南（环境 / TS 工程布局 / 日常流程）
- `docs/testing.md`——测试策略（重点：CI 覆盖门是 `test:coverage` 而非 `test`）
- `docs/defensive-patterns.md`——防御性模式
- `CONTRIBUTING.md` / `CONTRIBUTING.zh.md`
- `docs/cookbook/maintaining-dsh-code-review.md`——代码评审维护
- `docs/cookbook/responding-to-pr-review-on-a-stack.md`——stacked PR 评审
- `.agents/notes/README.md`——**Agent Note** 制度（非平凡变更必须在同 PR 加一篇 Note）

### 常用命令（背熟）
```sh
pnpm install
pnpm run typecheck        # 类型检查
pnpm run lint             # oxlint
pnpm run test             # vitest 单测
pnpm run test:coverage    # CI 覆盖门：packages/*/*/src 逐文件 100%
pnpm run test:e2e         # 真实 API 测试（无 key 自动跳过）
pnpm run test:snapshot    # 无 key 的 ACP/headless 回放快照
pnpm run build            # tsc 出 lib/types，tsdown 打运行时
pnpm run hygiene          # knip + publint + workspace 约束
pnpm run doc-sync         # 文档门
pnpm dsh --profile headless "任务"   # 从源码跑单个任务
```
> ⚠️ 提交前用 `.agents/skills/dsh-pre-push-checks/` 走预检；**不要**默认跑全套测试，CI 负责穷尽覆盖。

### 必须遵守的工程约定（摘自 AGENTS.md，高频踩坑点）
- **包名统一** `@deepseek-ai/dsh-<name>`；`@deepseek-ai/cordis` 是每个包的 peerDependency；
- **全 ESM**（`"type": "module"`）；跨包用包名，本地相对导入用 `.ts`；
- **显式 > 隐式**：默认值在 `resolve()` 显式步骤里给，别藏在 `run()` 里的 `?? default`；
- **插件里禁止硬编码可调参数**：部署相关的选择必须是校验过的 `Config` 字段，能从 cordis.yml 改；
- **错误大声报**（fail loud）：能自检就在加载时报，否则在最早可解析点报，绝不静默跳过缺失引用；
- **跨边界 id 要打品牌**（`Branded<B>`，来自 `dsh-brand`），不用裸 `string`；
- **源码面 vs 产物面，不混用**；
- **非平凡变更必须配 Agent Note**；
- **测试描述行为而非正确性**：改了过时行为就连测试一起改，并在 PR 里说明为什么；
- **文件恰好一个结尾换行**；`git diff --cached --check` 预提交门把关。

### Host / Client 双聚合（TS 工程布局重点）
仓库分 `tsconfig.host.json`（Host 包）和 `tsconfig.client.json`（浏览器包）两个聚合程序，因为**两侧会在相同 `ctx` key 下声明合并不同的服务**，放进同一个 `ts.Program` 会冲突。新包只能注册进**恰好一个**聚合。

### 验收标准
- [ ] 能本地跑通 `typecheck` + `test:coverage` + `build` + `hygiene`
- [ ] 知道提 PR 要打 `kind/*` + `area/*` 标签、选 Issue Type
- [ ] 非平凡改动知道要配 Agent Note 和无 key 快照

---

## 附录 A：术语速查（精简版）

| 术语 | 含义 |
|---|---|
| **plugin** | 实现 `Service` 的对象（函数/对象/类），dsh 一切皆插件 |
| **ctx** | context，服务仓库，插件通过 `ctx.<key>` 取能力 |
| **inject** | 声明服务依赖，决定加载时机 |
| **effect / disposer** | 可逆副作用 + 其清理函数 |
| **seam（接缝）** | 一个可替换能力的完整三角色（Definition+Provider+Consumer） |
| **turn / step / round** | 回合（含若干 step）/ 单次模型请求+工具 / 外层策略迭代 |
| **SessionEvent log** | 追加式会话日志，模型上下文的唯一真相源 |
| **Model-visible ⟺ logged** | 凡到模型请求的，必可从日志重建 |
| **scope** | 每 agent 注册单元（global 或 scoped 到某 agent） |
| **profile / bundle** | 命名组合 / 可 patch 的分发层 |
| **Ralph loop** | 前台 fresh-agent 工作流迭代（非同会话 goal） |
| **waterfall + next()** | 串行中间件，必须调 next 才传递，否则短路 |

> 完整术语见 `docs/glossary.md`。

---

## 附录 B：关键文件/目录索引

| 路径 | 作用 |
|---|---|
| `AGENTS.md` | 贡献者最高准则（先读！） |
| `docs/architecture.md` | 改 packages/ 前必读 |
| `docs/cordis-tutorial/` | Cordis 7 章入门教程 |
| `docs/capability-seams.md` | 全能力接缝图表 |
| `docs/cookbook/` | 扩展实战 cookbook |
| `docs/subsystems/` | 子系统专题 |
| `docs/defensive-patterns.md` | 生命周期/并发前必读 |
| `packages/core/` | 产品主干源码 |
| `packages/examples/agent-spine-demo/` | 最佳入门骨架源码 |
| `examples/headless-agent/cordis.yml` | 完整可读真实配置 |
| `vendor/cordis/bin.js` | 教程用的一文件启动器 |
| `.agents/notes/` | Agent Note 决策档案 |
| `.agents/skills/` | 内置技能（如 pre-push-checks） |

---

## 附录 C：一条"最短路径"速通建议

如果你时间有限，想最快达到"能写 dsh 插件"：

1. `README.md` 跑起来（30 min）
2. `docs/cordis-primer.md` + 教程 1/3/4/7 章（半天）
3. `docs/architecture.md` 通读 + `docs/user/develop/basic/tool.md`（半天）
4. 照 `adding-a-tool.md` 写一个真工具挂到 Web UI（半天）

随后按阶段 ⑤⑥⑦ 按需深入。

---

*本手册基于仓库当前 master 状态（dsh 0.1.0-rc.x，developer preview）编写。项目快速迭代，若文档与代码冲突，以 `AGENTS.md` 与 `docs/` 内最新版本为准。*
