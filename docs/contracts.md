# dsh-expert-council — 内部接口契约（实现基线 v1）

本文件是各模块并行开发的唯一契约来源。任何实现与本文不一致时，先改契约、再改实现。

## 0. 环境事实（D0 已核实，2026-10-20）

| 事实 | 结论 |
|---|---|
| Harness 版本 | `0.2.1-rc.2`（Desktop，profile `desktop`） |
| 安装位置 | `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\app.asar\dsh` |
| 插件机制 | profile bundle：`package.json` 的 `dsh.bundle.patch` → `cordis.patch.yml` 插入 Loader 行；`plugin_manager install_bundle` 安装 |
| Host 入口 | `export function apply(ctx, config)`；**禁止任何 bare import**（实测 `ERR_MODULE_NOT_FOUND`：插件目录无法解析 `@deepseek-ai/*`）。只允许相对路径 import 与 Node 内建模块（`node:*`） |
| Client 入口 | `dsh.client` + `exports["./client"]`，产物格式 `window.__ModuleLoader__.load({ id, factory: (require) => ... })`；`require('react')` 由宿主模块表提供 |
| 工具注册 | `ctx.tools.register({ name, description, parameters, output: { schema, render, presentationMeta }, execute, isConcurrencySafe })`；`parameters` 为 JSON Schema 子集 |
| 工具卡片 | 客户端 keyed slot `tool.call.toolview`，key = wire tool 名；props: `{ callId, toolName, phase: 'preparing'|'start'|'result', block, cwd?, home?, useDisclosure, openFile, inspect? }` |
| 结果结构 | `result` 阶段 `block` = `{ callId, call: { name, argsRaw, args }, content: ContentBlock[], isError, meta, subCalls, parentCallId? }`；`meta` 即 `presentationMeta(args, value)` 的返回值 |
| 设置服务 | `ctx.settings`（表单只暴露 `.volatile()` 字段，需 schemastery，本插件不可用）→ 采用自建 `settings.section` 页面 + `ctx.configEditor` 持久化 |
| 配置编辑 | `ctx.configEditor.entries()` / `edit(entry, change)`：按 Loader 正常路径持久化 raw config |
| 凭证 | `ctx.credentials.resolve(ref)` / `describe(ref)` / `set(ref, value)` / `unset(ref)`；`ref` 为 `CredentialRef`（字符串品牌），解析顺序：托管存储 → 环境变量 → `.env` |
| HTTP | `ctx.webServer.register({ kind: 'prefix'|'exact', path, handler(req,res) })` |
| Skill | `<DSH_HOME>/skills/<name>/SKILL.md`（`dsh-skill-filesystem`，rank 400 `user-dsh`），frontmatter 必填 `name`、`description` |
| 会话日志 | `tool/call` + `tool/result` 是权威记录；历史回放直接由会话事件重放渲染。另有 `ConsultationStore`（`$DSH_HOME/expert-council/index.json`，上限 200 条，只存脱敏文本）作为**本地索引**，用于重启后按 `consultationId` 追问与记录验证判定；它不是审计权威，可随时删除 |

## 1. 数据模型（`presentationMeta` 结构，version 1）

