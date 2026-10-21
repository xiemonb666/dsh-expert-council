# 安装 / 升级 / 卸载

本文只讲 `dsh-expert-council` 这一个 bundle 的实际操作路径。所有操作走 Harness 内置的 `plugin_manager` 工具（Web 侧边栏 **插件** 页等价）。**不要**手改 profile 的 `package.json` 或 `cordis.patch.yml` 来完成安装。

---

## 0. 先认清三个位置

| 东西 | 路径（本机） | 说明 |
|---|---|---|
| bundle 根 | `C:\Users\XieMo\Desktop\dsh-expert-council\plugin` | 含 `package.json` + `cordis.patch.yml`，**安装目标** |
| 仓库根 | `C:\Users\XieMo\Desktop\dsh-expert-council` | **不是** bundle（没有 `package.json`），不能直接装 |
| profile 目录 | `C:\Users\XieMo\.dsh\profiles\desktop` | 依赖、锁文件、profile patch、安装日志 |
| 宿主安装位置 | `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\app.asar\dsh` | Harness 本体，只读参考 |

> 常见错误：把仓库根当成 bundle 去装，pnpm 会因缺 `package.json` 失败。安装目标永远是 `plugin` 子目录。

---

## 1. 安装

### 1.1 一条命令

```
plugin_manager(
  action: "install_bundle",
  target: "C:\\Users\\XieMo\\Desktop\\dsh-expert-council\\plugin"
)
```

`target` 传**绝对路径**即可；`plugin_manager` 会读取该目录的 `package.json`，按 `dsh.bundle.patch` 找到 `cordis.patch.yml`，然后：

1. `pnpm add` 把依赖写进 profile 的 `package.json`；
2. 把 `dsh-expert-council` 追加到 `dsh.profile.bundles` 末尾（新安装默认启用）；
3. 应用 bundle patch，把插件行插进 Loader 树；
4. 发布 profile 的 runtime resolution。

也可以先看它到底要装什么：

```
plugin_manager(action: "list_bundles")     # 找到官方/本地条目与 installTarget
plugin_manager(action: "list_plugins")     # 看已安装的插件行
```

### 1.2 安装后检查清单

| 检查项 | 期望 |
|---|---|
| 工具列表 | 出现 `consult_expert`、`consult_council`、`followup_expert`、`verify_consultation` |
| 设置页 | 出现 **Expert Council** 分区（含 L1/L2/L3 三张卡） |
| 插件行 | `list_plugins` 里出现 `dsh-expert-council`，且未被 `disabled` |
| 日志 | profile 的 `.plugin-manager/logs/operation-*/pnpm.log` 有本次记录 |

### 1.3 需要重启吗

分两种情况，**以工具返回的 `nextStep` / `restart-required` 为准**：

| 场景 | 是否需要重启 | 原因 |
|---|---|---|
| **首次安装**（该包此前未装过） | 通常**不需要** | 启用 HMR 时新插件行可直接挂载；本机 desktop profile 属于这一类 |
| **替换/覆盖已安装的同名包**（升级、重新链接、改了代码重装） | **需要重启宿主进程** | D0 已核实：新的 JS 模块代不会在运行中的进程里替换已加载的旧代 |
| profile **未启用 HMR** | 需要重启 | 结果会带 `restart-required` |

`restartReason` 的含义：

- `no-hmr` —— 该 profile 只在启动时组合，必须重启宿主进程；
- `package-moved` —— 包解析到了别的目录，需要重启；
- HMR 待处理原因 —— 有只能在重启后加载的模块。

**重启 = 完全退出 DeepSeek Harness 再打开**，不是刷新网页。改完代码或换了包版本后如果行为没变，先怀疑漏了这一步。

### 1.4 依赖构建脚本

若安装失败并在 `pendingBuilds` 里列出包名，说明 pnpm 11 拦下了依赖的 install 脚本。这时需要**用户明确同意**后，把包名放进 `approvedBuilds` 重试：

```
plugin_manager(action: "install_bundle", target: "...", approvedBuilds: ["<包名>"])
```

授权按包名保存在当前 profile，并以宿主用户权限执行。本插件自身不需要构建脚本（纯 JS，无编译步骤）。

### 1.5 失败会怎样

安装失败或取消时，`plugin_manager` 会把 profile 的 `package.json` 与 `pnpm-lock.yaml` **恢复成安装前的快照**；但 pnpm 已下载到 `node_modules`/缓存里的文件可能残留。**用户手写的 patch 配置、应用数据、日志不会被回滚。**

