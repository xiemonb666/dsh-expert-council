# dsh-expert-council

**给 DeepSeek Harness 用的「专家咨询网关」**：把 L1 / L2 / L3 三个**由你自己配置**的外部模型槽位，接成随时可调用的单路专家（`consult_expert`）或三路并行委员会（`consult_council`），并在工具轨迹里留下完整、可回放的审计卡片。

DeepSeek 主 Agent 始终保留规划、编码、测试、合并与验收的唯一执行权；被咨询的模型只提供建议、推导、批判和替代方案。

---

## 它是什么 / 不是什么

**是：**

- **模型无关的咨询网关。** 三档是三个带标签的槽位，你往里面填任意合法的 Provider / Model ID。插件不检测「谁最强」，也不强制 L1 比 L2 贵。
- **双协议原生适配。** 每档可独立选择 `openai_chat_completions`（[OI] Chat Completions 兼容）或 `anthropic_messages`（Anthropic Messages 原生）。三档可以混搭不同厂商、不同协议。
- **可审计。** 实际发出的脱敏正文、每档完整可展示回答、错误、用量、耗时、requestId 都进入会话的 `tool/call` / `tool/result`（权威记录），历史回放直接复用会话事件；另有一个上限 200 条、只存脱敏文本的本地索引，用于重启后仍能按 `consultation_id` 追问与记录判定。
- **诚实降级。** 某档没配就是 `SLOT_UNCONFIGURED`，某档失败就是 `PARTIAL`，用量拿不到就是 `unknown`。不伪造回答、不伪造 token 账单、不把 `PARTIAL` 说成「三模型一致」。

**不是：**

- **不是 GPT 插件**，也不绑定任何厂商。名字里没有 GPT / OpenAI / Anthropic / DeepSeek；`GPT` 只是一个你可以绑上去的模型选项。
- **不是主 Agent 的替代推理引擎。** 它不接管决策，也不自动执行被咨询模型的建议。
- **不是聊天客户端。** 首版只做**非流式**的单轮请求/响应，没有 SSE 流式显示，不暴露工具调用给被咨询模型，不读取隐藏思维链。
- **不是「三路投票器」。** 插件只做机械聚合（词面重合、长度、各自独有项），**不做语义结论**；共识与冲突由 DeepSeek 主 Agent 判定。
- **不自动读取你的仓库。** 默认不上传工作区、不读密钥文件；外发内容先做正则级脱敏，范围由调用方显式声明，声明全量范围会被策略拒绝。

---

## 能力清单

| 能力 | 工具 / 位置 | 状态 |
|---|---|---|
| 单路专家咨询（L1 / L2 / L3，可显式指定或自动路由） | `consult_expert` | 已实现，**真实 API 验证** |
| 三路并行独立咨询（同一问题快照、互不可见、独立保存） | `consult_council` | 已实现，**真实混合协议 3/3 验证** |
| 对已有咨询的指定档位追问 | `followup_expert` | 已实现，**真实 API 验证** |
| 记录对专家回答的验证判定（`ADOPTED`/`PARTIAL`/`NEEDS_MORE_EVIDENCE`/`REJECTED`） | `verify_consultation` | 已实现，**真实 API 验证** |
| 双协议适配器（[OI] Chat Completions + Anthropic Messages） | `plugin/src/host/protocols/` | 已实现，132 项测试 + 真实网关验证 |
| 本地脱敏（密钥/token/私钥块/URL 内嵌凭证/本次解析到的凭证字面量） | `plugin/src/host/` | 已实现，正则级保守处理 |
| 三档配置、凭证、连接测试 | 设置 → 专家委员会 | 已实现，真实连接测试通过 |
| 工具卡片（单路 / 三路）与历史回放 | Web UI 工具轨迹 | 已实现，视觉未上机验证 |
| **中英双语界面**（跟随宿主语言设置，271 条文案，en + zh） | `plugin/client.js` | **已实现并上机确认** |
| 路由与咨询方法 Skill | `skills/dsh-expert-routing/` | **已交付并安装**（会话 skill 目录可见） |
| 流式响应 | — | 首版明确不做 |
| 隐藏思维链 | — | 不提供，永不落盘 |
| 第四路「综合模型」 | — | 不做，不会暗中发起第四次付费调用 |