```ts
type ConsultationMeta = {
  version: 1
  kind: 'single' | 'council'
  consultationId: string            // 'ec-<yyyymmddhhmmss>-<rand>'
  groupId?: string                  // council: 与 consultationId 相同，便于将来多轮
  createdAt: string                 // ISO-8601
  durationMs: number
  status: 'COMPLETE' | 'PARTIAL' | 'FAILED' | 'CANCELLED'
  mode: 'math_review' | 'physics_review' | 'debug' | 'architecture' | 'research' | 'alternative_approach' | 'general'
  reason: string
  requestedOutput?: string
  requester: { agentId?: string, sessionId?: string, tool: string }
  routing: { requestedSlot?: SlotId, autoRouted: boolean, policy: string }
  privacy: {
    redactions: number
    appliedRules: string[]          // 命中的脱敏规则 id
    externalBytes: number           // 实际外发正文字节数
    truncated: boolean
  }
  question: {
    normalized: string              // 语义归一化后的问题（三路共用快照）
    context?: string
    evidence?: string
    hash: string                    // sha256(question.normalized + context + evidence)
  }
  slots: SlotResultMeta[]
  synthesis?: CouncilSynthesisMeta
  diagnostics: { configRevision?: string, notes: string[] }
}

type SlotId = 'L1' | 'L2' | 'L3'

type SlotResultMeta = {
  slot: SlotId
  displayName: string
  protocol: 'openai_chat_completions' | 'anthropic_messages'
  providerLabel: string
  endpointHost: string              // 仅 host，不含 path/query
  modelId: string
  status: 'SUCCESS' | 'ERROR' | 'TIMEOUT' | 'CANCELLED' | 'UNCONFIGURED' | 'DISABLED' | 'NOT_REQUESTED'
  error?: {
    category: ErrorCategory
    message: string                 // 已脱敏
    httpStatus?: number
    providerCode?: string
    requestId?: string
    retryable?: boolean
  }
  requestId?: string
  startedAt: string
  durationMs: number
  attempts: number
  usage: UsageMeta                 // 缺失字段一律 null（unknown），禁止写 0
  cost: { estimatedUsd: number | null, source: 'provider' | 'estimated' | 'unknown' }
  finishReason?: string            // 'stop' | 'max_tokens' | 'tool_use' | ...
  answer?: string                  // 完整可展示正文（已脱敏）
  blocks?: Array<{ type: 'text' | 'reasoning-summary', text: string }>
  requestSent?: {
    system?: string
    user: string                   // 实际发送的脱敏正文
    hash: string
    bytes: number
  }
  capabilities: Record<string, boolean | null>   // nonStream, usage, systemPrompt, reasoning, tools
  redactionDiff?: { originalBytes: number, sentBytes: number, rules: string[] }
}

type UsageMeta = {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  cacheReadTokens: number | null
  reasoningTokens: number | null
}

type CouncilSynthesisMeta = {
  requested: SlotId[]
  succeeded: SlotId[]
  failed: SlotId[]
  absent: SlotId[]                 // 未配置 / 未启用 / 未请求
  counts: { success: number, requested: number }
  // 机械聚合，不是语义结论：
  overlap: Array<{ token: string, kind: 'number' | 'identifier' | 'formula', slots: SlotId[] }>
  uniqueBySlot: Array<{ slot: SlotId, items: string[] }>
  answerLengths: Array<{ slot: SlotId, chars: number }>
  note: string                     // 固定文案：机械词面重合，不代表事实一致，需主 Agent 独立验证
  decision?: { verdict: VerificationVerdict, notes: string, at: string }   // 由 verify_consultation 追加
}

type VerificationVerdict = 'ADOPTED' | 'PARTIAL' | 'NEEDS_MORE_EVIDENCE' | 'REJECTED'

type ErrorCategory =
  | 'SLOT_UNCONFIGURED' | 'SLOT_DISABLED' | 'AUTH_REQUIRED' | 'AUTH_INVALID'
  | 'ENDPOINT_NOT_ALLOWED' | 'INVALID_ENDPOINT' | 'MODEL_UNAVAILABLE'
  | 'CAPABILITY_UNSUPPORTED' | 'RATE_LIMITED' | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_ERROR' | 'BAD_RESPONSE' | 'EMPTY_RESPONSE' | 'TIMEOUT'
  | 'CANCELLED' | 'DATA_APPROVAL_REQUIRED' | 'COST_APPROVAL_REQUIRED'
  | 'CREDENTIAL_MISSING' | 'PAYLOAD_TOO_LARGE' | 'NETWORK_ERROR' | 'UNKNOWN'
```

## 2. Provider Adapter 契约

文件：`plugin/src/host/protocols/<id>.js`，每个文件 `export const id`、`export const label`、
`export function buildRequest({ slot, brief, signal })`、`export function parseResponse({ slot, response, body, startedAt })`、
`export function parseError({ slot, status, body, headers })`、`export const capabilities`。

统一返回（`parseResponse`）：

```ts
{
  ok: true,
  requestId: string | null,
  answer: string,                  // 可展示正文（拼接 text 块，跳过 thinking/reasoning 块）
  blocks: Array<{ type, text }>,   // 保留块边界
  finishReason: string | null,
  usage: UsageMeta,                // 不可得 → null
  modelId: string | null,          // 响应回显的 model（仅诊断用）
  raw: unknown                     // 不进入会话日志，只用于诊断
}
```

- `openai_chat_completions`：`POST {baseUrl}/chat/completions`，`Authorization: Bearer`，`messages`（system 作为首条 `system` 消息），`max_tokens`（可被 `max_completion_tokens` 覆盖），不注入不支持参数。
- `anthropic_messages`：`POST {baseUrl}/messages`，`anthropic-version`，`x-api-key` 或 `Authorization: Bearer`，`system` 为顶层字段，`max_tokens` 必填，`content[]` 聚合，跳过 `thinking` 块。
- Base URL 规范化：去掉尾部 `/`；若已以 `/v1` 结尾则不再追加；路径不重复拼接。
- 两种协议都必须支持 `AbortSignal`、超时、重试（仅对可重试错误：429/5xx/网络）。
- 不实现流式（首版明确不做），能力表标 `nonStream: true`。

## 3. 工具参数契约

### `consult_expert`
```ts
{
  question: string                 // 必填，整理后的中心问题
  slot?: 'L1' | 'L2' | 'L3'        // 省略 → 按 mode/risk/complexity 自动路由
  mode?: Mode                      // 默认 'general'
  reason?: string                  // 触发原因（UI 展示）
  context?: string                 // 最小必要上下文
  evidence?: string                // 公式 / 日志 / 复现步骤
  requested_output?: string        // 期望专家输出的结构
  risk?: 'low' | 'medium' | 'high'
  complexity?: 'low' | 'medium' | 'high'
  privacy_scope?: string           // 允许共享范围说明。门禁是**短语级**（`entire repo`/`整个仓库`/`all files`/`process.env` 等 14 条）；命中即拒绝为 DATA_APPROVAL_REQUIRED，除非 security.allowRepoScope=true。它是防误用的护栏，不是安全边界
}
```

