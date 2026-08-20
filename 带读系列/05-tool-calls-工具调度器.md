# 带读 ⑤ 工具调度器：`agent-loop/tool-calls`

> 带读④第 395 行把 `executeToolCalls(...)` 留给了本篇。一个 step 里模型可能**一次返回多个工具调用**：它们是并发跑还是排队跑？跑到一半被取消怎么办？结果按什么顺序写回日志？这些"并发 + 顺序 + 取消"的难题，全在这个 290 行的文件里解决。
>
> 它是皇冠的"变速箱"——读懂它，你才真正理解 dsh 在"性能"和"可重放"之间如何兼得。

---

## 📌 文件定位

`packages/core/agent-loop/src/tool-calls.ts`（290 行）
只导出一个函数 `executeToolCalls`，被 `agent.ts` 的 `step()` 调用。

---

## 第一段：按"并发模式"把工具调用切成组

> 📎 `packages/core/agent-loop/src/tool-calls.ts:59`

```ts
59  export async function executeToolCalls(ctx, turn, step, toolCalls, signal, acceptContext) {
67    const agent = ctx.agents.requireInitiator()              // ← 取当前 driver 的 agent
71    const planned: PlannedCall[] = toolCalls.map(block => ({  // ← 解析每个 tool-call 的入参
72      block,
73      exec: { callId: block.id, name: block.name, arguments: parseArguments(block.arguments), agent, signal },
74    }))
82    let next = 0
84    while (next < planned.length) {
87      const first = planned[next]
88      const mode = ctx.tools.executionMode(first.exec).kind   // ← 问注册表：这个工具的并发模式？
89      const group = mode === 'parallel' ? planned.slice(next) : [first]  // ← parallel：后续全进一组；独占：自己一组
90      const outcome = await runGroup(ctx, turn, step, group, mode, signal, acceptContext)
93      next += outcome.consumed
94      concluded ||= outcome.concluded
95      if (outcome.aborted) {                                  // ← 本组被中断：剩余全部补"跳过"结果
96        for (const call of planned.slice(next)) appendSkippedToolCall(session, turn, step, call.block)
97        return { concluded }
98      }
99    }
101   return { concluded }
102   }
```

🎯 **设计精华卡片 #1 — 两种并发模式 + barrier 语义**
> 每个工具声明自己是 `parallel`（可与其他并发）还是独占（exclusive）。
> - **parallel 工具**：和它后面连续的 parallel 工具组成一个**并发池**，一起跑；
> - **独占工具**：自己一组，是一道 **barrier（屏障）**——必须等它（及之前的池）全部完成，才看后面的。
>
> 这就是文件头注释（1–4 行）说的"Exclusive calls form barriers; parallel calls use a bounded rolling pool"。

---

## 第二段：runGroup ——并发池的核心循环

这是全文最精巧的部分。三个指针 + 两条约束：**调度可重叠，但结果和上下文必须按模型顺序提交**。

> 📎 `packages/core/agent-loop/src/tool-calls.ts:121`

```ts
132   const slots: (Slot | undefined)[] = group.map(() => undefined)  // ← 每个 call 的"已派发结果"槽
134   const callSeqs: number[] = group.map(() => -1)                  // ← 每个 call 的 tool/call 事件 seq
135   let nextToStart = 0   // ← 下一个待启动
136   let committed = 0     // ← 下一个待"按序提交"（写 tool/result）
137   let started = 0       // ← 已启动数
```

**提交就绪（commitReady）——只提交"连续的已完成槽"：**

> 📎 `packages/core/agent-loop/src/tool-calls.ts:146`

```ts
146   const commitReady = async () => {
147     while (committed < group.length) {
148       const slot = slots[committed]
149       if (slot === undefined) break                    // ← 前面还有没完成的，停下（保证顺序）
151       const result = slot.needsPost
152         ? await ctx.tools[TOOL_RUNTIME_SCHEDULER].finalize(...)   // ← 走 post-execute
153         : ctx.tools[TOOL_RUNTIME_SCHEDULER].finish(...)           // ← 直接定稿
155       appendToolResult(session, turn, step, call.block, result, callSeqs[committed])  // ← 按序写日志
156       for (const context of result.additionalContexts ?? []) acceptContext(context)   // ← 工具返回的额外上下文
157       concluded ||= result.concludesTurn === true
158       committed++
159     }
160   }
```

🎯 **设计精华卡片 #2 — 调度乱序，提交有序**
> 工具**派发（dispatch）可以重叠并发**（163–183 的 `startCall` 用 Promise 并发）；但**写回 `tool/result` 严格按模型给出的顺序**（`committed` 只在 `slots[committed]` 就绪时才前进）。
>
> 为什么？因为模型把 tool/result 当作"我按这个顺序发的调用，就该按这个顺序看到结果"。日志顺序 = 模型顺序，重放才一致。**性能（并发）和正确性（有序）在这里被解耦。**

---

## 第三段：启动一个调用——prepare 的三种结局

> 📎 `packages/core/agent-loop/src/tool-calls.ts:164`

