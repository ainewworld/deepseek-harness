# 带读 ⑥ 组装骨架：`agent-spine-demo` + `cordis.yml`

> 这是系列的**终点站**。前 5 篇你把每个零件（工具、管线、日志、循环、调度器）都拆开看过了；本篇把它们**装回一台完整的 agent**。
>
> `agent-spine-demo` 是全仓**最好的入门读物**：它是一个"无 UI、无执行器"的骨架，把通用服务 bundle 到一起，把"选哪个 LLM / 哪个 bash 执行器"留给上层。看懂它 + 一份 `cordis.yml`，你就拥有了"自己组装一个 agent"的能力。

---

## 📌 文件定位

- `packages/examples/agent-spine-demo/src/index.ts`（265 行）——骨架插件
- `examples/headless-agent/cordis.yml`——一份完整可读的真实配置（逐行注释）

---

## 第一段：它 bundle 了什么、故意不 bundle 什么

> 📎 `packages/examples/agent-spine-demo/src/index.ts:1`（文件头注释）

```ts
1   /**
2    * Default executor-less, UI-less agent spine. It bundles the common services,
3    * background-job registry and controls, optional persisted goals, concrete loop, local skill and
4    * agent-instructions providers, and model-facing shell/skill consumers;
5    * deployments still choose the LLM adapter, bash executor, and presentation.
```

🎯 **设计精华卡片 #1 — "骨架"的含义：通用件内置，可变件外置**
> 一个 agent 由几十个插件组成，但可以二分：
> - **通用件**（几乎人人都需要）：会话、系统提示、工具注册表、技能、循环、目标、不变量……→ 骨架内置。
> - **可变件**（部署相关、要选型）：**LLM 适配器、bash 执行器、持久化后端、UI** → 骨架不装，留给 `cordis.yml`。
>
> 这就是"骨架 + 配置"的分工：骨架降低组装成本，配置保留可替换性。

---

## 第二段：配置 = 各子插件配置的并集

骨架把每个字段**原样转发**给"拥有它的子插件"：

> 📎 `packages/examples/agent-spine-demo/src/index.ts:92`

```ts
92    export interface Config {
94      agents?: AgentLoopConfig['agents']              // → agent-loop
96      maxParallelToolCalls?: ...                       // → agent-loop（带读⑤的并发上限）
98      includeHarnessIdentity?: ...                     // → system-prompt
102     persona?: ...                                    // → system-prompt
105     tools?: ToolsConfig                              // → tools
108     dshHome?: string                                 // → bash-env + skill 发现
112     workspaceContext: workspaceContext.Config | false // → agent-instructions（显式预算）
118     skills?: SkillConfig                             // → skill 三件套
120     toolBash?: toolBash.Config | false               // → bash 工具
128     goals?: GoalConfig | false                       // → 目标域（opt-in）
129   }
...
160   export const Config = z.intersect([
161     AgentLoop.Config,
162     SystemPrompt.Config,
163     z.object({ tools: ToolRuntime.Config, ... }),
175   ])
```

🎯 **设计精华卡片 #2 — 显式 > 隐式，配置门在校验点**
> 第 112 行 `workspaceContext` 是**必填**（`Config | false`，要么给字节预算要么显式关）——因为它会改变模型可见输入，不能偷偷默认。这是 AGENTS.md "misconfiguration fails loud" + "workspace context requires an explicit byte budget" 的落地。而 `toolBash`、`toolJobs`、`goals` 用 `Config | false`：**opt-in 或显式关闭**，语义清晰。

---

## 第三段：apply ——一次 `ctx.plugin()` 挂一个子插件

这是全文最重要的 50 行。注意注释（203–211）：

> 📎 `packages/examples/agent-spine-demo/src/index.ts:212`

```ts
203    /**
204     * Load the spine. Each `ctx.plugin(...)` mounts one child of the bundle fiber;
...
207     * Load order is irrelevant (cordis pends each fiber on its `inject` until the services it
208     * need exist), but the listing mirrors the dependency layering for readability: the LLM vocabulary
209     * and core registries first, then extension plugins that wrap request/tool seams, then the loop.
210     */
212    export function apply(ctx: Context, config: Config): void {
220      ctx.plugin(Timer)
221      ctx.plugin(LlmRuntime)                      // ← ctx.llm（消息词汇 + adapter 接缝）
222      ctx.plugin(SessionStore)                    // ← ctx.sessions（带读③）
223      ctx.plugin(SessionTitleService, ...)
225      ctx.plugin(SystemPrompt, {...})             // ← ctx.systemPrompt
231      ctx.plugin(ToolRuntime, config.tools ?? {}) // ← ctx.tools（带读②）
234      ctx.plugin(SkillRegistry, ...)
237      ctx.plugin(AgentRegistry)                   // ← ctx.agents（带读④的 Agent 接口）
238      ctx.plugin(llmRetry)                        // ← 包裹 llm.stream 的重试插件
244      ctx.plugin(LocalJobRegistry, ...)           // ← ctx.jobs（后台任务）
245      ctx.plugin(InvariantRegistry, ...)          // ← 运行时不变量检查
246      ctx.plugin(sessionInvariant); ctx.plugin(agentInvariant); ...
250      if (config.toolBash !== false) { ctx.plugin(bashEnv, ...); ctx.plugin(toolBash, ...) }
254      if (config.workspaceContext !== false) ctx.plugin(workspaceContext, ...)
259      if (skillsEnabled) ctx.plugin(toolSkill, ...)
260      if (config.toolJobs !== false) ctx.plugin(toolJobs, ...)
261      ctx.plugin(AgentLoop, { agents: config.agents ?? [], ... })  // ← 主循环（带读④）最后挂
265    }
```

