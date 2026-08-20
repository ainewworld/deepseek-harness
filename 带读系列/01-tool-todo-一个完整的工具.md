# 带读 ① 一个完整的工具：`tool-todo`

> 本系列的**起点**。`todo_write` 是 dsh 里**最小、最完整、最真实**的工具插件——它只有一个文件、不到 230 行，却包含了一个生产级工具的全部要素：插件声明、配置、工具定义 DSL、参数 schema、规范输出、UI 卡片、可选的会话投影。
>
> 读懂这一个文件，你就掌握了"一个 dsh 工具长什么样"。后续带读会回答："这个工具注册上去之后，是怎么被调用、被记录、被驱动的"。

---

## 📌 文件定位

`packages/todo/tool-todo/src/index.ts`（227 行）

它在 `headless-agent` 配置里这样挂载：
```yaml
- id: tool-todo
  name: '@deepseek-ai/dsh-tool-todo'
  config:
    allowParallelInProgress: true
```

---

## 第一段：插件的身份与依赖

> 📎 `packages/todo/tool-todo/src/index.ts:22`

```ts
22  export const name = 'tool-todo'
23  export const inject = ['tools']
```

- `name`：可选的展示元数据，仅用于诊断。
- `inject = ['tools']`：声明**强依赖**。Cordis 会把这个插件挂起（PENDING），直到 `ctx.tools`（工具注册表服务）存在，`apply` 才会运行。

🎯 **设计精华卡片 #1 — 加载顺序由依赖决定，而非文件顺序**
> `cordis.yml` 里两行的先后**不保证**加载顺序。`inject` 才是真相：所有声明 `inject: ['tools']` 的插件，都必然在工具注册表就绪后才启动。这是"微内核 + 依赖注入"取代"手动 boot 序列"的关键。

🤔 **思考题**：如果这里漏写 `inject = ['tools']`，但 `apply` 里用了 `ctx.tools.register(...)`，会发生什么？（提示：PENDING、运行时 `ctx.tools` 可能为 `undefined`）

---

## 第二段：可配置——部署相关的选择必须是 Config 字段

> 📎 `packages/todo/tool-todo/src/index.ts:29`

```ts
29  export interface Config {
37    allowParallelInProgress: boolean
38  }
41  export const Config: z<Config> = z.object({
42    allowParallelInProgress: z.boolean().required(),
43  })
```

- `Config` 是**类型**；同名导出的 `Config`（`z<Config>`）是 **Schemastery 校验 schema**。
- `apply(ctx, config)` 第二个参数会拿到**校验过、带默认值**的配置。

🎯 **设计精华卡片 #2 — 插件里禁止硬编码可调参数**
> AGENTS.md 的铁律：部署相关的选择（这里"是否允许多个 in_progress"）必须是可从 `cordis.yml` 改的 `Config` 字段，而不是 `true` / `false` 写死。`allowParallelInProgress` 单这一项就决定了工具描述文案和校验逻辑两处行为。

---

## 第三段：模型可见的"工具描述"是动态拼出来的

> 📎 `packages/todo/tool-todo/src/index.ts:45`

```ts
45  const DESCRIPTION_HEAD = 'Record and update a structured task list ... '
51  const DESCRIPTION_PARALLEL = 'Mark every todo being actively worked on `in_progress` ... '
57  const DESCRIPTION_SINGLE  = 'Keep AT MOST ONE todo `in_progress` at a time ... '
61  const DESCRIPTION_TAIL = 'Mark a todo `completed` the moment it is done ... '

74  function describe(allowParallel: boolean): string {
75    return DESCRIPTION_HEAD
76      + (allowParallel ? DESCRIPTION_PARALLEL : DESCRIPTION_SINGLE)
77      + DESCRIPTION_TAIL
78  }
```

注意：**传给模型的 `description` 会随配置变化**。串行部署告诉模型"只能一个 in_progress"，并行部署（有子智能体/后台命令）则鼓励"全部标记"。工具的"说明书"和它的"校验规则"由同一个开关驱动，保持一致。

---

## 第四段：工具定义的五件套（本文件核心）

> 📎 `packages/todo/tool-todo/src/index.ts:149`

```ts
149  ctx.tools.register(defineTool({
150    name: 'todo_write',
151    description: describe(allowParallel),
152    parameters: {
153      todos: {
154        type: 'array', required: true,
156        description: 'The COMPLETE task list, replacing any previous list.',
157        items: {
158          type: 'object', additionalProperties: false,
160          properties: {
161            content: { type: 'string', required: true, ... },
162            status: { type: 'string', required: true, enum: [...STATUSES], ... },
```

`defineTool` 把 `parameters` 翻译成给模型看的 JSON Schema，并**推断 `execute(args)` 的入参类型**、在 `execute` 前**自动校验**模型入参。

> 📎 `packages/todo/tool-todo/src/index.ts:172`

```ts
172    output: {
173      schema: {                              // ← execute 返回值的规范 schema
174        type: 'object', additionalProperties: false,
176        properties: {
177          todos: { ... },
189          counts: { ... pending/inProgress/completed ... },
200        },
201      },
202      render: (_args, value) => [{          // ← 模型可见的内容（Native）
203        type: 'text',
204        text: `Updated todo list: ${value.counts.pending} pending, ...`,
205      }],
206    },
```

