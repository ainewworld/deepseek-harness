# 带读 ③ 会话日志：唯一真相源 `core/session`

> 带读②末尾留了一个问题："工具结果、assistant 消息、turn/step 边界被写到了哪里？模型的历史从哪里读出来？" 答案全在**会话日志**。
>
> `core/session`（`ctx.sessions`）是 dsh 最具"骨架感"的包：它**不调用模型、不执行工具**，却是一切的上游——fork / resume / 转录 / 遥测 / 持久化 / 模型历史，全部派生自它。读懂它，你就懂了 dsh 为什么能把"可重放"做到极致。

---

## 📌 文件定位

`packages/core/session/src/index.ts`（1157 行）
定义 `Session` 类（追加日志 + 派生消息）和 `SessionStore` 服务（`ctx.sessions`，管理多个 Session 的生命周期）。配套 `surface.ts`（有序表面）、`request-header.ts`（请求头折叠）。

---

## 第一段：Session 就是一条追加日志

> 📎 `packages/core/session/src/index.ts:425`

```ts
425   export class Session {
426     private log: SessionEvent[] = []                      // ← 唯一的真相：追加式事件数组
427     /** Single incremental owner of surface acceptance and projection state. */
428     private readonly surfaceManager = new SurfaceManager(this.log)
...
443     readonly header: SessionHeader                          // ← 创建元数据（格式版本/cwd/血缘）
...
472     readonly firstLiveSeq: number                          // ← 本进程第一条"鲜活"事件的下标
```

🎯 **设计精华卡片 #1 — seq = log.length，连续性契约**
> 第 564–567 行：`get seq() { return this.log.length }`。每条事件的 `seq` 永远等于它进入日志时数组的长度。这个"从 0 连续"的契约，是整个系统重放、fork、投影的根基——构造时就会校验种子事件 `seq` 必须从 0 连续（见 525–527）。

🤔 **思考题**：为什么 `log` 是 `private`，对外只暴露 `events`（一个冻结快照）？（提示：防止任何代码"改历史"——日志一旦写入就不可变）

---

## 第二段：append ——写日志的"热路径"绝不阻塞 I/O

`append` 是整个系统最高频的写入。它的 JSDoc（569–603）本身就是一份契约文档，值得逐句读。核心实现：

> 📎 `packages/core/session/src/index.ts:604`

```ts
604   append<T extends SessionEventType>(
605     type: T,
606     data: SessionEventMap[T],
607     ...opts: T extends SurfaceEventType ? [opts: SurfaceIntent] : []   // ← 编译期区分"表面事件"
608   ): SessionEvent<T> {
614     const dataSnapshot = snapshotJsonValue(data)            // ← 一次递归：读+校验+深拷贝 JSON
615     if (dataSnapshot === undefined)
616       throw new Error(`session event "${type}" carries non-JSON-serializable data`)
618     assertSupportedRequestHeader(type, dataSnapshot, ...)
623     const entry = attachments.get(this)
624     if (entry?.appending)
625       throw new Error('session append cannot reenter while another append is being published')
627     const event = deepFreeze({ type, ... })                 // ← 深冻结，返回的是快照而非调用方的可变入参
```

逐行提炼三条不变量：
1. **614 `snapshotJsonValue`**：一次递归同时完成"读取 + 校验可序列化 + 深拷贝"。注释（596–598）点明意图——"一个有状态的 getter 无法给校验一份值、给存储另一份值"。BigInt / symbol / 函数 / 循环引用 / Date 实例全部在这里被拒。
2. **624–625 防重入**：一次 append 发布期间不允许重入。避免监听器里再 append 造成状态撕裂。
3. **627 `deepFreeze`**：返回的事件是冻结快照。调用方之后改自己的 `data` 对象，不会影响已落盘的历史。

🎯 **设计精华卡片 #2 — 热路径不阻塞 I/O**
> 第 572 行注释明说："The hot path never blocks on I/O — persistence plugins buffer asynchronously." `append` 同步把事件写进内存日志并通知监听器；持久化（JSONL/SQLite）是**异步 buffer** 的下游插件。一旦事件进入 `log`，本次 append 就**已提交**——单个监听器失败不会改变返回值、不会阻断其它监听器。

---

## 第三段：表面事件——为什么有的 append 要带 `surfaceOp`

注意第 607 行那个条件类型：`T extends SurfaceEventType ? [opts: SurfaceIntent] : []`。