### 界面语言

插件的全部界面文案（卡片标题、字段标签、按钮、状态、错误说明、设置页）都走宿主自己的 locale 服务，注册了 `en` 与 `zh` 两份字典（各 271 条），**跟随 Harness 的语言设置自动切换**，无需单独配置：

- 宿主界面是中文 → Expert Council 显示中文；切成 English → 立刻变英文，无需刷新。
- 设置页在左侧导航里的名字也随之切换（`专家委员会` / `Expert Council`）。
- 错误码保留英文枚举原样（如 `SLOT_DISABLED · 该档位已禁用`），方便与日志、文档对照。
- **模型回答、用户填写的问题与原因、协议 id、`Base URL`/`Model ID`/`API Key` 等字段名、JSON 键名一律不翻译**——它们是数据或技术标识，不是界面文案。

---

## 5 分钟快速开始

> 前置：DeepSeek Harness Desktop `0.2.1-rc.2`，profile `desktop`。仓库已 clone 到本地。

### 0. 用发行包安装（不用 clone 仓库）

```powershell
# 下载 dist/dsh-expert-council-1.0.0.tar.gz 后解压
tar -xzf dsh-expert-council-1.0.0.tar.gz -C C:\plugins
```

```
plugin_manager install_bundle  target: C:\plugins\dsh-expert-council-1.0.0
```

发行包内容、校验方式、升级与卸载见 [发行与安装](docs/release.md)。发行包已实测可安装（`application: applied`）。

### 1. 从源码安装 bundle

用 `plugin_manager` 工具的 `install_bundle`，目标是 **`plugin` 子目录的绝对路径**（不是仓库根目录 —— 仓库根没有 `package.json`）：

```
plugin_manager install_bundle  target: C:\Users\XieMo\Desktop\dsh-expert-council\plugin
```

安装会把依赖写进 profile 的 `package.json`、把插件行插进 `cordis.patch.yml`，并选入 `dsh.profile.bundles`。细节与失败回滚见 [安装 / 升级 / 卸载](docs/install-upgrade-uninstall.md)。

装好后确认：

- 工具列表出现 `consult_expert` / `consult_council` / `followup_expert` / `verify_consultation`；
- 设置页出现 **专家委员会**（英文环境为 Expert Council）。

### 2. 配置三档

打开 **Harness → 设置 → Expert Council**，对 L1 / L2 / L3 各填：

| 字段 | 填什么 |
|---|---|
| Protocol | `openai_chat_completions` 或 `anthropic_messages` |
| Base URL | 例如 `https://api.openai.com/v1` 或 `https://api.anthropic.com` |
| Model ID | 严格透传，不要自己拼版本号 |
| API Key | 存进凭证存储，界面上只显示「已配置」 |
| 启用 | 勾上 |

每档点一次 **连接测试** —— 注意**测试会真实发请求、会真实计费**。

字段含义、Base URL 写法、错误码对照见 [模型配置](docs/model-configuration.md)。

### 3. 试一次单路

让 Agent 咨询一次，例如：

> 用 `consult_expert` 问 L2：这个递归改迭代的转换在尾调用优化缺失时会不会退化？带上最小复现代码。

预期：工具轨迹里出现一张 `Expert Consultation` 卡片，包含实际发出的脱敏正文、模型完整回答、modelId、耗时、用量（可能为 `unknown`）。

### 4. 试一次三路

> 用 `consult_council` 同时问三档：这三条缓存失效策略哪个更适合当前负载？

预期：`Expert Council` 卡片，顶部 `2/3 returned` 之类的真实状态，中间三个并列面板，下方机械聚合区。**三份回答都必须完整保留**，缺档要写明缺哪档。

工具参数与卡片区域逐项说明见 [使用说明](docs/usage.md)。

### 5. 装上 Skill（可选但推荐）

`skills/dsh-expert-routing/SKILL.md` 负责「何时咨询、选哪档、怎么问、怎么验」。装到用户级技能根：

