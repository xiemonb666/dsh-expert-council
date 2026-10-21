# dsh-expert-council 验收报告

**报告日期**：2026-10-21
**Harness 版本**：`0.2.1-rc.2`（Desktop，profile `desktop`）
**插件版本**：`dsh-expert-council@1.0.0`
**Skill 版本**：`dsh-expert-routing`

本报告只记录**实际执行过**的验证。凡未执行的项一律标 `BLOCKED` 并写明原因与解除条件。

---

## 1. 结论摘要

| Gate | 交付目标 | 结论 | 关键证据 |
|---|---|---|---|
| D0 | Harness 能力调查与插件 API 对照 | **PASS** | [contracts.md §0](contracts.md)；`plugin_manager install_bundle` 返回 `application: applied` |
| D1 | 双协议 Provider Adapter | **PASS**（离线） | `tests/protocols` 132/132 |
| D2 | 三档 Slot 配置与凭证安全 | **PASS**（离线） | `tests/host/config.test.mjs`、`tests/host/routes.test.mjs`、`tests/host/entry-smoke.test.mjs` |
| D3 | `consult_expert` 单路闭环 | **PASS**（离线 + 本机 mock 在线） | `tests/integration/consultation.test.mjs`；实机调用见 §3.2 |
| D4 | `consult_council` 三路并行 | **PASS**（离线 + 混合协议 mock 在线） | 并发计时断言、2/3 与 0/3 用例；实机调用见 §3.3 |
| D5 | 分析/合并协议 | **PASS** | 机械聚合 + 主 Agent 语义综合，无第四路调用；`tests/host/synthesis.test.mjs` |
| D6 | UI 卡片与设置页 | **CONDITIONAL_PASS** | 注册已实证（`Slots.listSubTree` 显示 4 个 key + `settings.section#expert-council` 在列）；中英双语已实现（19 项 i18n 测试）；**真实页面视觉未验证**（无浏览器控制） |
| D7 | 安全、回归与交付 | **PASS** | 269 项离线测试全绿；真实 API 联调已通过（见 §3.6） |
| — | 真实供应商 API 联调 | **PASS** | ai-pixel 网关，三档 + 混合协议 + 追问 + 判定全链路实测（见 §3.6） |

**总测试数：269 / 269 通过，0 失败，0 跳过**（另有客户端 165 项检查）。

```
PS> node --test "tests/**/*.test.js" "tests/**/*.test.mjs"
ℹ tests 269
ℹ pass 269
ℹ fail 0
ℹ cancelled 0
```

---

## 2. 分项证据

### 2.1 环境事实（D0）

实测得到并据此实现，详见 [contracts.md §0](contracts.md)。其中三条是硬约束，任何一条判断错误都会导致插件加载失败：

1. **插件目录无法解析 `@deepseek-ai/*`**。实测安装一个 `import { Schema } from '@deepseek-ai/schemastery'` 的探针 bundle，返回
   `failed to import: Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@deepseek-ai/schemastery'`。
   → 因此插件全部代码只使用 `node:*` 内建模块与相对路径 ESM import，静态扫描确认 **0 处 bare import**。
2. **工具卡片由客户端 keyed slot 渲染**，数据来自 `presentationMeta()` 的返回值（`block.meta`），不是 Host 的 `presentCall`。
3. **配置持久化必须走 `ctx.configEditor.edit()`**（写 profile patch 并由 Loader 正常路径重载），否则改动不生效。

### 2.2 双协议适配器（D1）

`plugin/src/host/protocols/`：

| 文件 | 行数 | 职责 |
|---|---|---|
| `shared.js` | 635 | URL 规范化、错误分类、usage 映射、脱敏、brief 渲染（无 import，纯函数） |
| `openai-chat-completions.js` | 324 | OpenAI Chat Completions 原生请求构造与解析 |
| `anthropic-messages.js` | 301 | Anthropic Messages 原生协议（system 顶层字段、`max_tokens` 必填、`content[]` 聚合） |
| `index.js` | 120 | 按 `slot.protocol` 分发，无协议逻辑 |

