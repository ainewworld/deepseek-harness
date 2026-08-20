# 带读 ④ 主循环：`agent-loop`（👑 皇冠）

> 这是整个系列的**皇冠**。前 3 篇你分别认识了"工具""工具管线""会话日志"三个零件；本篇把它们**串成一台发动机**：主循环（`ReactLoopAgent`）。
>
> dsh 里"agent loop 本身也是插件"的承诺，就落在这个类上——它是 `ctx.agentLoop` 的默认实现，而它**只通过 `ctx.llm` / `ctx.tools` / `ctx.systemPrompt` / `session`** 这些服务驱动，不持有任何特权。换掉它，整个产品的"回合节奏"就变了。

---

## 📌 文件定位

`packages/core/agent-loop/src/agent.ts`（497 行）
实现 `Agent` 接口（定义在 `dsh-agent` 包）。一个会话 = 一个 `ReactLoopAgent` 实例。配套 `tool-calls.ts`（带读⑤）、`runtime-context.ts`（运行时上下文投影）。

---

## 第一段：三相状态机——idle / maintenance / running

> 📎 `packages/core/agent-loop/src/agent.ts:38`

```ts
38  type Phase =
39    | { kind: 'idle'; lastTurn: number }
40    | { kind: 'maintenance'; abort: AbortController; lastTurn: number; wakeRequested: boolean }
46    | { kind: 'running'; abort: AbortController; turn: number; step: number; wakeRequested: boolean }
```

一个 agent 在任一时刻只处于三态之一：
- **idle**：空闲，等待输入唤醒。
- **maintenance**：在做"非模型维护工作"（如压缩上下文），独占，不允许并发模型回合。
- **running**：正在跑 turn/step，持有当前 `turn` / `step` 号。

🎯 **设计精华卡片 #1 — 一个 agent 一个 driver，绝并发**
> 第 143 行 `runMaintenance` 开头就 throw："agent already has active work"。dsh 的并发模型是**"同一会话同一时刻只有一个驱动"**：要么在跑模型，要么在做维护，不能同时。这把"消息竞争""状态撕裂"这类问题在源头消灭。

---

## 第二段：构造——建 inbox、装作用域、拿历史 turn

> 📎 `packages/core/agent-loop/src/agent.ts:80`

```ts
80    constructor(
81      private loopCtx: Context,
82      public readonly id: SessionId,
83      public readonly options: AgentOptions,
84      public readonly session: Session,
85    ) {
86      this.dispatch = agentEvents(loopCtx, this)              // ← 一次性构建融合派发器（热路径零分配）
87      this.inbox = new Inbox(session, {                       // ← 收件箱：排队/插队/认领
88        inserted: (m) => this.dispatch.emit('agent/inbox/inserted', { message: m }),
89        discarded: (m) => this.dispatch.emit('agent/inbox/discarded', { message: m }),
90        claimed:   (m, turn) => this.dispatch.emit('agent/inbox/claimed', { message: m, turn }),
91      })
92      const lastTurn = session.events.findLast(e => e.type === 'turn/start')?.data.turn ?? 0
93      this.phase = { kind: 'idle', lastTurn }                 // ← 从日志恢复上次 turn 号（resume 场景）
94      this.scope = createScope(loopCtx, this)                 // ← 这个 agent 的"作用域"，agent.ctx 的根
95      this.ctx = this.scope.ctx.extend({ agent: this })       // ← 在 ctx 上挂自己：子插件可 ctx.get('agent')
96      this.runtimeContext = new RuntimeContextProjection(this.ctx, session)
97    }
```

要点：
- **86 行**：`dispatch` 在构造时建好，热路径派发**不再分配新对象**（性能 + 一致性）。
- **92 行**：从**日志**重建 `lastTurn`——resume 一个会话，turn 号接着涨，不归零。再次体现"日志是真相源"。
- **94–95 行**：`scope` + `ctx.extend({ agent: this })` 让"为这个 agent 注册的工具/段落"成为可能（带读①的"作用域可见且作用域生命周期"）。

---

## 第三段：四种输入入口——followup / steer / inject / cancel

> 📎 `packages/core/agent-loop/src/agent.ts:113`

```ts
113   send(message, target, wakeup): void {
116     const wakingAfterAbort = wakeup && this.phase.kind !== 'idle' && this.phase.abort.signal.aborted
117     const resolvedTarget = wakingAfterAbort ? 'next-turn' : target
118     this.inbox.splice(resolvedTarget, Infinity, 0, [message])
119     if (wakeup) this.wakeDriver(wakingAfterAbort)
120   }
122   followup(input) { this.send(input, 'next-turn', true) }   // 用户消息：开新 turn，唤醒
126   steer(input)   { this.send(input, 'next-step', true) }   // 转向：插到下一步，唤醒
130   inject(input)  { this.send(input, 'next-step', false) }  // 注入上下文：插下一步，但不唤醒
134   cancel(cause, options = {}) { ... }                      // 取消：清 inbox + abort
```