```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.dsh\skills\dsh-expert-routing" | Out-Null
Copy-Item .\skills\dsh-expert-routing\SKILL.md "$env:USERPROFILE\.dsh\skills\dsh-expert-routing\SKILL.md" -Force
```

`dsh-skill-filesystem` 会在 rank 400 `user-dsh` 扫描到它，**无需重启**，下一轮会话目录即出现。

---

## 目录结构

```
dsh-expert-council/
├─ plugin/                      ← bundle 根（install_bundle 的目标）
│  ├─ package.json              dsh.bundle.patch / dsh.client 声明
│  ├─ cordis.patch.yml          Loader 插入行 + 默认 config
│  ├─ index.js                  Host 入口：apply(ctx, config)
│  ├─ client.js                 Web 入口：工具卡片 + 设置页（自包含单文件）
│  ├─ icon.svg / locale/        图标与本地化
│  └─ src/
│     └─ host/                  编排、配置归一化、脱敏、记录、设置路由
│        └─ protocols/          双协议适配器（openai / anthropic + shared）
├─ skills/
│  └─ dsh-expert-routing/SKILL.md   ← 路由与核验方法（可安装到 ~/.dsh/skills）
├─ docs/
│  ├─ contracts.md              内部接口契约（唯一契约来源，勿改）
│  ├─ acceptance-report.md      验收报告（实机记录 + 未验证项 + 遗留缺陷）
│  ├─ release.md                发行包构建、安装、升级、卸载
│  ├─ install-upgrade-uninstall.md
│  ├─ model-configuration.md
│  ├─ usage.md
│  └─ known-limitations.md
├─ tests/
│  ├─ host/                     配置、脱敏、端点策略、记录、设置路由、入口冒烟、思考等级
│  ├─ protocols/                双协议适配器（132 项）
│  ├─ integration/              真实 HTTP 端到端（18 项）
│  └─ client/                   客户端冒烟（165 项检查）+ 本地化验收（26 项）
├─ tools/
│  ├─ build-release.mjs         构建 dist/ 发行包 + 校验和
│  └─ asar.mjs                  读取 app.asar 内包的辅助脚本
├─ dist/                        发行产物（构建后生成，不入库）
├─ CHANGELOG.md
├─ LICENSE                      MIT
└─ README.md
```

---

## Gate 状态

> 纪律：每个结论只能是 `PASS` / `CONDITIONAL_PASS` / `BLOCKED` / `FAIL`，并附证据路径。**Mock 通过 ≠ 真实 API 验收**；真实连接未配置时一律 `BLOCKED`。

| Gate | 交付目标 | 结论 | 证据 / 说明 |
|---|---|---|---|
| D0 | Harness 版本能力调查与插件 API 对照 | `PASS` | [docs/contracts.md §0](docs/contracts.md) —— 已实测：插件目录无法解析 `@deepseek-ai/*`（故禁止 bare import）、工具卡片走 `tool.call.toolview`、结果经 `presentationMeta` → `block.meta`、配置持久化走 `ctx.configEditor`、凭证走 `ctx.credentials`、HTTP 走 `ctx.webServer`、Skill 走 `~/.dsh/skills` |
| D1 | 双协议 Provider Adapter | `PASS`（离线） | `tests/protocols` **132/132**：正常/空正文/多内容块/thinking 跳过/429/401/403/404/5xx/非标准错误体/超时/取消/usage 缺失/`/v1` 不重复/system 位置/max_tokens |
| D2 | 三档 Slot 配置与凭证安全 | `PASS`（离线） | `tests/host/config.test.mjs`、`routes.test.mjs`（14）、`entry-smoke.test.mjs`（7）；凭证永不出现在任何响应与卡片 meta |
| D3 | `consult_expert` 单路闭环 | `PASS`（离线 + 本机 mock 在线） | `tests/integration` 18/18；实机调用见 [验收报告 §3.2](docs/acceptance-report.md) |
| D4 | `consult_council` 三路并行 | `PASS`（离线 + 混合协议 mock 在线） | 并发计时断言 <1500ms（两个 400ms mock）；3/3、2/3、1/3、0/3 全覆盖；实机混合协议见 [§3.3](docs/acceptance-report.md) |
| D5 | 分析/合并协议 | `PASS` | 只做机械词面聚合，语义综合归主 Agent；无第四路调用；`tests/host/synthesis.test.mjs` |
| D6 | UI 咨询卡片与设置页 | `CONDITIONAL_PASS` | 注册已实证（实时 `Slots.listSubTree`：4 个 toolview key + `settings.section#expert-council` 在列且 `active:true`）；**中英双语已实现并有 19 项 i18n 测试覆盖**（264 条文案、en/zh 键集一致、真实字典渲染出中文、无裸键回落）；**真实页面视觉未验证**（无浏览器控制） |
| D7 | 安全、回归与交付 | `PASS` | **269/269** 离线测试全绿 + 客户端 165 项检查；**真实 API 联调已通过**（三档 + 混合协议 + 追问 + 判定全链路） |
| — | 真实供应商 API 联调 | `PASS` | ai-pixel 网关实测：单路 / 三路混合协议 / 追问 / 判定记录全部成功 |