---

## 2. 升级

### 2.1 源码目录直接升级（开发时最常用）

1. 更新仓库：`git pull`（或切到目标 tag/分支）。
2. **先卸载再安装** —— 启用 HMR 时，`install_bundle` 对「已安装的同一个包」会以 `already-installed` 拒绝，必须先移除：

```
plugin_manager(action: "remove_bundle", target: "dsh-expert-council")
plugin_manager(action: "install_bundle", target: "C:\\Users\\XieMo\\Desktop\\dsh-expert-council\\plugin")
```

> 注意 `remove_bundle` 的 `target` 是**包名**，不是路径。

3. 卸载期间插件会停止、模块被逐出、映射被移除；重装后重新挂载。
4. 若返回 `restart-required`，重启宿主。

升级不会自动迁移你的 `config`：`cordis.patch.yml` 里已有的 `config` 保持不变，新增字段取代码内默认值。

### 2.2 已发布版本升级

如果装的是注册表/git 版本，`install_bundle` 传版本 spec 即可；但同样受「已安装需先移除」限制。官方条目的更新在 Web 插件页是「先卸载再安装」两步自动完成。

### 2.3 升级后为什么常要重启

**替换已安装的同名包 = 需要重启宿主进程**（D0 已核实：新模块代不会在运行中进程里替换旧代）。首次安装可以走 HMR，替换不行。

具体原因：

- 插件 Host 代码在宿主进程内运行，已加载的模块不会被新的文件内容顶替；
- profile 的 bundle 选择与 Loader 树是**启动时组合**的产物，选择列表变化不一定能就地重放；
- 被移除映射的模块必须先逐出；替换版本若导入失败，旧版本不再运行；
- 已取消选入、但启动时就在跑的 bundle 在进程结束前无法真正卸载。

所以看到 `restart-required` 就重启，不要尝试绕过。

---

## 3. 卸载

### 3.1 临时停用（保留依赖与配置）

```
plugin_manager(action: "set_bundle", target: "dsh-expert-council", enabled: false)
```

- 只是从 `dsh.profile.bundles` 取消选择，**依赖保留**、`config` 保留、凭证保留。
- 重新 `enabled: true` 会追加到选择列表**末尾**，可能改变配置优先级（home patch 与单次启动 patch 仍在其后，优先级更高）。
- 也可以只禁用单个插件行：`plugin_manager(action: "set_plugin", target: "dsh-expert-council", enabled: false)`。这会在 profile patch 里写一条 `id + disabled` 覆盖项。

### 3.2 彻底卸载

```
plugin_manager(action: "remove_bundle", target: "dsh-expert-council")
```

依次执行：从 `dsh.profile.bundles` 移除 → 卸载运行时贡献（工具、卡片、设置页、HTTP 路由）→ `pnpm remove` → 发布 runtime resolution。

卸载**不会**自动删除：

- 你的 `config`（`cordis.patch.yml` 里那条插件行）；
- 凭证存储里的 API key；
- 历史会话里的 `tool/call` / `tool/result` 记录（这是 Harness 会话日志，属宿主数据）；
- `.plugin-manager/logs` 下的安装日志。

需要干净重装时，按下一节清理。

### 3.3 完全清理残留