- **非表面事件**（`turn/start`、`step/end`、`assistant/chunk`、`todo/write`…）：只是"发生过的事实"，**编译器禁止**你传 `opts`。
- **表面事件**（`user/message`、`assistant/message`、`tool/result`…）：会**产生模型可见的消息**，必须声明它"如何加入有序表面"——`surfaceOp: 'append' | 'replace'`、`sourceEventSeqs`（它派生自哪几条更早的事件，如 chunk→message、call→result）。

这就是 dsh 最著名不变量的**编译期 + 运行期双重保障**：

🎯 **设计精华卡片 #3 — 模型可见 ⟺ 已记录（Model-visible ⟺ logged）**
> 任何到达模型请求的东西，必须能从日志重建。因此：**新增一种"模型可见的输入"，必须新增一个 session 事件**（扩展 `SessionEventMap` 并从日志渲染）。带读①里 `todo_write` 往日志写 `todo/write`、带读②里 `tool/result` 携带 `sourceEventSeqs`——都是这条不变量的具体体现。

🤔 **思考题**：`assistant/message` 为什么必须带 `sourceEventSeqs` 指向那些 `assistant/chunk`？（提示：fork/重放时要重建消息；chunk 同时保留"流式 UI 保真"。一个事件派生自哪些事件，是日志自描述的）

---

## 第四段：deriveMessages ——从日志投影出模型历史

> 📎 `packages/core/session/src/index.ts:726`

```ts
726   deriveMessages(): Message[] {
727     const surface = this.surface
728     const nodes = surface.nodes                 // ← 表面给出的"消息产生型事件"的有序 seq 列表
729     const generation = surface.replaceGeneration
730     if (generation !== this.derivedGeneration) {  // ← 表面发生过 replace，缓存失效
731       this.derived = []
732       this.derivedNodes = 0
733       this.derivedGeneration = generation
734     }
735     for (const seq of nodes.slice(this.derivedNodes)) {   // ← 增量：只处理新增节点
739       const msg = this.deriveEventMessage(this.log[seq]!)
743       if (msg) this.derived.push(msg)            // ← 空内容的 assistant/message（max-tokens 步）派生为 null，丢弃
745     this.derivedNodes = nodes.length
746     return [...this.derived]
747   }
```

模型每次请求拿到的 `messages`，就是这条函数的返回值。它体现了一个关键设计：

🎯 **设计精华卡片 #4 — 日志是源头，消息是投影**
> `deriveMessages()` 不是"另一份存储"，而是把**日志事件**投影成**模型消息数组**。所以编辑历史（fork、replace、裁剪）只需要操作日志，模型历史自动跟随。带读④你会看到 agent-loop 每一步都调 `this.session.deriveMessages()` 喂给 LLM。
>
> 第 730–734 的"generation 缓存失效"机制：当某条消息被 `replace`（比如用户编辑了一条旧消息），整个派生缓存清空重算——保证一致性。

---

## 第五段：SessionStore 与 fork ——可派生的血缘

> 📎 `packages/core/session/src/index.ts:792`（`SessionStore` 服务）/ `:1081`（`fork`）

`ctx.sessions` 是 `SessionStore`（一个 Cordis `Service`），负责 `create / fork / resume` 和发布 `session/event` 广播。其中 `fork(source, boundary?, childId?)` 从一个**已有会话的日志前缀**克隆出新会话——boundary 指定切到哪条 seq 之前。

🎯 **设计精华卡片 #5 — 一切皆派生**
> fork / resume / 转录 / 遥测 / 持久化，全部是日志的**下游消费者**，不是平行存储。这就是为什么 dsh 能做到：换一个持久化后端（JSONL ↔ SQLite）零行为差异；重放一条历史会话，UI/工具/模型看到的完全一致。

---

## 🧭 本篇小结 & 衔接下一站

你现在已经站在了 dsh 的"地基"上：一条追加日志，向上投影出模型历史，向下派生出持久化/遥测/分叉。

但**谁来驱动**这条日志的写入？谁来决定"现在开一个 turn""现在发一次模型请求""现在执行工具"？这就是**主循环 agent-loop** 的职责——它是把工具（带读①②）和日志（本篇）串起来的发动机，也是整个系列的皇冠。

| 你在这里学到的 | 下一站（皇冠）将回答 |
|---|---|
| append 热路径 + 深冻结 + 防重入 | 主循环在哪几个时机 append `turn/start` / `step/start` |
| 表面事件 vs 非表面事件 | 为什么 `assistant/message` 要带 `sourceEventSeqs` |
| deriveMessages 投影模型历史 | 主循环每步如何把投影喂给 `llm.stream` |

> 📎 完整源码：`packages/core/session/src/index.ts`（重点读 425–548 构造、559–660 events/append、726–747 deriveMessages）
