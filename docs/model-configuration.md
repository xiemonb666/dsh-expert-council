# 模型配置

三档（L1 / L2 / L3）是**三个独立的槽位**，不是插件测出来的性能等级。你把哪个模型放进哪档，完全由你决定；同一模型可以同时占多档（此时三路缺乏独立性，卡片会提示）。

配置入口：**Harness → 设置 → Expert Council**。保存后写回 profile 的 `cordis.patch.yml`（见 [安装文档 §5.1](install-upgrade-uninstall.md#51-插件配置)）。

> 本文描述的是字段语义与协议行为；**具体渲染与保存细节以插件实际行为为准**。契约基线见 [contracts.md §4/§5](contracts.md)。

---

## 1. 每档的字段

### 1.1 必填（缺一档就是 `SLOT_UNCONFIGURED`）

| 字段 | 类型 | 含义 | 注意 |
|---|---|---|---|
| `enabled` | boolean | 是否启用该档 | 关掉即 `SLOT_DISABLED`，不会自动用别的档顶替 |
| `protocol` | `openai_chat_completions` \| `anthropic_messages` | API 协议 | 显式选择，**绝不根据 Model ID 猜** |
| `baseUrl` | string | API 根地址 | 见 §2；必须 `http(s)`、无内嵌凭证、无 query/hash |
| `modelId` | string | 模型 ID | **严格透传**，不擅自拼版本号、不加前缀 |
| `credentialRef` | string | 凭证引用名 | 默认 `DSH_EXPERT_<档位>_API_KEY`；明文 key 永不落进配置 |

`enabled: true` 但 `baseUrl` / `modelId` / `credentialRef` 有空值时，配置归一化会给出警告并保持不可用；运行时按 `CREDENTIAL_MISSING` 或 `SLOT_UNCONFIGURED` 报错。

### 1.2 展示与诊断

| 字段 | 默认 | 含义 |
|---|---|---|
| `displayName` | `Frontier Reasoning` / `Advanced Reasoning` / `Core Reasoning` | 卡片上显示的档位名 |
| `providerLabel` | `''` | 厂商标签（自由文本，仅展示） |

### 1.3 协议细节

| 字段 | 适用协议 | 默认 | 含义 |
|---|---|---|---|
| `apiVersion` | **仅 `anthropic_messages`** | `2023-06-01` | 作为 `anthropic-version` 请求头。升级模型或接口版本时按厂商要求改 |
| `authScheme` | 两种都支持 | L1 `x-api-key`，L2/L3 `bearer` | 鉴权头形式：`x-api-key` 或 `Authorization: Bearer` |
| `maxOutputTokens` | 两种都支持 | L1/L2 `8192`，L3 `4096` | 输出上限，合法区间 1 – 1,000,000 |
| `maxTokensParam` | **仅 `openai_chat_completions`** | `max_tokens` | 用哪个字段名传上限，见下 |
| `reasoningEffort` | 两种都支持 | `null`（不发） | 思考等级，见 §1.4 |
| `thinkingBudget` | **仅 `anthropic_messages`** | `null`（按等级换算） | 直接指定 `thinking.budget_tokens`，**优先于** `reasoningEffort`。见 §1.4 |
| `temperature` | 两种都支持 | `null`（不发） | `null` = 不注入该参数；设了数值才发送 |
| `timeoutMs` | 两种都支持 | L1 `180000`，L2 `120000`，L3 `90000` | 单次请求超时，区间 5,000 – 900,000 ms |
| `retries` | 两种都支持 | `1` | 重试次数，区间 0 – 5；**只对可重试错误**（429 / 5xx / 网络）生效 |

#### 1.4 `reasoningEffort`（思考等级）

取值：`minimal` / `low` / `medium` / `high` / `xhigh` / `max`。留空或 `null` = **完全不发送**该参数，由供应商用自己的默认值。

两种协议的表达方式不同：

| 协议 | 实际发出的字段 | 说明 |
|---|---|---|
| `openai_chat_completions` | `reasoning_effort: "<级别>"` | 原样透传，不做映射、不做降级。供应商不认识该值就报错，错误会显示在卡片上 |
| `anthropic_messages` | `thinking: { type: "enabled", budget_tokens: N }` | 按 `maxOutputTokens` 的比例换算：`low` 25%、`medium` 50%、`high` 70%、`xhigh` 80%、`max` 85% |

Anthropic 的两条硬性约束由适配器自动处理：

1. `budget_tokens` 必须**小于** `max_tokens`（自动取 `min(比例值, max_tokens - 1)`）；
2. `budget_tokens` 最小 1024 —— 若 `maxOutputTokens` 太小、算出的预算不足 1024，则**不发 thinking**（而不是发一个必然被拒绝的请求）。

另外，Anthropic 不允许 `thinking` 与 `temperature` 同时出现，所以开启 thinking 时适配器会**自动去掉 `temperature`**。

> 注意：`reasoning_effort` 是否真的兑现，取决于供应商。换供应商后请用设置页的「测试连接」自行确认，不要假设参数一定生效。

##### 供应商实测差异（重要）

本仓库对 ai-pixel 网关做过逐档实测，两种协议行为**不一样**：

| 端点 | `reasoning_effort` | `thinking.budget_tokens` |
|---|---|---|
| `[OI]` `/chat/completions` | **生效**：`max` 比不传多出约 1300 字符 reasoning，延迟显著上升 | 不适用 |
| Anthropic `/messages` | **被忽略**：传 `max` 与不传无差别，也不返回 thinking 块 | **生效**：1024→636 字符思考，32000→约 1800 字符 |

结论：**如果 Anthropic 网关后台显示的推理等级不是你想要的，改 `reasoningEffort` 没用，必须改 `thinkingBudget`。** new-api 系网关会按自己的档位重新标注等级（例如把你发的高预算标成 `medium`），客户端无法强制它显示成 `max`。

该网关的 budget 饱和点约在 16000–32000：再加预算，思考字符数不再明显增长。因此 `thinkingBudget: 32000` 已接近这个网关的实际上限。


#### Anthropic 专用：`apiVersion` 与 `authScheme`

- `apiVersion` 会作为 `anthropic-version: <值>` 头发出。留空时代码回落到 `2023-06-01`。
- `authScheme` 决定密钥怎么带：
  - `x-api-key` → 头 `x-api-key: <key>`（Anthropic 官方默认）；
  - `bearer` → 头 `Authorization: Bearer <key>`（部分兼容服务/网关要求）。
- 选错会得到 `AUTH_INVALID`（401/403），不会静默重试另一种方式。

#### [OI] 兼容：`maxOutputTokens` 与 `maxTokensParam`

- `max_tokens`（默认）：绝大多数 Chat Completions 兼容服务。
- `max_completion_tokens`：较新的推理模型会**拒绝** `max_tokens`，这时切到这个字段名。
- 两个字段**永不同时发送**；`maxOutputTokens` 不是正整数时不发上限字段。
- 能力探测：若服务不支持你设置的参数，表现为 `CAPABILITY_UNSUPPORTED` 或 `PROVIDER_ERROR`，按错误信息调整，不要盲试。

### 1.4 成本与任务范围（可选）

| 字段 | 默认 | 含义 |
|---|---|---|
| `pricing.inputPerMTokUsd` | `null` | 每百万输入 token 单价（美元）；填了才能估费 |
| `pricing.outputPerMTokUsd` | `null` | 每百万输出 token 单价 |
| `allowedTasks` | `[]` | 该档允许的任务类型（自由标签，供路由/UI 提示） |

费用为估算时，卡片会标 `source: estimated`；拿不到用量时标 `unknown`，**不会写成 0**。

### 1.5 全局默认与安全（profile 级，不是每档）

| 字段 | 默认 | 含义 |
|---|---|---|
| `defaults.singleSlot` | `L2` | 单路咨询不指定 `slot` 时的默认档 |
| `defaults.allowCouncil` | `true` | 是否允许三路委员会 |
| `defaults.maxCostUsdPerCall` | `null` | 单次预估费用上限；`null` = 不限制（仍应主动提示费用）。超限需人工批准 |
| `security.allowedHosts` | `[]` | 允许的 endpoint 主机白名单（小写比较） |
| `security.trustedLocalEndpoints` | `[]` | 显式批准的可信本地 endpoint（用于本地模型代理） |
| `security.maxPayloadBytes` | `120000` | 脱敏后外发正文的字节上限，超出 `PAYLOAD_TOO_LARGE` |
| `security.redactSecrets` | `true` | 是否执行本地脱敏 |
| `security.allowRepoScope` | `false` | 是否允许 `privacy_scope` 声明仓库级范围 |
| `security.requireDataApproval` | `false` | 外发前是否强制人工批准（`DATA_APPROVAL_REQUIRED`） |

生产使用建议：`allowedHosts` 填实际用到的域名；本地代理必须写进 `trustedLocalEndpoints`，否则回环/内网地址会被 `ENDPOINT_NOT_ALLOWED` 拦下。

---

## 2. Base URL 怎么写（两种协议）

### 2.1 规范化规则

1. 去首尾空白、去尾部所有 `/`。
2. **已经以 `/v1` 结尾就保留，不再追加**。
3. 拒绝：相对地址、非 `http(s)`、内嵌用户名密码、带 query、带 hash → `INVALID_ENDPOINT`。
4. 拼路径时：
   - base 已经以协议路径结尾 → 原样使用；
   - base 以 `/v1` 结尾 → 直接接 `/<path>`；
   - 其他 → 先补 `/v1` 再接 `/<path>`。

**所以永远不会出现 `/v1/v1`。**

### 2.2 `openai_chat_completions` → `POST {base}/v1/chat/completions`

| 你填的 baseUrl | 实际请求 |
|---|---|
| `https://api.openai.com` | `https://api.openai.com/v1/chat/completions` |
| `https://api.openai.com/v1` | `https://api.openai.com/v1/chat/completions` |
| `https://api.openai.com/v1/` | 同上（尾部斜杠被去掉） |
| `https://api.ai-pixel.online/v1` | `https://api.ai-pixel.online/v1/chat/completions` |
| `https://gateway.example.com/llm` | `https://gateway.example.com/llm/v1/chat/completions` |

### 2.3 `anthropic_messages` → `POST {base}/v1/messages`

| 你填的 baseUrl | 实际请求 |
|---|---|
| `https://api.anthropic.com` | `https://api.anthropic.com/v1/messages` |
| `https://api.anthropic.com/v1` | `https://api.anthropic.com/v1/messages` |
| `https://proxy.example.com/anthropic` | `https://proxy.example.com/anthropic/v1/messages` |

### 2.4 不要这样填

| 写法 | 结果 |
|---|---|
| `https://api.openai.com/v1/v1` | 变成 `/v1/v1/chat/completions` → 404 `MODEL_UNAVAILABLE`/`PROVIDER_ERROR` |
| `https://api.openai.com/v1/chat/completions` | 恰好能跑（视为已含路径），但**不推荐**：换模型/换协议时容易错 |
| `api.openai.com/v1` | 缺 scheme → `INVALID_ENDPOINT` |
| `https://user:pass@host/v1` | 内嵌凭证 → `INVALID_ENDPOINT` |
| `https://host/v1?key=xxx` | 带 query → `INVALID_ENDPOINT` |
| `http://127.0.0.1:8080/v1` | 回环地址，除非写进 `trustedLocalEndpoints`，否则 `ENDPOINT_NOT_ALLOWED` |

---

## 3. 连接测试

每档卡片上的 **测试连接** 会发出一次**真实请求**：

- **会真实计费**。测试不是本地模拟，也不是免费探测；测试前先想清楚。
- 返回内容（`TestResult`）：实际解析后的 `endpointHost`、`protocol`、`modelId`、`authOk`、`nonStreamOk`、`parseOk`、`usageAvailable`、`latencyMs`、`billable: true`，失败时带 `error.category`。
- 它验证的是「认证通过 + 非流式调用可用 + 响应能解析 + 是否给 usage」四件事，**不验证**你的 prompt 质量，也不保证某个模型 ID 长期有效。
- 测试通过 ≠ 该模型在你的真实问题上表现好。别把测试通过当成选档依据。

---

## 4. 能力差异与降级规则

两个适配器都如实上报能力，不做「假装支持」：

| 能力 | `openai_chat_completions` | `anthropic_messages` |
|---|---|---|
| 非流式（`nonStream`） | ✅ 是 | ✅ 是 |
| 流式（`streaming`） | ❌ 首版不做（请求固定 `stream: false`） | ❌ 同上；收到 SSE 响应会以 `BAD_RESPONSE` 明确拒绝 |
| 系统提示（`systemPrompt`） | ✅ `messages` 首条 `system` | ✅ **顶层 `system` 字段**（不放 `messages` 数组） |
| usage | 可选（缺失记 `null`） | 可选（缺失记 `null`） |
| 工具调用（`tools`） | ❌ 不暴露 | ❌ 不暴露 |
| 推理块（`reasoning`） | 可选 | 可选；`thinking` 块**跳过不显示**，仅保留为 `reasoning-summary` |
| 正文来源 | `choices[].message` | `content[]` 中的可展示文本块聚合 |
| `max_tokens` | 可选，字段名可切 `max_completion_tokens` | **必填**，非正整数 → `CAPABILITY_UNSUPPORTED` |
| `temperature` | 仅当设了数值才发 | 同左 |
| 鉴权 | `Authorization: Bearer` | `x-api-key` 或 `Bearer`，按 `authScheme` |
| 版本头 | 无 | `anthropic-version` |

**降级规则：**

1. **参数不支持就报错，不静默丢弃**：拿不到 usage 记 `unknown`；参数被拒报 `CAPABILITY_UNSUPPORTED` / `PROVIDER_ERROR`。
2. **某档不可用不影响其他档**：三路里一档失败，结果仍是 `PARTIAL`，其余回答完整保留。
3. **不自动换档**：目标档不可用时不会偷偷用别的档替代；要换档就显式指定 `slot`。
4. **不自动换协议**：`protocol` 选错只会报错，不会猜另一个协议重试。
5. **重试只针对可重试错误**：429、5xx、网络错误；401/403/404/参数错误立即失败，重试没有意义。

---

## 5. 常见错误码对照

错误分类枚举与 [contracts.md §1](contracts.md) 的 `ErrorCategory` 一致。

| Category | 含义 | 常见原因 | 处理 |
|---|---|---|---|
| `SLOT_UNCONFIGURED` | 该档必填项不全 | 没填 `baseUrl` / `modelId` | 补配置；或换已配置的档 |
| `SLOT_DISABLED` | 该档被禁用 | `enabled: false` | 在设置页启用 |
| `CREDENTIAL_MISSING` | 引用解析不到值 | 没存 key / 存了空值 | 保存 key；或把同名托管项删掉改用环境变量 |
| `AUTH_REQUIRED` | 需要认证但没有可用凭证 | 请求未带鉴权 | 配置凭证 |
| `AUTH_INVALID` | 凭证被拒（401/403） | key 错、过期、`authScheme` 选错、workspace 不匹配 | 换 key；Anthropic 兼容服务试另一种 `authScheme` |
| `ENDPOINT_NOT_ALLOWED` | endpoint 不在白名单或不可信本地地址 | 回环/内网地址未登记；域名未进 `allowedHosts` | 加白名单 / 加 `trustedLocalEndpoints` |
| `INVALID_ENDPOINT` | base URL 非法 | 缺 scheme、内嵌凭证、带 query/hash | 按 §2 改写法 |
| `MODEL_UNAVAILABLE` | 服务不认识这个 Model ID | ID 拼错、该账号无权限、路径多拼了 `/v1` | 核对 ID 与 Base URL |
| `CAPABILITY_UNSUPPORTED` | 请求了不支持的参数/能力 | Anthropic 缺 `max_tokens`；服务不支持某参数 | 调整 `maxOutputTokens` / `maxTokensParam` |
| `RATE_LIMITED` | 429 限流 | 频率/配额超限 | 稍后重试；降并发；检查配额 |
| `PROVIDER_UNAVAILABLE` | 5xx 暂时不可用 | 服务端故障/维护 | 重试；看厂商状态页 |
| `PROVIDER_ERROR` | 服务返回了错误体 | 参数非法、余额不足、内容被拒 | 读 `message` 与 `providerCode` |
| `BAD_RESPONSE` | 响应无法按该协议解析 | 协议选错、返回 HTML/SSE、代理改写响应 | 核对 `protocol`；检查网关 |
| `EMPTY_RESPONSE` | 没有可展示正文 | 只回了 thinking 块；被截断；内容策略拦截 | 调大 `maxOutputTokens`；换问法 |
| `TIMEOUT` | 超过 `timeoutMs` | 推理慢、网络差、`maxOutputTokens` 过大 | 调大超时；减小输出 |
| `CANCELLED` | 调用被取消 | 用户中断/宿主关闭 | 重新发起 |
| `DATA_APPROVAL_REQUIRED` | 外发内容需人工批准 | `requireDataApproval: true` 或范围过大 | 批准，或缩小 `privacy_scope` |
| `COST_APPROVAL_REQUIRED` | 预估费用超预算 | 超过 `maxCostUsdPerCall` | 批准，或调高预算 |
| `PAYLOAD_TOO_LARGE` | 脱敏后正文超字节上限 | `context` / `evidence` 太长 | 精简到最小必要片段 |
| `NETWORK_ERROR` | 未拿到响应就断网/DNS/TLS 失败 | 代理、证书、断网 | 检查网络与代理 |
| `UNKNOWN` | 其他未归类失败 | — | 看 `message` 与 `requestId` |

`requestId`（Provider 返回的请求 ID）请保留 —— 向厂商报障时是唯一凭据。

---

## 6. 三档怎么配（建议）

| 档位 | 建议放什么 | 理由 |
|---|---|---|
| L1 | 最强的推理模型（重大数学/物理/架构争议） | 单次成本高但调用少 |
| L2 | 日常主力（复杂编程、方案对照） | 单路咨询默认档 |
| L3 | 便宜、快（中等难度、快速诊断、辅助视角） | 高频调用的成本控制 |

三条硬建议：

1. **三档尽量用不同厂商/不同模型**，否则 `consult_council` 的「三路独立」名不副实。
2. **`maxOutputTokens` 别一刀切**：推导类问题给足（8192+），快速诊断可以小。
3. **`temperature` 默认 `null` 就好**；要复现性时再显式设低值，并注意并非所有服务都支持该参数。