```ts
164   const startCall = async (index) => {
167     callSeqs[index] = appendToolCall(session, turn, step, call.block)   // ← 先落 tool/call，拿到 seq
169     const prepared = await ctx.tools[TOOL_RUNTIME_SCHEDULER].prepare(call.exec)  // ← 走 pre-execute/guard 闸（带读②）
171     switch (prepared.kind) {
172       case 'dispatch': {                            // ← 放行 → 真正并发派发 body
173         const promise = ctx.tools[...].dispatch(prepared.exec).then(outcome => {
175           slots[index] = { exec, result: outcome.result, needsPost: outcome.kind === 'post-result' }
176           return index
177         }, ...)
183         inFlight.set(index, promise)
184         break
185       }
186       case 'post-result':                           // ← 被 pre-execute/guard 否决 → 直接有结果（错误结果）
187         slots[index] = { exec, result: prepared.result, needsPost: true }
188         break
189       case 'final-result':                          // ← 已是冻结终态 → 无需 post-execute
190         slots[index] = { exec, result: prepared.result, needsPost: false }
192       default: assertNever(prepared, ...)           // ← 封闭 union 收尾
194     }
196   }
```

这里 `prepare` 就是带读②的 `prepareExecution`：**pre-execute 策略 → guard 不变量**。被否决的工具不会进入 `dispatch`，而是直接变成一个错误 `result` 落进 `slots[index]`——**它仍然会按序被 `commitReady` 写成 `tool/result`**。模型会看到一个"调用→错误结果"的完整对，重放也成立。

🤔 **思考题**：第 167 行为什么**先** `appendToolCall`（写 `tool/call` 事件）**再** prepare？能不能反过来？（提示：`tool/result` 要用 `sourceEventSeqs` 引用 `tool/call` 的 seq；如果先 prepare 再写 call，一个被否决的结果可能找不到对应 call 事件，破坏"call/result 配对"不变量）

---

## 第四段：中断时——已启动的等完成，未启动的补合成结果

> 📎 `packages/core/agent-loop/src/tool-calls.ts:237`

```ts
237   if (aborted) {
240     for (const call of group.slice(started)) appendSkippedToolCall(session, turn, step, call.block)  // ← 未启动的：补"跳过"结果
241     return { consumed: group.length, aborted: true, concluded }
242   }
```

配合 `appendSkippedToolCall`：

> 📎 `packages/core/agent-loop/src/tool-calls.ts:249`

```ts
249   function appendSkippedToolCall(session, turn, step, block) {
250     const callSeq = appendToolCall(session, turn, step, block)          // ← 补一个 tool/call
251     appendToolResult(session, turn, step, block, {
252       content: [{ type: 'text', text: 'Error: tool call aborted before dispatch' }],
253       isError: true,
254       error: { message: 'tool call aborted before dispatch', info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH } },
255     }, callSeq)                                                         // ← 再补一个错误 tool/result
256   }
```

🎯 **设计精华卡片 #3 — 中断不能破坏重放**
> 这是最容易被忽略、却最体现工程功力的一处。取消发生时：
> - **已启动（started）的调用**：仍然 `await` 它们到 quiescence，结果按序提交（见 220–230 主循环）。**绝不丢弃在途工作。**
> - **未启动的调用**：为它**合成**一对 `tool/call` + 错误 `tool/result`。
>
> 为什么这么麻烦？因为模型那次回复里**声明了 N 个 tool-call**，日志里就必须有 N 个 call 和 N 个 result 配对——否则重放时"模型的 tool-call 块"会找不到对应 result，消息投影就会断裂。**性能归性能，日志完整性是铁律。**

---

## 第五段：填池——有界滚动并发

> 📎 `packages/core/agent-loop/src/tool-calls.ts:198`

```ts
198   const fillPool = async () => {
199     while (!aborted && nextToStart < group.length && inFlight.size < maxParallelToolCalls) {  // ← 有界上限
202       const nextCall = group[nextToStart]
203       if (nextToStart > 0 && mode === 'parallel'
204         && ctx.tools.executionMode(nextCall.exec).kind !== 'parallel') break                  // ← 遇到独占工具 → 停
205       await startCall(nextCall)
206       nextToStart++
208       await commitReady()
211       if (signal.aborted) aborted = true
212     }
213   }
```

- **199 `inFlight.size < maxParallelToolCalls`**：并发上限来自 agent-loop 配置（spine-demo 里 `maxParallelToolCalls`，默认值）。
- **203–204**：填池时**重新读**每个后续工具的并发模式——因为"有序提交可能改变了注册表状态"，一个本来 parallel 的工具可能在新状态下变成独占，那就停下，留给外层 `executeToolCalls` 开新 barrier。

---

## 🧭 本篇小结 & 衔接下一站

你现在补齐了"工具执行"的全部细节：**分组（barrier/pool）→ 并发派发 → 有序提交 → 中断保全**。整个"消息如何流过系统"的链路，到这里已经完整闭合。

最后一站（带读⑥）换个视角——**这一切是怎么被"装配"成一个可运行 agent 的？** `agent-spine-demo` 把 LLM、会话、工具、循环、技能、目标…几十个插件 bundle 成一个骨架；而 `cordis.yml` 决定挂哪些 provider。看懂它，你就具备了"自己组装一个 agent"的能力。

| 你在这里学到的 | 下一站将回答 |
|---|---|
| 工具并发模型（barrier/pool） | 一个 agent 由哪些插件构成、谁挂谁 |
| 中断不破坏重放 | `ctx.plugin(...)` 的装配顺序为何"无关紧要却又有可读性" |
| `prepare` 三态对接 pre-execute/guard | `cordis.yml` 一行行换 provider 如何影响整个执行世界 |

> 📎 完整源码：`packages/core/agent-loop/src/tool-calls.ts`（290 行，建议通读；配合带读②的管线理解 `prepare/dispatch/finalize/finish` 四个调度器方法）