测试覆盖（`tests/protocols`，132 项）：正常文本、空 `content`、仅 `thinking` 块、`choices`/`content` 缺失、usage 缺失或部分缺失（一律 `null`，不写 0）、多内容块、`thinking` 跳过且不计入 `answer`、`stop_reason`/`finish_reason` 映射、429 + `retry-after`（秒与 HTTP-date 两种）、401/403/404/500/501/505/408/413、纯文本/HTML/空 body 错误体、SSE body 拒绝、超时 vs 取消、`/v1/v1` 不重复、非法 URL → `INVALID_ENDPOINT`、system 位置差异、`max_tokens` 与 `max_completion_tokens` 切换、未设置参数不出现在请求体、`Authorization` 不进 `redactedBody`、密钥泄漏扫描。

### 2.3 三档配置与凭证（D2）

- `normalizeSlot` / `normalizeConfig` 对任意敌意输入（`null`、数组、字符串、嵌套错误类型）不抛异常，只记 warning 并回落默认值。
- `sanitizeSlotPatch` / `sanitizeSecurityPatch` 白名单：未知字段、类型错误、非法协议一律丢弃，不进 profile。
- 凭证通过 `ctx.credentials`（`CredentialRef`）解析，**永不出现在任何 HTTP 响应、会话日志或卡片 meta 中**；测试 `GET /state describes every slot and never leaks a credential value` 对整个响应体做字符串扫描。
- `POST /expert-council/credential` 写入、`DELETE` 清除，响应只回 `{configured, source}`。

### 2.4 单路与三路咨询（D3/D4）

实机验证（见 §3），离线验证覆盖：

| 场景 | 用例 |
|---|---|
| 混合协议 3/3 | `a council runs every slot concurrently and proves it with wall-clock timing`（两个 400ms mock，总耗时断言 < 1500ms，证明并行而非串行） |
| 部分失败 1/3 | `one failing slot does not destroy the other answers (PARTIAL)` |
| 全部失败 0/3 | `every slot failing yields FAILED with each reason preserved` |
| 未配置档位 | `an unconfigured slot is reported as UNCONFIGURED, never silently replaced`（并断言只有已配置档位被调用） |
| 凭证缺失 | `a missing credential stops the call before any request is sent`（断言 mock 收到 0 个请求） |
| 脱敏 | `secrets in the question are redacted before they reach the provider`（断言密钥不出现在线上请求体，且卡片显示 `[REDACTED`） |
| 超时/取消 | `a timeout is classified as TIMEOUT and does not hang the call` |
| 重定向 | `a redirect is refused instead of forwarding the credential` |
| 重试 | `retries happen for a transient 429 and are counted`（断言 `attempts=2`） |
| 快照一致 | `a council snapshot hash is identical across slots`（断言两个供应商收到完全相同的 user 文本） |

### 2.5 UI 与设置页（D6）

**已实证**（`cordis_inspect_query` → `Slots.listSubTree`，实时查询，非推测）：

- `tool.call.toolview` occupants 中出现 `consult_expert`、`consult_council`、`followup_expert`、`verify_consultation` 四个 key，`active: true`；
- `settings.section` occupants 中出现 `{ id: "expert-council", order: 50, active: true }`，与 `account/general/models/plugins/agent-presets` 并列。

**未验证**：真实浏览器中的视觉呈现、窄屏标签切换、展开/折叠动画、复制按钮的剪贴板权限路径。本会话无浏览器控制，client 侧 inspect 查询持续超时。这一项如实记为 `CONDITIONAL_PASS`。

### 2.6 安全（D7）