🎯 **设计精华卡片 #3 — 规范值 vs 模型可见内容，是两件事**
> - `output.schema` + `execute` 返回值 = **规范的、可被程序解析的 JSON**（这里是 `{todos, counts}`）。
> - `output.render` = 把规范值**翻译成模型读得懂的文字**。
> - 两者分离的意义：Code Mode（代码模式）下程序直接拿规范值（`counts`），不解析自然语言；模型则读 render 的文字。**永远不要让调用方从散文里解析 id/字段。**

> 📎 `packages/todo/tool-todo/src/index.ts:206`

```ts
206    execute(args, exec) {
207      const todos = toTodoList(args.todos, allowParallel)   // DSL 表达不了的约束，手动查
208      if (!exec.agent) {
211        throw new Error('todo_write requires an owning agent session')
212      }
213      exec.agent.session.append('todo/write', { todos })    // ← 写进会话日志！
214      const count = (status) => todos.filter(t => t.status === status).length
215      return Promise.resolve({ todos: ..., counts: { ... } })  // ← 返回规范值
223    },
224    presentCall: args => ({ card: 'generic', title: 'Update todo list', ... }),
225  }))
```

工具契约的几条铁律，全在这 20 行里体现了：
- **抛异常 = `isError`**：`exec.agent` 不存在就 throw（基础设施失败用 throw）。
- **遵守 `exec.signal`**：本工具是同步的，无需；长任务要响应取消。
- **返回规范值**：不返回 content 块、不返回散文。
- **`presentCall` = UI 卡片**：与 `output.render`（模型可见）分开，且**必须是纯函数**（replay 时也会跑，不能有 I/O / 时钟 / 随机）。

🤔 **思考题**：第 213 行 `exec.agent.session.append('todo/write', ...)`——为什么工具要自己往会话日志写事件，而不是只返回结果让循环去记？（提示：回顾"模型可见 ⟺ 已记录"；todo 列表是**跨 step 持久**的 UI/模型状态，需要独立的事件，见下一段投影）

---

## 第五段：可选依赖 + 会话投影（进阶）

> 📎 `packages/todo/tool-todo/src/index.ts:135`

```ts
135    ctx.inject(['sessionProjections'], (projectionCtx) => {
136      projectionCtx.sessionProjections.register<'todos', TodoItem[] | null>({
137        key: 'todos',
139        init: () => null,
140        apply: (state, event) => {
141          if (event.type === 'todo/write') return event.data.todos   // 每次 write → 最新列表
142          if (event.type === 'turn/start') return null               // 新回合 → 清空
143          return state
144        },
146        stateVersion: 2,
147      })
148    })
```

- `ctx.inject([...], cb)`：**可选依赖**。`sessionProjections` 服务在就注册投影单元，不在就静默跳过（headless 没装投影服务也不报错）。
- "投影（projection）"= 一个**从日志事件 fold 出的派生状态**：`todo/write` 更新列表，`turn/start` 清空。UI 直接读这个折叠后的状态，不用重放整条日志。

🎯 **设计精华卡片 #4 — 强依赖 `inject` vs 可选依赖 `ctx.inject([...])`**
> - 顶部 `export const inject = ['tools']`：**硬要求**，缺了插件不启动。
> - 这里 `ctx.inject(['sessionProjections'], ...)`：**软要求**，缺了就降级。
> 一个工具"必须有工具注册表才能存在"，但"有投影服务就更好（UI 能渲染 checklist），没有也能跑"——这种分层依赖正是 dsh 可组合性的体现。

---

## 第六段：DSL 校验之外的约束，手动兜底

> 📎 `packages/todo/tool-todo/src/index.ts:91`

```ts
91  function toTodoList(raw, allowParallel): TodoItem[] {
92    const todos: TodoItem[] = []
93    const seen = new Set<string>()
94    let active = 0
95    for (const item of raw) {
96      const content = item.content.trim()
97      if (content.length === 0) throw new Error('invalid todo: `content` must be a non-empty string')
100      if (seen.has(content)) throw new Error(`invalid todos: duplicate content ...`)
104      if (item.status === 'in_progress') active++
105      todos.push({ content, status: item.status as TodoItem['status'] })
107    }
107    if (!allowParallel && active > 1) throw new Error(`invalid todos: at most one task may be in_progress ...`)
111    return todos
112  }
```

`defineTool` 的 schema 能表达"类型 / required / enum / additionalProperties"，但表达不了"非空""去重""跨字段最多一个 in_progress"。这些 DSL 表达不了的约束，才在 `execute` 里手动查并 throw。**这是"显式 > 隐式"在工具内部的落地。**

---

## 🧭 本篇小结 & 衔接下一站

你现在已经知道**一个工具是如何被定义和注册的**。但 `ctx.tools.register(...)` 之后，工具是怎么被"调用"的？模型回复里出现一个 `tool-call`，它会经过怎样一条**策略管线**（鉴权、沙箱、超时、观测）才真正跑到你的 `execute`？

这正是带读②的主题：**工具注册表与执行管线（`core/tools`）**。

| 你在这里学到的 | 下一站将回答 |
|---|---|
| 工具的五件套：name/description/parameters/output/execute | `register` 之后，schema 如何进入 system prompt |
| 规范值 vs 模型可见内容 vs UI 卡片 | `tools/pre-execute → guard → execute → post-execute → result` 五段管线 |
| 强依赖 `inject` 与可选依赖 `ctx.inject` | 哪段是"可扩展策略"，哪段是"单调最终否决" |

> 📎 完整源码：`packages/todo/tool-todo/src/index.ts`（共 227 行，建议通读一遍）
