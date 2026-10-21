# 使用说明（DeepSeek 侧）

本文讲 **DeepSeek 主 Agent / 用户** 怎么用这四个工具，以及卡片上每一块是什么、怎么读。

> 参数名以 [contracts.md §3](contracts.md) 为准；卡片区域的具体渲染以插件实际行为为准。Gate 结论见 [Gate 状态](../README.md#gate-状态)。

---

## 0. 心智模型

```
你（DeepSeek 主 Agent）
   │  ① 判断值不值得问、问哪档   ← Skill: dsh-expert-routing
   │  ② 组织 Consultation Brief（问题/背景/证据/期望输出）
   ▼
consult_expert（单路）  或  consult_council（三路并行）
   │  ③ 本地脱敏 → 冻结共同快照 → 并发请求
   ▼
三份独立回答（专家建议，不是结论）
   │  ④ 你自己复算 / 测试 / 查文献验证
   ▼
verify_consultation 记录 ADOPTED / PARTIAL / NEEDS_MORE_EVIDENCE / REJECTED
   │  ⑤ 落到代码、测试、commit
```

**唯一的执行决策权在你手里。** 被咨询的模型不获得 Shell、仓库读写、Git、子 Agent 或部署权限，也不执行任何工具。

---

## 1. `consult_expert` —— 单路专家咨询

### 参数

| 参数 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `question` | ✅ | string | 整理后的中心问题（一个问题，不要打包多个） |
| `slot` | — | `'L1' \| 'L2' \| 'L3'` | 省略时按 `mode` / `risk` / `complexity` 自动路由 |
| `mode` | — | Mode | 默认 `general`，见 §5 |
| `reason` | — | string | 触发原因，UI 展示「为什么现在问」 |
| `context` | — | string | 最小必要上下文与项目约束 |
| `evidence` | — | string | 公式 / 日志 / 复现步骤 / commit |
| `requested_output` | — | string | 期望专家输出的结构 |
| `risk` | — | `'low' \| 'medium' \| 'high'` | 影响自动路由 |
| `complexity` | — | `'low' \| 'medium' \| 'high'` | 影响自动路由 |
| `privacy_scope` | — | string | 允许共享范围说明；命中「整个仓库 / 整个工作区 / 全部环境变量 / all files」等全量措辞时按策略拒绝（`DATA_APPROVAL_REQUIRED`） |

### 返回

工具结果里同时有：

1. **给模型看的 `render()` 文本** —— 状态、该档 modelId、完整回答正文、以及「外部模型回答不是最终结论」的提示；
2. **给 UI 的 `presentationMeta()`** —— 完整 `ConsultationMeta`（见 §4）。

### 最小可用调用

```json
{
  "question": "这段递归转迭代在缺少尾调用优化时会不会栈溢出？",
  "slot": "L2",
  "mode": "debug",
  "reason": "本地三种假设都没解释清楚为什么只在 10 万级输入崩溃。",
  "context": "Node.js 20，默认栈大小；函数自递归 3 层，无 trampoline。",
  "evidence": "RangeError: Maximum call stack size exceeded，栈回溯见下；输入 50000 正常，100000 崩溃。",
  "requested_output": "1) 是否必然溢出；2) 最可能的真实原因；3) 一个可本地验证的判定方法。"
}
```

---

## 2. `consult_council` —— 三路并行委员会

### 参数

| 参数 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `question` | ✅ | string | 归一化后的中心问题，**三路共用同一份** |
| `mode` | — | Mode | 同 §5 |
| `reason` | — | string | 触发原因 |
| `context` | — | string | 最小必要上下文 |
| `evidence` | — | string | 公式 / 日志 / 复现 |
| `requested_output` | — | string | 期望输出结构 |
| `slots` | — | `Array<'L1'\|'L2'\|'L3'>` | 默认 = 全部**已配置**档位 |

### 返回与状态

| 成功路数 | `status` | 你该怎么做 |
|---|---|---|
| 3/3 | `COMPLETE` | 三份都读，标出共识与冲突 |
| 1/3 或 2/3 | `PARTIAL` | 保留已有回答，**明确写出缺席档位**；不要当「三模型一致」 |
| 0/3 | `FAILED` | 逐档看失败原因，判断是配置问题还是服务问题 |

**关键约束：**

- 三路**互不可见** —— 首轮之间完全隔离，避免锚定与虚假共识。
- 三份回答**完整独立保存**，插件不会裁剪或合并覆盖原文。
- **不会自动改路由**：一档失败不会偷偷用别的档顶替。
- **不会自动重试全部**：可按同一问题快照单独重试失败档。
- 缺档时如实告知缺哪档；只有两档配置就用两档，不得静默模拟第三档。

---

## 3. `followup_expert` —— 追问

### 参数

| 参数 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `consultation_id` | ✅ | string | 来自上一轮结果，形如 `ec-<yyyymmddhhmmss>-<rand>` |
| `question` | ✅ | string | 新的追问 |
| `slot` | — | SlotId | 默认沿用原咨询的档位 |
| `mode` | — | Mode | 同 §5 |

### 代价与边界

- **额外计费**：追问是新的 API 调用，不是免费续写。
- **第二轮不再独立**：模型已经看到自己上一轮的回答，会自我强化；结论不能与首轮同权。
- **上下文来源**：来自**本次会话内**该咨询的记录。会话/插件重启后不可依赖。
- 不要把隐藏思维链、密钥、完整私有仓库放进追问。
- 默认**不开启**三路交叉辩论；要做必须显式选择，并记录「第二轮不再独立」。

---

## 4. `verify_consultation` —— 记录验证结论

### 参数

| 参数 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `consultation_id` | ✅ | string | 目标咨询 |
| `verdict` | ✅ | `ADOPTED` \| `PARTIAL` \| `NEEDS_MORE_EVIDENCE` \| `REJECTED` | 判定 |
| `notes` | ✅ | string | 依据：哪部分成立、哪部分不成立 |
| `slot` | — | SlotId | 单档判定时指定 |
| `evidence` | — | string | 测试路径、算例、commit、文献 |

判定写回该咨询的 `synthesis.decision`，卡片上可见，形成决策闭环。

| verdict | 语义 |
|---|---|
| `ADOPTED` | 已被独立证据复现/证明，可采纳 |
| `PARTIAL` | 部分成立，或仅在限定范围成立 |
| `NEEDS_MORE_EVIDENCE` | 方向可信但证据不足 |
| `REJECTED` | 与本地证据/已知结论冲突，不采纳 |

**没有充分证据就写 `NEEDS_MORE_EVIDENCE`，不要写 `ADOPTED`。** 三个模型都同意不等于事实正确。

---

## 5. `mode` 取值

| mode | 用在 |
|---|---|
| `math_review` | 公式、推导、量纲、收敛性、数值方法 |
| `physics_review` | 控制方程、本构、边界条件、物理一致性 |
| `debug` | 定位根因、解释异常现象 |
| `architecture` | 架构改造、模块边界、可逆性 |
| `research` | 技术路线、方法对比、文献方向 |
| `alternative_approach` | 需要跳出固定思路的替代方案 |
| `general` | 其他（默认） |

`mode` 决定提示词的侧重，也会参与自动路由。不要用 `general` 掩盖问题其实是数学审查的事实。

### 5.1 自动路由的实际规则（省略 `slot` 时）

`risk` / `complexity` 缺省按 `medium` 处理：

| 条件 | 路由到 |
|---|---|
| `mode` 是 `math_review` / `physics_review` 且 `risk` 或 `complexity` 为 `high` | **L1** |
| `mode` 是 `math_review` / `physics_review`（其余情况） | **L2** |
| `risk: high` 且 `complexity: high` | **L1** |
| `complexity: high` 或 `risk: high`（非同时） | **L2** |
| `risk: low` 且 `complexity: low` | **L3** |
| 其余 | `defaults.singleSlot`（默认 `L2`） |

这是启发式，**可以被显式 `slot` 覆盖**。知道该用哪档时直接写 `slot`，让结果可预期。

### 5.2 专家实际收到的系统指令

每档收到同一段系统指令，明确三件事（你不需要自己再强调）：

1. 你是外部专家顾问，调用方保留全部执行权，你不能运行命令、读文件、改项目；
2. 你的输出是**建议性证据**，不是权威结论；要区分「知道」和「推断」；
3. 不要声称执行过代码或访问过仓库；不知道就说不知道。

此外，`math_review` / `physics_review` 会追加**量纲分析、变量定义与符号约定、逐步推导、适用范围与失效模式、可证伪测试**的输出结构要求；其他 mode 使用通用结构（结论 / 关键推理与假设 / 不确定点 / 可执行验证）。

这也是为什么 §4.2 的证据要求有效：结构已经内置，你只要把料备齐。

---

## 6. 卡片区域怎么读

### 6.1 单路卡片（`Expert Consultation`）

| 区域 | 内容 |
|---|---|
| 头部 | 发起者（主 Agent / 子 Agent）、Mode、Slot、`status`（`COMPLETE`/`PARTIAL`/`FAILED`/`CANCELLED`）、耗时 |
| 目标 | `protocol`、`providerLabel`、`modelId`、`endpointHost`（只有 host，不含 path/query） |
| **实际发送** | 脱敏后的 `system` + `user` 正文、`hash`、`bytes` —— 这是**真正发出去的内容**，不是发送前的草稿 |
| 回答 | 完整可展示正文（`answer` / `blocks`）；`thinking` 类块不作为正文 |
| 状态行 | 每档 `status`、`attempts`、`durationMs`、`requestId`、`finishReason` |
| 用量 | `inputTokens` / `outputTokens` / `totalTokens` / `cacheReadTokens` / `reasoningTokens`，缺失为 `unknown` |
| 费用 | `estimatedUsd` + `source`（`provider` / `estimated` / `unknown`） |
| 隐私 | `redactions`（脱敏次数）、`appliedRules`（命中的规则）、`externalBytes`、`truncated` |
| 诊断 | `configRevision`、`notes`、`capabilities`（`nonStream`/`usage`/`systemPrompt`/`reasoning`/`tools`） |

### 6.2 三路卡片（`Expert Council`）

| 区域 | 内容 |
|---|---|
| 顶部 | `Expert Council · L1 / L2 / L3`、真实状态（如 `2/3 returned`）、费用汇总、可展开的**共同问题快照** |
| 中间 | L1 / L2 / L3 三个**并列面板**（窄屏为标签切换）：各自 Model ID、发送内容、完整回答、错误、复制、单独重试 |
| 下方 `Council Synthesis` | 机械聚合区：`overlap`（词面重合项 + 出现在哪几档）、`uniqueBySlot`（各档独有项）、`answerLengths`、固定提示 `note`、以及你的 `decision`（来自 `verify_consultation`） |

**`overlap` 只是词面机械聚合，不是语义结论。** 它按 token 匹配数字、标识符、公式片段，只能说「这几档都提到了 `1e-3`」，**不能说**「它们结论一致」。`note` 字段就是这句提醒的固定文案。

三个面板**不得互相覆盖**；某档失败时面板保留错误与失败原因，不会用别的档填空。

### 6.3 状态字段含义

| 字段 | 取值 |
|---|---|
| 咨询级 `status` | `COMPLETE` / `PARTIAL` / `FAILED` / `CANCELLED` |
| 单档 `status` | `SUCCESS` / `ERROR` / `TIMEOUT` / `CANCELLED` / `UNCONFIGURED` / `DISABLED` / `NOT_REQUESTED` |
| `synthesis.counts` | `{ success, requested }` |

---

## 7. 复制与回放

### 7.1 复制

- **复制单个回答**：打开对应面板的复制按钮，得到该档完整正文（不裁剪）。
- **复制三路对比报告**：得到三份回答 + 机械聚合摘要，适合贴进 issue/文档。
- 复制的是**已脱敏的可展示正文**，不含密钥、不含隐藏思维链。

### 7.2 回放

- 权威记录是会话日志里的 `tool/call` + `tool/result`；历史回放**直接由会话事件重放渲染**。另有 `$DSH_HOME/expert-council/index.json` 本地索引（上限 200 条、只存脱敏文本），仅用于重启后按 `consultation_id` 追问与记录验证判定，详见 [已知限制 §6.1](known-limitations.md)。
- 所以：恢复会话后，卡片按当时的事件重新渲染，显示的是**当时实际发送与收到的内容**。
- 回放不会重新发请求，**不产生新费用**。
- 需要重复一次评审时，用新的调用（可复用同一份 `question`/`context`/`evidence` 快照），而不是指望回放触发调用。

---

## 8. 怎么读 `unknown` 用量

Provider 不总是返回 token 用量。插件遵守一条硬规则：**缺失字段一律 `null`，禁止写 0**。

| 你看到的 | 含义 | 你该怎么做 |
|---|---|---|
| `inputTokens: null` | 该 Provider 没返回输入 token | 不要当成 0 成本；按字符数或厂商账单核对 |
| `totalTokens: null` | 没返回总计 | 同上 |
| `cost.source: 'unknown'` | 费用无法确定 | 在成本记录里标「未知」，不要估算成具体数字 |
| `cost.source: 'estimated'` | 按 `pricing` 单价 × 已知 token 估算 | 明确标注「估算」，与厂商账单可能不同 |
| `cost.source: 'provider'` | 厂商直接给出 | 最可信，仍以账单为准 |
| `usageAvailable: false`（连接测试） | 该服务不提供 usage | 该档的成本只能人工核对 |

**不要把 `unknown` 说成「免费」或「0 成本」。** 也不要把 `estimated` 说成精确值。

---

## 9. 常见使用错误

| 错误 | 后果 | 正确做法 |
|---|---|---|
| 用 `consult_council` 问一个简单语法问题 | 白付三份费用 | 先本地修；不值得咨询就不咨询 |
| 三档配了同一个模型，却当三个独立来源 | 虚假独立性 | 结论里注明「三档同模型，不构成独立验证」 |
| 把专家回答直接当结论提交 | 可能引入错误 | 必须 `verify_consultation` + 独立证据 |
| `privacy_scope: "full"` 想发整个仓库 | 不会被拦（短语级门禁只认具体措辞） | 只发最小必要片段，写清范围；**不要依赖门禁** |
| `consultation_id` 自己编造 | 追问失败 | 从上一轮结果里复制 |
| 把 `PARTIAL` 写成「三模型一致」 | 误导决策 | 如实写明缺席档位 |
| 把 `unknown` 用量写成 0 | 成本失真 | 标 `unknown` |
| 用追问代替首轮独立咨询 | 第二轮已不独立 | 需要独立视角就重新发起 `consult_council` |