| 项 | 实现 | 证据 |
|---|---|---|
| 出站脱敏 | 11 类规则（PEM 私钥、`sk-*`/`sk-ant-*`、Bearer、AWS/GitHub/Google token、JWT、`xxx_key=...` 赋值、URL 内嵌凭证、环境变量名 + 长值、本次解析到的凭证字面量） | `tests/host/redact.test.mjs` 11 项 |
| 端点策略 | 强制 https（回环/私网除外且需显式授权）、拒绝内嵌凭证/query/hash、可选 host 白名单、**不跟随重定向**（防止认证头被转发） | `tests/host/http-policy.test.mjs` 7 项 |
| 外发范围 | `privacy_scope` 命中"整个仓库/整个工作区/全部环境变量"等短语即拒绝（`DATA_APPROVAL_REQUIRED`），需 `security.allowRepoScope` 显式放开 | `tests/integration` 中 `a whole-repository privacy scope is refused before any request` |
| 载荷上限 | 超过 `security.maxPayloadBytes`（默认 120 000 字节）拒绝为 `PAYLOAD_TOO_LARGE` | `consultation.js` |
| 设置 API | 仅回环客户端 + 必须携带 `x-dsh-expert-council: 1`，否则 403 | `requests without the required header are refused` |
| 外部模型权限 | 适配器不发送任何 `tools`/`tool_choice`，外部模型无法调用工具、读写文件或执行命令 | `capabilities.tools === false`，`tests/protocols` 断言请求体无 `tools` |
| 不可信回复 | 回复只作为文本返回给主 Agent，并强制附加"这是建议、须独立验证、用 `verify_consultation` 记录"的提示 | `render()` 断言 |
| 不影响原有功能 | 未注册全局 guard、未 restrict 任何工具、未改 system prompt、未拦截任何事件；仅新增 4 个工具与 7 条 HTTP 路由 | 插件代码中无 `tools.guard`/`tools.restrict`/`systemPrompt.section` |

---

## 2.7 界面本地化（中英双语）

用户要求界面汉化。实现走宿主自己的 locale 服务，不是硬编码中文。

### 机制

| 项 | 实现 |
|---|---|
| 字典注册 | `ctx.locale.register('dsh-expert-council', 'en'|'zh', dict)`，各自包在 `ctx.effect(...)` 里（卸载/重载会注销，避免重复注册抛错） |
| 取服务 | `ctx.get('locale')` **可选**获取 + `typeof` 守卫；不写进 `inject`，否则宿主缺该服务时整个插件会消失 |
| 翻译 | `ctx.locale.bind(ns)` → `t(key, params)`，支持 `{name}` 插值 |
| 语言切换 | `ctx.locale.subscribe(fn)` + `getLocale().active`，5 个入口组件各订阅一次，子组件靠父级重渲染 |
| 导航标签 | `label: function navLabel() { return t('settings.navLabel') }`（thunk，宿主每次投影重读） |
| 无 locale 服务时 | 回落到内置 `MESSAGES_EN`，**绝不渲染裸键** |

### 规模与质量

- 字典 **264 个键**，en 264 / zh 264，键集合完全一致。
- 源码里 `t('...')` 字面量 264 个：**0 缺失、0 孤儿**。
- zh 条目 249/264（94.3%）含中文；其余 15 条是纯格式模板（`{title} · {slot}`）、度量符号（`{value} KB`）与契约要求保留的英文技术名。
- `{placeholder}` 集合 en/zh 逐键一致（有测试断言）。

### 刻意不翻译的内容

`L1/L2/L3`、协议 id（`openai_chat_completions` / `anthropic_messages`）、`ErrorCategory` 枚举值、状态枚举（`SUCCESS`/`PARTIAL`）、HTTP 状态码、`Base URL`/`Model ID`/`API key` 字段名、JSON 键名、CSS 类名、`/expert-council/*` 路径、header 名；以及**模型回答、用户填写的 question/reason/evidence**——它们是数据，不是界面文案。

错误类别保留代码 + 中文解释，例如 `SLOT_DISABLED · 该档位已禁用`，便于与日志对照。

### 宿主英文文案的处理

宿主回传给卡片的三类英文文本：