| 残留 | 位置 | 清理方式 |
|---|---|---|
| 插件行 | `C:\Users\XieMo\.dsh\profiles\desktop\cordis.patch.yml` 里的 `dsh-expert-council` 条目 | 手工删除该条目（先关宿主） |
| API key | `C:\Users\XieMo\.dsh\.credentials.yaml` 的 `refs:` 下 `DSH_EXPERT_L1_API_KEY` 等 | 见 §5 |
| 安装日志 | `C:\Users\XieMo\.dsh\profiles\desktop\.plugin-manager\logs\` | 可整目录删除 |
| Skill（如果装了） | `C:\Users\XieMo\.dsh\skills\dsh-expert-routing\` | 删除该目录 |

`cordis.patch.yml` 旁边可能有 `cordis.patch.yml.bak-<timestamp>` 备份，是历史写入留下的，可对照但不要盲目覆盖。

---

## 4. 回滚

按场景选：

1. **只是插件代码回退**：`git checkout <上一个可用 commit>` → 卸载 → 重新安装（§2.1）。
2. **profile 配置被写坏**：用 `cordis.patch.yml.bak-*` 备份对照恢复，或删除 `dsh-expert-council` 行后重装。修改前先关宿主。
3. **安装把 profile 弄坏**：`plugin_manager` 的失败恢复已还原 `package.json` 与锁文件；若进程异常退出导致残留，停宿主后手工删除依赖并 `pnpm install`（在 profile 目录）。
4. **升级后行为异常**：`set_bundle enabled: false` 先止血，再回退代码重装。历史咨询记录不受影响。

回滚后重新验证：工具可见 → 设置页可见 → 连接测试 → 单路咨询。

---

## 5. 配置与凭证存在哪里

### 5.1 插件配置

| 层级 | 文件 | 优先级 |
|---|---|---|
| bundle 默认 | `plugin/cordis.patch.yml` | 最低 |
| profile patch | `C:\Users\XieMo\.dsh\profiles\desktop\cordis.patch.yml` | 中 |
| home patch | `C:\Users\XieMo\.dsh\cordis.patch.yml` | 更高（在本机用于 `llm-pi-ai` 路由，不要放本插件） |
| 单次启动 `--patch` | 启动参数 | 最高 |

设置页保存时通过 `ctx.configEditor` 写回 **profile patch**（按 Loader 正常路径持久化 raw config），不会碰 home patch。所以：

- 想让某档配置「压过」其他层 → 写 home patch；
- 想跟随 profile → 用设置页，别手改 home patch。

改完 `cordis.patch.yml` 后，启用 HMR 时约 2 秒生效；否则重启。

### 5.2 凭证（API Key）

插件**只存引用名，不存明文**。每档一个 `credentialRef`，默认：

| 档位 | 默认引用 |
|---|---|
| L1 | `DSH_EXPERT_L1_API_KEY` |
| L2 | `DSH_EXPERT_L2_API_KEY` |
| L3 | `DSH_EXPERT_L3_API_KEY` |

解析顺序（`ctx.credentials.resolve`，第一个有值的胜出）：

1. **托管存储** `C:\Users\XieMo\.dsh\.credentials.yaml`（`refs:` 段）—— 设置页保存写这里；
2. 启动时的**进程环境变量**（`DSH_EXPERT_L1_API_KEY=...`）；
3. 项目 `.env`（`<cwd>/.env`）；
4. harness home `.env`（`C:\Users\XieMo\.dsh\.env`）。

注意：

- 托管存储的值**压过**环境变量。想让导出的环境变量生效，必须先把托管存储里的同名项删掉。
- 环境变量是**启动快照**，启动后再 export 不会生效，需重启。
- 文件只允许当前 OS 用户读取；但 Agent 的工具进程以同一用户运行，所以**文件权限不能对 Agent 保密** —— 不要指望用它隔离密钥。

### 5.3 清除凭证

三条路，任选：

1. **设置页**：Expert Council → 对应档 → 清除 Key（等价于 `DELETE /expert-council/credential`，只接受回环地址 + `x-dsh-expert-council: 1` 头）。
2. **工具/代码**：`ctx.credentials.unset(credentialRef('DSH_EXPERT_L1_API_KEY'))`。
3. **直接编辑文件**：打开 `C:\Users\XieMo\.dsh\.credentials.yaml`，删除 `refs:` 下的对应行；存储会自动重载。删除是删行，**不要写成空字符串**（空值会被拒绝）。

清完之后，对应档的咨询会以 `CREDENTIAL_MISSING` 失败，而不是静默降级到别的档。

---

## 6. 排障速查

| 现象 | 可能原因 | 处理 |
|---|---|---|
| 工具列表没有 `consult_*` | bundle 未启用 / 未重启 / 安装失败 | `list_plugins` 看状态；`restart-required` 就重启 |
| 设置页没有 Expert Council | Client 半未加载 | 重启宿主；检查 `package.json` 的 `dsh.client` 是否被改坏 |
| `install_bundle` 报 `already-installed` | 已安装同一包（HMR 下不允许覆盖） | 先 `remove_bundle` |
| 安装报 `incompatible-version` | 插件声明的 DSH 版本要求未满足 | 升级插件；**不要**轻易授权版本豁免（可能崩溃/丢数据） |
| 安装失败留下 `pendingBuilds` | pnpm 拦下依赖脚本 | 用户批准后带 `approvedBuilds` 重试 |
| 卸载后配置还在 | 设计如此 | 按 §3.3 清理 |
| 改了 `cordis.patch.yml` 不生效 | 没启用 HMR / 写到了低优先级层 | 重启；确认改的是 profile patch |