🎯 **设计精华卡片 #2 — 三种"塞消息"的语义差别**
> | 入口 | 落点 | 是否唤醒 | 语义 |
> |---|---|---|---|
> | `followup` | next-turn | ✅ | 用户的新消息，开新回合 |
> | `steer` | next-step | ✅ | 紧急纠偏，塞进当前回合的下一步 |
> | `inject` | next-step | ❌ | 额外上下文（如 AGENTS.md 变更），**等下次自然唤醒**才被模型看到 |
>
> 这就是 AGENTS.md 里"Input reaches the driver through one inbox. Some messages wake it immediately; injected context waits."的精确实现。

🤔 **思考题**：第 116 行为什么要**在插入之前**就捕获 `wakingAfterAbort`？（注释 114–115：因为插入后一个 splice 观察器可能重入 cancel，重新分类这条消息。捕获在"事实发生之前"才能保证分类正确——典型的竞态防御。）

---

## 第四段：turn ——开回合、循环 step、关回合

`turn()` 是发动机的主轴。它**先 append `turn/start`，再循环执行 step，最后 append `turn/end`**：

> 📎 `packages/core/agent-loop/src/agent.ts:246`

```ts
246   private async turn(): Promise<boolean> {
253     const turn = phase.turn + 1
255     this.session.append('turn/start', { turn })              // ← 开回合（落日志！）
259     phase.turn = turn
263     while (true) {
264       signal.throwIfAborted()
265       const step = phase.step + 1
266       const decision = await this.preStep(target, { turn, step })   // ← pre-step 闸门
267       if (decision.kind === 'reject') return false            // ← 被插件拒绝 → turn blocked
274       if (phase.step === 0 && decision.messages.length === 0) ...   // ← 空首步：开回合但不花模型调用
279       this.session.append('step/start', { turn, step })       // ← 开步（落日志）
282       for (const message of decision.messages)
283         this.session.append('user/message', message, { surfaceOp: 'append' })
287       const stepEnd = await this.step(decision.assembly)      // ← 跑一步（见下一段）
295       if (turnEnds && this.inbox.nextStep.length === 0) {
296         await this.dispatch.serial('agent/turn-stopping', { turn, signal })  // ← 串行"要不要停"
299       if (turnEnds && this.inbox.nextStep.length === 0) break
300       target = 'next-step'
301     }
...
319     this.session.append('turn/end', { turn, reason: turnEnds! })   // ← 关回合（落日志）
324     if (!this.inbox.hasPending) return false                  // ← 没新输入 → 退出
325     phase.abort = new AbortController()                       // ← 还有输入 → 继续
328     phase.step = 0
329     return true
330   }
```

🎯 **设计精华卡片 #3 — turn/step 的落点完全镜像架构文档**
> 把这里和 `docs/architecture.md` 的 turn 流程图对照：
> ```
> turn/start → (认领+组装) → agent/pre-step → step/start → user/message
>   → step() → step/end → agent/turn-stopping → turn/end
> ```
> **每一个框都对应一次 `session.append`**。所以一份会话日志能完整重放出 turn/step 结构——这正是带读③"模型可见 ⟺ 已记录"的落地。

注意 295–299 的"停机判定"跑了**两次**：
- 先 `agent/turn-stopping`（**serial，没有 `next()`**）给插件"插话再走一步"的机会；
- 再判一次 `inbox.nextStep`——因为上一句 serial 里插件可能 `steer()` 塞了新消息进来。这种"判定—放行—再判定"是处理"边停边来消息"的标准范式。

---

## 第五段：step ——一次模型请求 + 它的工具调用

> 📎 `packages/core/agent-loop/src/agent.ts:332`