1. `slot.error.category`（稳定机器码）→ `t('error.category.<CODE>')`，21 个码全覆盖，未知码回落 `UNKNOWN` 并带 `{code}`；宿主 `error.message` 原文降级为次要诊断行**保留**。
2. `diagnostics.notes` → 中性本地化标签 + 原文逐条照录。
3. `synthesis.note` → 卡片正文显示 `t('card.synthesisNote')`，原文同时进入诊断区与 Raw metadata，**不丢失**。

### 验证

`tests/client/i18n.test.mjs`，**19 项全绿**，用假 locale 服务加载真实 `client.js`：

- 结构：两份字典经 `__test.messages` 暴露；`apply()` 真的注册了 en 与 zh；导航 label 是 thunk 且随语言变化。
- 覆盖：源码每个 `t()` 键在 en/zh 都存在；无孤儿键。
- 质量：键集一致、占位符一致、en 无 CJK、zh 确有中文（>75%）、无空值/裸键、**中文只出现在 zh 字典内部**（字典外的硬编码 CJK 会被判为泄漏）。
- 行为：同一卡片在 zh 下渲染出中文、在 en 下无中文；模型回答原样保留；设置页两种语言都正确；**无 locale 服务时回落英文且无裸键**；pending/失败卡片也已本地化；展开卡片保留宿主原文供审计。
- 回归：仍是自包含单文件（只有 `require('react')`、无 import/export、无 `@deepseek-ai/`）。

真实字典渲染抽样（zh，真实 `plugin/client.js` + 真实字典）：

```
专家咨询 · L2 Advanced Reasoning
SUCCESS
1.84 秒 · [OI] Chat Completions · Acme · model-x · ~$0.0123 · 输入 321 · 输出 123 · 合计 444
复制回答 / 复制报告 / 概要 / 咨询 id / 状态 / 模式 / 原因 / 期望输出 / 耗时 ...
完整回答
是的，量纲一致。              ← 模型回答未被翻译
实际发送的脱敏请求 / 系统提示 / 用户消息 / 请求哈希 / 发送字节 ...
```

设置页（zh）：导航 `专家委员会`，正文 `最多可配置三个外部专家模型档位。L1 为前沿推理档…`。

### 本次修复的一个真实缺陷

卡片原先在 `props.defaultExpanded === true` 时**静默丢弃**宿主 `synthesis.note` 原文。生产路径不传该 prop（宿主只传 `callId/toolName/phase/block/cwd/home/useDisclosure/openFile/loadImage/inspect`），所以此前未暴露，但该分支可到达。已改为**无条件保留**宿主原文，并新增 `an expanded card keeps the host synthesis note verbatim for audit` 测试锁死。

---

## 3. 实机验证记录（本机 mock 供应商，非真实付费 API）

### 3.1 安装

```
plugin_manager(action: install_bundle, target: "C:\\Users\\XieMo\\Desktop\\dsh-expert-council\\plugin")
→ {"stage":"enable","enabled":true,"changed":true,"application":"applied","bundle":"dsh-expert-council","version":"1.0.0","warnings":[]}
```

安装后 `cordis_inspect_query(Tool.listTools)` 返回中包含全部四个工具，参数 schema 与实现一致。

### 3.2 单路咨询（真实 HTTP，本机 18099 端口的 OpenAI 兼容 mock）

```
consult_expert(question="Is the relation F = m·a dimensionally consistent ...", slot="L2", mode="physics_review")
→ Expert consultation ec-20261020161824-aa6e68 — COMPLETE
  Slot: L2 (Advanced Reasoning) · openai_chat_completions · E2E [OI] mock · model e2e-mock
  Status: SUCCESS · 4 ms · attempts 1
```

mock 服务端记录：`POST /v1/chat/completions`，`Authorization` 存在，请求体 711 字节。

### 3.3 混合协议委员会（L1 = Anthropic Messages mock，L2 = OpenAI 兼容 mock，L3 未配置）

