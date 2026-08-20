# 带读 ② 工具注册表与执行管线：`core/tools`

> 带读①你学会了"**定义**一个工具"。本篇回答下一个问题：工具 `register` 上去之后，模型的一次 `tool-call` 要走完怎样一条**策略管线**，才会真正进入你的 `execute`？
>
> `core/tools` 是 dsh 工具能力的**核心脊柱**（`ctx.tools`）。它做三件事：**注册**（谁可见）、**组装**（schema 进入 system prompt）、**执行**（一条可扩展的策略管线）。本篇聚焦注册和管线——这是理解"为什么换 provider、加鉴权、加超时都不用改工具"的关键。

---

## 📌 文件定位

`packages/core/tools/src/index.ts`（1946 行，全仓最大单文件之一）
它是 `ctx.tools`（`ToolRuntime` 服务）的实现。配套还有 `schema.ts`（参数 DSL → JSON Schema）、`presentation.ts`（UI 卡片）、`code-mode.ts`（代码模式）。

---

## 第一段：注册是一次可逆副作用

> 📎 `packages/core/tools/src/index.ts:1037`

```ts
1037    register(definition: ToolDefinition): () => void {
1038      const name = definition.name
1039      const output = (definition as Partial<ToolDefinition>).output
1040      if (output === undefined || typeof output !== 'object'
1041        || typeof output.render !== 'function'
1042        || (output.presentationMeta !== undefined && typeof output.presentationMeta !== 'function')) {
1043        throw new TypeError(`tool "${name}" must declare output { schema, render, presentationMeta? }`)
1044      }
1045      assertSupportedJsonSchema(output.schema)
...
1057      if (name === RUN_CODE_NAME) {
1058        throw new Error(`tool name "${RUN_CODE_NAME}" is reserved for the Code Mode ...`)
1059      }
1060      return this.layers.effect(
1061        this.ctx,
1062        layer => layer.tools.insert(name, definition),
1063        { label: 'tools.register()' },
1064      )
1065    }
```

逐行看：
- **1038–1045 早期校验**：注册时（而非调用时）就校验 `output` 结构和 schema 合法性。**misconfiguration fails loud**——坏配置在加载点报错，绝不静默。
- **1057–1059 保留名**：`run_code` 是 Code Mode 传输层的保留工具名，任何 agent 都可能为自己挂一个，所以无条件禁止占用。
- **1060–1064 注册即 effect**：`this.layers.effect(...)` 返回一个 **disposer**。卸载插件时，这个工具会自动从注册表移除。

🎯 **设计精华卡片 #1 — 注册即副作用（registration is a reversible effect）**
> `register()` 返回 disposer、记录在插件的 fiber 上。这就是"Cordis 热重载为何对工具天然有效"的底层原因：换掉一个工具插件 = 卸载旧 effect + 挂载新 effect，注册表始终一致。你永远不需要手动 `unregister`。

🤔 **思考题**：为什么校验放在 `register` 里、而不是等第一次调用时才校验？（提示：把"配置错误"的暴露时机尽量提前——这是 AGENTS.md 的 "fail loud" 原则）

---

## 第二段：策略管线的"契约"——五个事件

整条管线的语义，先用**事件声明**（TypeScript 声明合并）固定下来。这五个事件就是五个扩展点：

> 📎 `packages/core/tools/src/index.ts:152`

```ts
152    'tools/pre-execute'(this: Scoped<ToolRuntime>, exec: ToolExecution, next): Promise<PreToolDecision>
163    'tools/execute'(this: Scoped<ToolRuntime>, exec: ToolDispatchExecution, next): Promise<ToolExecutionResult>
175    'tools/post-execute'(this: Scoped<ToolRuntime>, exec: ToolExecution, result, next): Promise<PostToolDecision>
189    'tools/code-dispatch-log'(this: Scoped<ToolRuntime>, dispatch: CodeDispatchLog, next): Promise<ContentBlock[]>
197    'tools/result'(this: Scoped<ToolRuntime>, exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): undefined
```

把这五个事件对照"一次调用的生命周期"：

| 阶段 | 事件 | 模式 | 干什么 | 典型用途 |
|---|---|---|---|---|
| ① 进门前 | `tools/pre-execute` | waterfall | **可扩展的 allow / deny / ask 策略** | 权限门、Plan Mode、审批 |
| ② 真正执行 | `tools/execute` | waterfall | **包裹 dispatch 生命周期**（仅可替换 `signal`） | 超时、重试、指标 |
| ③ 出门后 | `tools/post-execute` | waterfall | **改写/阻断/富化结果** | spill 策略、内容脱敏 |
| ④ Code Mode 日志 | `tools/code-dispatch-log` | waterfall | 改写**日志副本**（程序已拿到原值） | 超大结果只存定位符 |
| ⑤ 终态观测 | `tools/result` | **emit** | **只读**观测冻结的最终结果 | 审计、埋点、统计 |

🎯 **设计精华卡片 #2 — 五段管线，职责严格分层**
> 注意模式（`@mode`）的差异：
> - `pre-execute` / `execute` / `post-execute` 是 **waterfall**（串行中间件，**必须调 `next()`** 才能传递，否则短路）；
> - `result` 是 **emit**（纯观测，无返回值，监听器失败被隔离不影响别人）。
>
> 选哪个扩展点有明确规则：**策略放 pre-execute，包裹放 execute，改写放 post-execute，审计放 result。** 不要混用——比如把"鉴权"写进 execute 就绕过了"被 guard 终极否决"的保证。