```
node --test "tests/**/*.test.js" "tests/**/*.test.mjs"   →  tests 269 / pass 269 / fail 0
```

> 完整证据、实机调用记录与遗留缺陷见 [**验收报告**](docs/acceptance-report.md)。

**已确定的三个事实：**

- **插件已安装并运行。** `plugin_manager install_bundle` 返回 `application: applied`；`cordis_inspect_query(Tool.listTools)` 实时返回中包含 `consult_expert` / `consult_council` / `followup_expert` / `verify_consultation` 四个工具；`Slots.listSubTree` 显示四张卡片与 Expert Council 设置页均已注册。
- **Skill 已安装且被发现。** `skills/dsh-expert-routing/SKILL.md` 已复制到 `C:\Users\XieMo\.dsh\skills\dsh-expert-routing\SKILL.md`，并被 `dsh-skill-filesystem`（rank 400 `user-dsh`）扫描到 —— 本会话的可用 skill 目录里已出现 `dsh-expert-routing`。这是最硬的安装证据。
- **真实 API 联调已通过。** 单路、三路混合协议（[OI] + Anthropic）、追问、判定记录均在真实网关上跑通；明细见 [验收报告 §3.6](docs/acceptance-report.md)。唯一仍未验证的是**真实页面像素级外观**（开发环境无浏览器控制），见 [已知限制](docs/known-limitations.md)。
- **发行包已实测可安装。** `node tools/build-release.mjs` 产出的 `.tar.gz` 解压后，用解压目录执行 `install_bundle` 返回 `application: applied`，功能正常。

若本文档与代码或测试不一致，**以代码与测试为准**。

---

## 文档

- [发行与安装](docs/release.md) —— 发行包内容、校验、安装、升级、卸载、发布前检查表
- [安装 / 升级 / 卸载](docs/install-upgrade-uninstall.md) —— 安装、升级、禁用、卸载、回滚、配置与凭证存放位置
- [模型配置](docs/model-configuration.md) —— 三档每个字段、两种协议 Base URL 写法、思考等级、连接测试计费、能力差异与错误码
- [使用说明](docs/usage.md) —— 四个工具的参数与返回、卡片各区域含义、复制与回放、`unknown` 用量怎么读
- [验收报告](docs/acceptance-report.md) —— 每个 Gate 的真实结论与证据
- [已知限制](docs/known-limitations.md) —— 如实列出首版边界
- [内部契约](docs/contracts.md) —— 实现基线（模块边界、数据模型、HTTP 契约）
- [变更日志](CHANGELOG.md) —— 版本变更记录

## 开发

```powershell
# 全部离线测试（269 项）
node --test "tests/**/*.test.js" "tests/**/*.test.mjs"

# 客户端冒烟（165 项检查）
node tests/client/smoke.mjs

# 构建发行包
node tools/build-release.mjs
```

## 命名

全部 `dsh-` 前缀，不含 GPT、[OAI]、Anthropic 或特定厂商名。`GPT` / `Claude` 只是可绑定的模型选项。

## 许可

[MIT](LICENSE) © 2026 dsh-expert-council contributors