🎯 **设计精华卡片 #3 — 顺序无关，但可读性优先**
> 第 207 行明说："Load order is irrelevant"。每个 `ctx.plugin` 都会因 `inject` 挂起，直到它需要的服务就绪——所以这里**先挂 AgentLoop 再挂 LlmRuntime 也能跑**。
>
> 那为什么还要按"词汇/注册表 → 扩展 → 循环"排列？**纯粹为人**：让读者按依赖层次读下来。这是"代码写给读它的人"的好范例。

🤔 **思考题**：第 257–259 行注释："workspace instructions must precede the skill catalog"，因为"两者都 prepend session-prefix 消息，注册顺序即渲染顺序"。这跟第 207 行"顺序无关"矛盾吗？（提示：不矛盾。**加载/启动**顺序由 `inject` 决定（无关）；但**同名注册的渲染顺序**由注册顺序决定（有关）。两件事别混。）

---

## 第四段：真实配置 `cordis.yml` ——选 provider 的地方

骨架没装的"可变件"，全在 `cordis.yml` 里选。看 headless-agent 的关键行：

> 📎 `examples/headless-agent/cordis.yml`

```yaml
- id: llm-deepseek
  name: '@deepseek-ai/dsh-llm-deepseek'        # ← 选 DeepSeek 作为 LLM provider（可换成 llm-pi-ai）
  config:
    thinking: enabled
    reasoningEffort: max
    models: [deepseek-v4-pro, deepseek-v4-flash]

- id: subprocess
  name: '@deepseek-ai/dsh-subprocess-local'    # ← 子进程 provider：本地

- id: bash
  name: '@deepseek-ai/dsh-bash-local'          # ← shell provider：本地 bash（可换 bash-sandbox/pwsh-local）
  config: { timeoutMs: 60000 }

- id: agent-spine
  name: '@deepseek-ai/dsh-agent-spine-demo'    # ← 挂骨架！
  config:
    agents:
      - { id: main, provider: deepseek-official, model: deepseek-v4-flash, cwd: !!js process.cwd() }
    persona: 'You are headless-agent, a coding assistant powered by the {{model}} model.'

- id: persistence
  name: '@deepseek-ai/dsh-session-persistence-jsonl'   # ← 持久化后端：JSONL（可换 sqlite）
```

🎯 **设计精华卡片 #4 — 换一行 provider = 换整个执行世界**
> 把 `dsh-bash-local` 换成 `dsh-bash-sandbox`，bash 就跑进沙箱；把 `dsh-subprocess-local` + `dsh-bash-local` 换成 E2B 的 `subprocess-e2b` + `bash-local`(指向 e2b) + `fs-e2b`，**bash / PTY / LSP / 文件系统全部跟着进了远程 Linux 沙箱**——而 `tool-bash`、`agent-loop`、会话日志一行都不用改。
>
> 这就是带读①开篇讲的"能力接缝三角色"在配置层的威力：**Provider 和 Consumer 互不依赖，都只依赖 Definition。** 配置文件是唯一需要改的地方。

---

## 第五段：`!!js` ——配置里的条件表达式

> 📎 `examples/headless-agent/cordis.yml`

```yaml
    cwd: !!js process.cwd()                                    # ← 运行时求值
    compression: !!js "process.env.DSH_SNAPSHOT === undefined ? 'zstd' : 'none'"
```

🎯 **设计精华卡片 #5 — 配置即组合（composition）**
> `!!js` 让 `cordis.yml` 的某些字段在加载时**求值为 JS 表达式**（用 `!!js` 不是 `!js`——AGENTS.md 铁律）。于是"压缩格式随环境变量切换""cwd 取当前目录"这类部署差异，不需要改插件代码，也不需要 fork 配置文件。这是"profile / bundle / patch"叠加层的最后一公里。

🤔 **思考题**：`AGENTS.md` 强调 `cordis.yml` 里"只有 `config` 和 `disabled` 允许 `!!js`，其它元数据保持字面量"。为什么不让所有字段都能求值？（提示：可求值的字段越多，配置的"可静态分析性"越差；把动态性限制在必要处，其余保持声明式，组合才可预测。）

---

## 🧭 本篇小结 & 系列收官

恭喜走完全程。回顾这条线：你从**一个工具的 227 行**（带读①）出发，经**工具管线**（②）、**会话日志**（③）、**主循环**（④）、**调度器**（⑤），最后回到**装配**（⑥）。一台 dsh agent 的全部关键机制，你都从源码层面看过了。

> 📎 完整源码：`packages/examples/agent-spine-demo/src/index.ts`（265 行）
> 📎 完整配置：`examples/headless-agent/cordis.yml`（建议逐行读，每行都注释了它贡献什么）

接下来去 **`00-导览：一条线、全景图、毕业练习`**，看整条线如何收束成一张图，并用一个毕业项目检验你的理解。