```
consult_council(mode="physics_review", question="Does G = K_I²/E' hold under plane strain ...")
→ Expert council ec-20261020161840-5dd38c — COMPLETE (2/2 returned)
  L1 · anthropic_messages · model e2e-claude · SUCCESS · 4 ms
  L2 · openai_chat_completions · model e2e-mock · SUCCESS · 2 ms
  Tokens found in more than one answer: answer [L1+L2], E2E [L1+L2]
  Only in L1: anthropic, dimensional, analysis, holds
  Only in L2: expert, formula, dimensionally, consistent
```

两个 mock 服务端的独立日志证明两路**同时**发出（时间戳相差 2ms）且各自收到原生协议格式：

```
18098 (Anthropic): {"at":"2026-10-20T16:18:40.577Z","url":"/v1/messages","version":"2023-06-01","authScheme":"x-api-key","bytes":762}
18099 (OpenAI):    {"at":"2026-10-20T16:18:40.575Z","url":"/v1/chat/completions","auth":true,"bytes":754}
```

关键断言：

- Anthropic mock 在响应里放了 `{"type":"thinking","thinking":"SECRET-INTERNAL-REASONING-MUST-NOT-APPEAR"}`，返回给模型的正文中**没有**该内容——`thinking` 块被正确跳过；
- L3 未配置，结果明确为 `2/2 returned`，没有伪装成三模型一致；
- 历史索引 `/expert-council/history` 列出三条记录（1 条 FAILED 的 `SLOT_DISABLED`、1 条单路、1 条委员会），说明"诚实失败"路径也工作正常。

### 3.4 诚实失败路径

配置齐全之前直接调用：

```
consult_expert(question=..., slot="L2")
→ Expert consultation ec-20261020160753-e9e5eb — FAILED
  Status: DISABLED · 0 ms · attempts 0
  Error: SLOT_DISABLED — slot L2 is disabled
```

未伪造答案，未静默改用其它档位。

### 3.5 测试后状态恢复

E2E 使用的两个 mock 槽位、两个假凭证与 `trustedLocalEndpoints` 授权已全部清除，最终状态：

```
L1: enabled=False baseUrl='' modelId='' credentialConfigured=False
L2: enabled=False baseUrl='' modelId='' credentialConfigured=False
L3: enabled=False baseUrl='' modelId='' credentialConfigured=False
trustedLocalEndpoints: (empty)
```

---

### 3.6 真实供应商全链路验收（ai-pixel 网关）

用户提供真实凭证后，用真实付费 API 完成端到端验证。**不是 mock。**

| 验证项 | 结果 |
|---|---|
| 单路 `consult_expert`（L3 / [OI]） | `COMPLETE`，99493 ms，答案正确（17×23=391） |
| 三路 `consult_council`（L1 [OI] + L2 Anthropic + L3 [OI]） | `COMPLETE` **3/3 returned**，65.1s / 13.3s / 55.4s 并行 |
| 混合协议同时工作 | L2 走 `anthropic_messages` 成功（`attempts: 2`，说明重试机制真实生效） |
| `followup_expert`（L2 追问） | `COMPLETE`，23060 ms，正确带上上一轮回答 |
| `verify_consultation` | `ADOPTED` 已写入记录，历史接口可读回 |
| 用量如实标注 | 追问那次 provider 未回 usage → 显示 `Token usage: unknown`，未伪造 0 |
| 历史持久化 | 10 条记录可列出，单条详情含 3/3 完整回答与 `synthesis.decision.verdict` |

**期间发现并修复一个真实缺陷：**

首次真实工具调用失败：

```
consult_expert → FAILED
Error: CREDENTIAL_MISSING — the credential service is not mounted in this profile
```

根因：`plugin/index.js` 在 `apply()` 里一次性求值 `ctx.get('credentials')` 并捕获，而凭证服务是独立宿主插件、可能晚于本插件注册。捕获到的 `undefined` 被永久使用，导致**每次咨询都失败**——尽管凭证确实存在。