🤔 **思考题**：`tools/result` 为什么是 `emit` 而不是 `waterfall`？如果改成 waterfall 让监听器能改结果，会破坏什么不变量？（提示：想想"模型可见 ⟺ 已记录"，以及审计的可信度）

---

## 第三段：pre-execute → 守卫 → 派发，一条河的闸门

这是整条管线的"调度入口"（被带读⑤的调度器调用）。它把"可扩展策略"和"单调最终否决"串成一道闸：

> 📎 `packages/core/tools/src/index.ts:1463`

```ts
1463    private async prepareExecution<T>(input, next): Promise<T> {
1467      const created = this.createExecution(input)        // 物化、冻结入参、分配 exec.token
1468      if (created.kind !== 'ready') return next(created)
1470      if (this.callerCancelled(exec))                    // 取消早退
1471        return next({ kind: 'final-result', exec, result: toolAbortedBeforeDispatchResult() })
1474      const carrier = scopeTarget(this, exec.agent)      // 按 agent 作用域过滤派发
1475      const gate = await this.ctx.waterfall(
1476        carrier, 'tools/pre-execute', exec,              // ← ① 可扩展策略（权限/审批/Plan）
1477        () => Promise.resolve<PreToolDecision>({ kind: 'allow' }),
1478      )
1479      const askResolution = gate.kind === 'ask'          // ask → 走 approval 服务问人
1480        ? await this.serviceAsk(exec, gate) : { decision: gate, approvalCancelled: false }
1486      const denialReason = decision.kind === 'allow'
1487        ? this.guardReason(exec)                          // ← ② 单调最终否决（guard）
1488        : decision.reason
1489      if (denialReason !== undefined)                     // deny/guard 命中 → 构造错误结果，不进 body
1490        return await next({ kind: 'post-result', exec, result: ... })
1503      return await next({ kind: 'dispatch', exec })      // ← ③ 放行，交给 dispatchToolBody
1506    }
```

读完这段，"为什么换 provider、加鉴权、加超时都不用改工具"就有了答案：
- 工具作者（带读①）**只写 `execute`**；
- 鉴权插件**监听 `tools/pre-execute`** 返回 allow/deny/ask；
- 沙箱插件**也监听 `tools/pre-execute`** 做能力级否决；
- 超时插件**监听 `tools/execute`** 包一层 deadline。
- 这些彼此**互不依赖**，都只和 `core/tools` 的扩展点契约耦合。

---

## 第四段：单调守卫（guard）——pre-execute 之后的最后一道否决

> 📎 `packages/core/tools/src/index.ts:1110`

```ts
1110    guard(guard: ToolGuard): () => void {
...
1114        { label: 'tools.guard()', notify: false },
```

`guard()` 注册的守卫在 `pre-execute` 全部通过后、`dispatch` 之前执行（`guardReason` at 1487）。它和 `pre-execute` 的区别是：

🎯 **设计精华卡片 #3 — 可扩展策略 vs 单调不变量**
> - `tools/pre-execute`（waterfall）：**可扩展、可重排**的策略层。监听器可以 allow、可以 deny、可以 ask。一个 allow 监听器后面可能跟一个 deny 监听器。
> - `tools.guard()`（注册式）：**单调的最终否决**。任何监听器都无法撤销一个 guard 的 deny。
>
> 换句话说：**"部署策略"用 pre-execute，"系统不变量"用 guard**。比如"Plan Mode 下禁止写文件"是策略（可关），"调用 token 不可篡改"是不变量（用 guard 钉死）。

---

## 第五段：around-dispatch——执行体周围的可替换信号

> 📎 `packages/core/tools/src/index.ts:1532`

```ts
1532    private async dispatchToolBody(exec: MutableToolRunContext): Promise<ToolExecutionResult> {
1536      const wrapperSignal = exec.signal
1537      const fused = fuseToolSignals(state.callerSignal, wrapperSignal)
1538      const signal = fused.signal
1540      if (isAborted(signal)) { fused.dispose(); return toolAbortedBeforeDispatchResult() }
```

`tools/execute` 的 around-wrapper 可以**临时替换 `exec.signal`**（比如塞一个 5s 超时的 signal）。但第 1537 行 `fuseToolSignals` 会把**调用方的原始 signal 和 wrapper 的 signal 融合**——这样 wrapper 的超时和调用方的取消**两者都会生效**，wrapper 永远无法把调用方的取消"弄丢"。

🤔 **思考题**：为什么允许 wrapper 替换 `signal`，却**不允许**替换 `callId / name / arguments / token`？（提示：`exec` 的身份字段是"执行身份"，见带读①第四段——身份受保护，只有信号是可操作字段）

---

## 🧭 本篇小结 & 衔接下一站

你现在掌握了一条完整调用链：**注册（effect）→ schema 进 prompt → pre-execute 策略 → guard 不变量 → execute 包裹 → body → post-execute 改写 → result 观测**。

但有一个悬而未决的问题：**工具结果、assistant 消息、turn/step 边界，到底被写到了哪里？** 模型下一次请求的"历史"又是从哪里读出来的？这就是会话日志的职责。

| 你在这里学到的 | 下一站将回答 |
|---|---|
| 注册是可逆 effect；五个事件是五段管线 | 这些事件**本身**就是会话日志里的事件 |
| pre-execute 是策略，guard 是不变量 | "模型可见 ⟺ 已记录"如何被日志强制 |
| execute 只能换 signal | `deriveMessages()` 如何从日志投影出模型历史 |

> 📎 完整源码：`packages/core/tools/src/index.ts`（重点读 1037–1130 注册/守卫、1454–1540 管线入口；五个事件契约在 148–205）
