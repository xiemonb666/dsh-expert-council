# 发行与安装

本文件说明如何获取、安装、升级和卸载 `dsh-expert-council`，以及每个发行包的内容与校验方式。

---

## 1. 构建发行包

```powershell
cd C:\Users\XieMo\Desktop\dsh-expert-council
node tools/build-release.mjs
```

产物在 `dist/`：

| 文件 | 内容 |
|---|---|
| `dsh-expert-council-1.0.0.tar.gz` | 可安装 bundle（21 个文件，未压缩 339 636 字节） |
| `dsh-expert-council-1.0.0.zip` | 同一棵树，方便无 tar 的环境 |
| `SHA256SUMS.txt` | 上面两个包的 SHA-256 |

两个压缩包内都是单层目录 `dsh-expert-council-1.0.0/`，解压后**该目录本身就是 bundle 根**（含 `package.json` 与 `cordis.patch.yml`）。

### 包内文件清单

```
package.json          bundle 清单（dsh.bundle.patch / dsh.client）
cordis.patch.yml      Loader 插入行 + 默认 config
index.js              Host 入口：apply(ctx, config)
client.js             Web 入口：4 张工具卡片 + 设置页（自包含单文件）
icon.svg              插件图标
locale/en.json        插件元数据（英文标题/描述）
locale/zh.json        插件元数据（中文标题/描述）
README.md             bundle 内的简版说明
src/host/*.js         编排、配置、脱敏、HTTP、记录、设置路由、工具定义
src/host/protocols/   两个协议适配器 + 共享工具 + 注册表
```

**不包含**测试与文档源码（`tests/`、`docs/`、`skills/`、`tools/`），它们在仓库里，不随 bundle 分发。

### 校验

```powershell
cd dist
Get-Content SHA256SUMS.txt
Get-FileHash dsh-expert-council-1.0.0.tar.gz -Algorithm SHA256
```

两个哈希应一致。

---

## 2. 安装

### 2.1 从发行包安装（推荐给最终用户）

```powershell
# 1) 解压
tar -xzf dsh-expert-council-1.0.0.tar.gz -C C:\some\stable\path

# 2) 安装（target 指向解压出来的那个目录，不是它的父目录）
```

然后在 Harness 里执行：

```
plugin_manager(action: install_bundle, target: "C:\\some\\stable\\path\\dsh-expert-council-1.0.0")
```

期望返回 `application: applied`。**这一步是唯一权威的成功判据**——不要凭日志或进程列表判断。

### 2.2 从源码目录安装（开发者）

```powershell
plugin_manager(action: install_bundle, target: "C:\\Users\\XieMo\\Desktop\\dsh-expert-council\\plugin")
```

`install_bundle` 会把该目录链接进 profile，所以改代码后需要重新安装（或重启）才能加载新的 JS 模块代。

### 2.3 安装后验证

```
cordis_inspect_query(platform: "host", provider: "Tool", method: "listTools")
```

返回里应包含 `consult_expert`、`consult_council`、`followup_expert`、`verify_consultation`。

再看设置页：Harness → 设置 → **专家委员会**（英文环境为 Expert Council）。能看到三个档位卡片即说明客户端一半也加载成功。

---

## 3. 升级

```
plugin_manager(action: remove_bundle, target: "dsh-expert-council")
plugin_manager(action: install_bundle, target: "<新版本的解压目录>")
```

必须**先卸载再安装**：`install_bundle` 对已存在的同名包会返回 `already-installed`。

> **需要重启宿主进程。** 宿主不会热重载已安装插件的 JS 模块代；替换同名包后，运行中的实例仍是旧代码。首次安装可以走 HMR。

配置与凭证不受升级影响——它们存在 profile 的 `cordis.patch.yml` 与 `~/.dsh/.credentials.yaml` 里，不在 bundle 内。

---

## 4. 卸载

```
plugin_manager(action: remove_bundle, target: "dsh-expert-council")
```

卸载会移除 profile 依赖，但**保留**该行在 `cordis.patch.yml` 里的 `config`（你的三档设置不会丢）。若要彻底清理：

1. 删除 `cordis.patch.yml` 里 `- id: dsh-expert-council` 那一整行；
2. 删除凭证：`~/.dsh/.credentials.yaml` 中的 `DSH_EXPERT_L1_API_KEY` / `L2` / `L3`；
3. 删除咨询索引：`~/.dsh/expert-council/`；
4. （可选）删除 Skill：`~/.dsh/skills/dsh-expert-routing/`。

---

## 5. 配置与数据的位置

| 内容 | 位置 | 说明 |
|---|---|---|
| 三档配置 | `<profile>/cordis.patch.yml` 的 `- id: dsh-expert-council` 行 | 通过设置页写入，也可手改 |
| 凭证 | `~/.dsh/.credentials.yaml` | 由宿主凭证服务管理；**永不出现在 bundle 或配置里** |
| 咨询索引 | `~/.dsh/expert-council/index.json` | 上限 200 条，只存脱敏文本；可安全删除 |
| Skill | `~/.dsh/skills/dsh-expert-routing/SKILL.md` | 由 `dsh-skill-filesystem` 扫描（rank 400） |

---

## 6. 发行前检查表

每次发布前确认：

- [ ] `node --test "tests/**/*.test.js" "tests/**/*.test.mjs"` 全绿
- [ ] `node tests/client/smoke.mjs` 全绿
- [ ] 所有发布 JS 通过 `node --check`
- [ ] `plugin/client.js` 只 `require('react')`，无 `import` / `export`
- [ ] `plugin/` 下无 bare import（`@deepseek-ai/*` 无法解析）
- [ ] 仓库与配置中不含任何明文密钥
- [ ] `node tools/build-release.mjs` 成功
- [ ] 解压发行包 → `node --check` 全部 JS → `import('./index.js')` 能拿到 `apply`
- [ ] 用解压出来的目录执行一次 `install_bundle`，确认 `application: applied`
- [ ] `CHANGELOG.md` 已记录本次变更