修复：`runSingle` / `runCouncil` / `testSlot` 改为**每次调用时重新解析**凭证服务。新增 2 项回归测试（`a credential service that mounts after apply() is still used`、`a missing credential service still reports CREDENTIAL_MISSING, not a crash`）。

> 这与之前 locale 服务的失效是**同一类错误**（加载期一次性捕获可选服务）。两处现在都已改为调用期惰性解析。

## 4. 仍未验证 / 受限项

真实 API 联调已于 §3.6 完成（`PASS`）。剩余未验证项只有一项：

| 项 | 原因 | 解除条件 |
|---|---|---|
| 真实页面视觉验收 | 开发环境无浏览器控制；client 侧 `cordis_inspect_query` 持续超时。中英文渲染是通过真实 `client.js` + 真实字典逐字符验证的（26 项 i18n 测试），但**像素级外观、窄屏标签切换、复制按钮的剪贴板权限路径**未在真实页面确认 | 用户在 Web GUI 打开 设置 → 专家委员会，以及任一次咨询卡片，确认渲染与交互 |

> 除上述一项外，其余能力均有实测证据。§3.6 是真实供应商调用，§3.1–3.5 是本机 mock，两者在报告中分开标注，不混用。

---

## 5. 已知缺陷与遗留

1. **历史详情路由在宿主重启前仍返回 404**。开发过程中发现 `webServer` 的 prefix 匹配规则是 `pathname === prefix || pathname.startsWith(prefix + '/')`，而原实现注册的是 `/expert-council/history/`（带尾斜杠），导致 `/expert-council/history/<id>` 永不匹配。已修复为注册 `/expert-council/history`，并有测试覆盖（`history endpoints list, read and delete consultations`）。**宿主进程的 JS 模块不会热重载**，需重启 DeepSeek Harness 后才在运行中的实例生效。设置页的"历史回看"依赖此接口；咨询卡片与工具调用不受影响。
2. **首版非流式**：两协议均发 `stream: false`。若供应商仍返回 SSE，判 `BAD_RESPONSE` 而不是静默截断。
3. **不支持工具调用**：不向被咨询模型暴露任何工具，`capabilities.tools = false`。
4. **推理内容只作诊断**：`thinking`/`reasoning_content` 以 `{type:'reasoning-summary'}` 保留在 `blocks`，绝不计入 `answer`，也不回传 Anthropic 的 `signature`（故不支持多轮 thinking 续传）。
5. **usage 不合成**：Anthropic 无 `total_tokens` 时保持 `null`；`cache_creation_input_tokens` 无对应字段未映射。费用仅在用户配置了 `pricing` 时按 token 估算，否则 `unknown`。
6. **脱敏是正则级**：保守匹配 11 类模式，不保证覆盖自定义密钥格式。`privacy_scope` 门禁是短语级护栏，不是安全边界——换个说法就能绕过，不要把判断责任交给它。
7. **`overlap` 只是词面聚合**：委员会结果里的共同 token 是机械匹配，不是语义共识，更不是正确性证据。
8. **本地索引上限 200 条**：超出后最旧记录被裁掉，此时按 `consultationId` 追问会得到"未记录"。会话日志中的 `tool/call`/`tool/result` 不受影响。
9. **`useDisclosure` 形状未实测**：卡片按其返回 `{expanded, toggle}` 实现，并做了形状不符时退回组件内 `useState` 的保护；真实 hook 若改名会静默降级为本地展开状态（功能不受影响）。

---

## 6. 复现命令

```powershell
cd C:\Users\XieMo\Desktop\dsh-expert-council

# 全量测试（240 项）
node --test "tests/**/*.test.js" "tests/**/*.test.mjs"

# 分组
node --test "tests/host/*.test.mjs"          # 50 项
node --test tests/protocols                   # 132 项
node --test "tests/integration/*.test.mjs"   # 18 项
node tests/client/smoke.mjs                  # 165 项客户端检查
node --test tests/client/i18n.test.mjs       # 19 项本地化验收

# 静态检查
node --check plugin/index.js
node --check plugin/client.js
```