```ts
332   private async step(assembly): Promise<StepEndReason | null> {
337     const system = renderPrompt(assembly)
339     while (true) {
340       const { request, preparedCall } = await this.buildRequest(
341         turn, step, assembly.tools, system, this.session.deriveMessages(), signal,  // ← 日志投影喂模型
342       )
345       const stream = preparedCall?.stream(request) ?? this.loopCtx.llm.stream(request)
347       for await (const chunk of stream) {
349         chunkSeqs.push(this.session.append('assistant/chunk', { turn, step, chunk }).seq)  // ← 流式 chunk 落日志
350         assembler.push(chunk)
351       }
354       if (finish.kind === 'error' || finish.kind === 'aborted') {
355         const action = await this.dispatch.waterfall('agent/request-error', {...}, () => undefined)  // ← 错误恢复闸
367         if (action?.kind !== 'retry') throw new LlmError(...)
370         continue                              // ← retry → 重发本步
371       }
373       const message = createAssistantMessage({...})
381       this.session.append('assistant/message', { turn, step, message, usage },       // ← 整条消息落日志
389         { surfaceOp: 'append', sourceEventSeqs: chunkSeqs })                          // ← 派生自那些 chunk！
391       if (finish.kind === 'max-tokens') return { kind: 'max-tokens' }
393       const toolCalls = message.content.filter(b => b.type === 'tool-call')
394       if (toolCalls.length === 0) return { kind: 'completed' }                        // ← 没工具调用 → 本步完成
395       const { concluded } = await executeToolCalls(                                   // ← 执行工具（带读⑤）
396         this.loopCtx, turn, step, toolCalls, signal, ctx => this.inbox.splice('next-step', ...))
399       return concluded ? { kind: 'completed' } : null                                // ← 有工具调用 → 本步不结束，回 while
400     }
401   }
```

这一段把前三篇全部串起来了：
- **341 `deriveMessages()`**（带读③）：模型历史从日志投影。
- **349 / 381 append chunk & message**（带读③）：assistant 输出落日志；message 用 `sourceEventSeqs` 指向 chunk。
- **395 `executeToolCalls`**（带读②⑤）：工具调用走 `ctx.tools` 的策略管线。

🎯 **设计精华卡片 #4 — 三个 waterfall，三种拦截时机**
> 一个 step 里有三个可被插件拦截的 waterfall：
> - `agent/pre-step`（在 `preStep`，225 行）：**决定模型看到什么**——可改写消息、可 reject。
> - `agent/request`（在 `buildRequest`，438 行）：**改写请求配置**（provider/model/effort）。
> - `agent/request-error`（355 行）：**错误恢复**——可返回 `retry` 让本步重发。
> 加上 `agent/turn-stopping`（serial），构成了"不改 loop 就能拦截请求/工具/回合"的全部入口。

---

## 第六段：buildRequest ——请求配置的折叠与日志化

> 📎 `packages/core/agent-loop/src/agent.ts:407`

```ts
419   const persistedHeader = session.requestHeader()          // ← 从日志折叠出的"上次请求头"
438   const proposedConfig = await this.dispatch.waterfall(
439     'agent/request', { turn, step, signal }, () => Promise.resolve(seedConfig))   // ← 插件可改写
449   preparedCall = await this.loopCtx.llm.prepareCall(proposedConfig, signal)       // ← adapter 解析具体模型默认值
465   if (!this.requestHeaderLogged) {
466     this.session.append('request/header', { header, reason: 'initial'/'resume' })  // ← 首次落"请求头"
468   } else if (baseline === undefined || !headerEquals(baseline, header)) {
469     this.session.append('request/header', { header, reason: 'change' })           // ← 变了才再落
470   }
```

🎯 **设计精华卡片 #5 — 请求头也是日志事件**
> 连"用哪个 provider/model/system/tools"都写进日志（`request/header` 事件）。所以重放一个会话，不仅消息一致，**发给模型的请求结构**也一致——这是"可重放"做到极致的体现。只有"变了"才 append（468），避免日志膨胀。

🤔 **思考题**：`max-tokens` 被称为"sticky"（285–290 行注释）：一个 step 撞了 max-tokens，后续正常完成的 step 不能"降级"turn 的结果。为什么要这样设计？（提示：回合的最终原因应反映"最严重的"情况——撞长度上限比正常完成更值得被上游（如压缩策略）知道）

---

## 🧭 本篇小结 & 衔接下一站

皇冠戴上了。你现在能从"一条用户消息"一路追到"工具执行"，看到每一处 `session.append`、每一个 waterfall 闸门、每一次状态机迁移。

但第四段第 395 行 `executeToolCalls(...)` 我们一笔带过了——**多个工具调用是并发跑还是串行跑？中断时已启动的工具怎么办？跳过的工具要补结果吗？** 这些调度细节正是带读⑤的主题。

| 你在这里学到的 | 下一站将回答 |
|---|---|
| turn/step 的状态机与落点 | 一个 step 内多个 tool-call 的并发模型 |
| 三个 waterfall 拦截点 | "exclusive barrier" 与 "parallel pool" 如何分组 |
| `executeToolCalls` 的调用点 | 中断时为什么"已启动的要等完成、未启动的补合成结果" |

> 📎 完整源码：`packages/core/agent-loop/src/agent.ts`（497 行，强烈建议通读。配合 `docs/agent-lifecycle.md` 时序图服用）