### `consult_council`
```ts
{
  question: string
  mode?: Mode
  reason?: string
  context?: string
  evidence?: string
  requested_output?: string
  slots?: Array<'L1'|'L2'|'L3'>   // 默认全部已配置档位
  privacy_scope?: string
}
```

### `followup_expert`
```ts
{ consultation_id: string, slot?: SlotId, question: string, mode?: Mode }
```

### `verify_consultation`
```ts
{
  consultation_id: string,
  verdict: 'ADOPTED' | 'PARTIAL' | 'NEEDS_MORE_EVIDENCE' | 'REJECTED',
  slot?: SlotId,
  notes: string,
  evidence?: string
}
```

工具返回给模型的 `render()` 文本必须包含：状态、每档 modelId、每档回答正文（council 三份全部）、机械聚合摘要、以及"外部模型回答不是最终结论"的提示。`presentationMeta()` 返回上面的 `ConsultationMeta`。

## 4. 设置页 HTTP 契约（prefix `/expert-council/`）

全部要求：`req.socket.remoteAddress` 为回环地址，且请求头 `x-dsh-expert-council: 1`；否则 403。响应 JSON，永不包含 key 明文。

| 方法 | 路径 | 请求体 | 响应 |
|---|---|---|---|
| GET | `/expert-council/state` | — | `{ version, defaults, slots: SlotPublic[], credentials: Record<ref,{configured,source}>, warnings: string[] }` |
| POST | `/expert-council/slot` | `{ slot, patch }` | `{ ok, state }`；`patch` 只允许白名单字段 |
| POST | `/expert-council/credential` | `{ slot, apiKey }` | `{ ok, credential: { ref, configured } }` |
| DELETE | `/expert-council/credential` | `{ slot }` | `{ ok, credential: { ref, configured: false } }` |
| POST | `/expert-council/test` | `{ slot }` | `{ ok, result: TestResult }` |

```ts
type SlotPublic = {
  slot: SlotId
  enabled: boolean
  displayName: string
  protocol: 'openai_chat_completions' | 'anthropic_messages'
  providerLabel: string
  baseUrl: string
  modelId: string
  credentialRef: string
  credentialConfigured: boolean
  apiVersion?: string
  authScheme?: 'x-api-key' | 'bearer'
  maxOutputTokens: number
  temperature: number | null
  timeoutMs: number
  retries: number
  configured: boolean             // 必填项齐全
  warnings: string[]
}

type TestResult = {
  ok: boolean
  slot: SlotId
  endpointHost: string
  protocol: string
  modelId: string
  authOk: boolean
  nonStreamOk: boolean
  parseOk: boolean
  usageAvailable: boolean
  latencyMs: number
  billable: true                  // 固定：真实请求会计费
  error?: { category: ErrorCategory, message: string, httpStatus?: number }
}
```

## 5. 配置（`cordis.patch.yml` 行 config）

```yaml
- insert:
    - id: dsh-expert-council
      name: dsh-expert-council
      config:
        slots:
          L1: { enabled: false, displayName: 'Frontier Reasoning', protocol: anthropic_messages,
                providerLabel: '', baseUrl: '', modelId: '', credentialRef: DSH_EXPERT_L1_API_KEY,
                apiVersion: '2023-06-01', authScheme: x-api-key, maxOutputTokens: 8192,
                temperature: null, timeoutMs: 120000, retries: 1 }
          L2: { ... }
          L3: { ... }
        defaults:
          singleSlot: L2
          allowCouncil: true
          maxCostUsdPerCall: null
        security:
          allowedHosts: []
          trustedLocalEndpoints: []
          maxPayloadBytes: 120000
          redaction: true
```

## 6. 模块边界（禁止越界写入）

| 路径 | 归属 |
|---|---|
| `plugin/index.js`, `plugin/package.json`, `plugin/cordis.patch.yml`, `plugin/src/host/*.js`（除 protocols） | Lead |
| `plugin/src/host/protocols/**`, `tests/protocols/**` | host-protocols |
| `plugin/src/client/**`, `plugin/scripts/build.mjs` | client-ui |
| `skills/**`, `docs/**`（除 `docs/contracts.md`）, `README.md` | skill-docs |
| `tests/integration/**`, `tools/**` | Lead |

## 7. 验收纪律

- 每个 Gate 结论只能是 `PASS` / `CONDITIONAL_PASS` / `BLOCKED` / `FAIL`，并附证据路径。
- Mock 通过 ≠ 真实 API 验收。真实连接未配置时一律 `BLOCKED`，并写明缺失的授权。
- 禁止伪造 usage / 费用 / 模型回答。
