# dsh-model-refresh · v0.7.1

将 pi-ai 静态模型目录的补缺做成可独立升级的 DSH bundle。目标不是把网上所有模型名称塞进选择器，而是补齐当前 provider 真正可用、且能正确物化的新模型。

> 本次手动模型功能对照本机 DeepSeek Harness core `0.2.1-alpha.1` 的 configEditor 与 pi-ai 接口开发。应用配置需要目标核心提供这些接口；其它版本需要重新核对兼容性。源码回归测试不代表远端模型推理已验证。

## 功能概览

- 直接读取最新发布的 pi-ai 模型目录；models.dev 仅作为可选备份源，默认关闭。
- 对协议、上下文容量、输出容量和聊天用途缺少证据的新模型进入待确认，不使用邻居猜测。
- catalog 写入默认关闭；启用后使用协调锁、写前 journal、修订指纹和内容所有权校验。
- 删除要求权威完整清单、连续缺失确认和宽限期，失败或分页清单不会触发删除。
- 设置页显示发现、已应用、待确认、冲突、重启需求和写入权限状态。
- 设置页可手动增加、编辑模型，配置协议、端点、推理档位与协议兼容参数，通过官方配置编辑服务预览、应用和撤销。
- Host 生命周期持有状态租约，死进程锁可保守接管，正常关闭等待队列收敛后再释放。

## 安装与接入

仓库本身是一个带 `dsh.bundle.patch` 的 bundle。推荐通过当前 DSH 版本支持的插件管理入口安装；不要手工修改 DSH 核心、ASAR 或包管理器维护的依赖。若使用源码链接进行开发：

```powershell
git clone https://github.com/KouzakiUmi/dsh-model-refresh.git
cd dsh-model-refresh
pnpm install --frozen-lockfile
pnpm run build:client
pnpm test
```

然后由目标 profile 的官方插件/本地链接流程加载该目录。`cordis.patch.yml` 只插入 `dsh-model-refresh`，不会替用户修改 provider 路由。首次加载默认不写安装目录；需要在设置页显式启用 provider 与 catalog 写入。

Host 或 bundle 源码变更后通常需要重载对应 DSH 消费进程。catalog 是 pi-ai 的静态导入数据，新模型写入后也需要重启消费进程才会生效。插件不会自动重启 DSH。

## 快速配置

首次 seed 可复制 `config.example.json` 为本地 `config.json`，或直接在设置页保存。运行时状态默认位于 `~/.dsh/model-refresh/state.json`。真实凭据值只放环境变量或 DSH credentials 服务；配置里仅填写凭据名称。

```json
{
  "intervalMinutes": 360,
  "routes": [
    {
      "route": "opencode-go",
      "enabled": false,
      "keep": [],
      "exclude": []
    }
  ]
}
```

## 重新设计的原则

### 手动模型与高级能力

在插件设置页点击 **手动增加模型**，填写 provider 名称、模型 ID、显示名、推理协议、根 URL、上下文和输出容量。除图像输入外，还可显式配置推理档位、temperature 支持、developer 角色、工具严格模式、流式 usage、输出 token 参数和协议兼容 JSON。

1. 点击 **保存模型声明**。声明保存在插件状态的 `settings.manualModels`，自动发现不会覆盖它。
2. 选择 DSH 配置入口和应用到的 provider；凭据栏只填写环境变量/credentials 的名称，留空保留已有设置。
3. 点击 **预览配置变更**，核对模型列表，然后点击 **应用到 DSH**。插件通过 `configEditor.edit` 提交，Loader 负责验证和应用，无需修改安装目录中的 catalog。

同一 provider 必须使用相同协议与端点。覆盖已有 provider 时保留原有模型、凭据和其它配置，并将 `modelOverrides` 合并到模型列表；动态 models 表达式和不唯一的端点/协议会被拒绝，请使用独立 provider 名称。未指定兼容字段继承原配置；关闭推理请显式选择“关闭推理”，开启则填写端点实际接受的各档位值。

当前可选协议为 `openai-completions`、`openai-responses` 和 `anthropic-messages`；兼容控件只显示所选协议支持的字段，JSON 同样接受协议校验。可用 `node scripts/preflight-manual-core.mjs <已安装的 dsh-llm-pi-ai/lib/index.js 路径>` 对本机核心做只读接口核验。

声明保存与配置应用分开。移除声明后，重新应用剩余声明才会更新已应用配置；没有剩余声明时使用 **撤销此 provider 的插件变更**。撤销恢复首次应用前的 provider 配置，保留声明便于再次应用。应用前预览过期，或目标配置被其它页面修改时，插件拒绝覆盖/撤销。提交中断通过独立事务日志恢复，不能确认的冲突保留日志并报错。

应用表示配置通过 DSH 的编辑与加载流程，不表示端点、权限、工具调用或远端推理已经测通。

### 自动发现与目录事务

1. **pi-ai 是模型目录唯一主源**：启动/手动刷新查询 npm 最新 pi-ai 版本，仅版本改变时下载并校验官方包的完整性与 provider 文件散列。完整 catalog 缓存于状态目录；上游故障时保留旧缓存。models.dev 备选开关默认关闭。
2. **模型和服务可用性分开核对**：上游 pi-ai 决定候选 ID、协议与能力；可选 provider 官方清单只提供本套餐的正向存在性证据。`GET /models` 成功不证明套餐完整或推理已测通。401/403 不是端点正确的证明。
3. **不猜模型字段**：新增模型使用 pi-ai 上游提供的上下文、输出、输入模态、推理能力、协议和端点；缺字段或协议无法匹配当前目录时进入待确认。
4. **不污染原生目录**：已有模型的原生容量、image/reasoning 等不被外部旧数据覆盖；只同步 pi-ai 同一 provider、同一模型 ID 的记录。
5. **删除必须有负向证据**：仅用户明确确认当前套餐权威全量清单（`complete: true`），且响应没有分页/不完整迹象，连续确认缺失并过宽限期后，才产生移除计划。默认 24 小时 + 2 次；失败、缺 key、部分页会中断连续观察。`keep`、命名空间对应及同步冲突保护目录和路由产物两侧。
6. **真实写入才发布**：候选发现、待确认、实际写入、实际移除分别计数。目录写入关闭或失败时，未知 ID 不进入可消费的路由产物，避免 `needs an api`。
7. **回滚必须证明所有权**：新台账记录 protocol + ID + before/after + 包/manifest 修订指纹。只有当前内容和目录修订都匹配才能回滚。上游升级收录同 ID、甚至内容相同，修订变化也会释放所有权、保留模型。

## 架构

```text
pi-ai npm catalog ─> 精确 provider / model 匹配 ─┐
可选 models.dev 备选 ───────────────────────────┼─> planner（能力/协议/删除计划）
官方清单 ──────────────────────────────────────┤
安装目录 ──────────────────────────────────────┘
                    ├─> catalog-store（锁 + 写前日志 + 所有权校验）
                    └─> 实际目录核对后输出路由产物 + 监控
```

- `lib/official.mjs`：安全鉴权、明确清单 URL 或兼容路径、响应形状验证、分页信号、容量和类型提取。仅 404 尝试下一个候选，禁止携带凭据自动重定向；401/403 直接报鉴权拒绝。
- `lib/planner.mjs`：统一候选、pending、removals；明确非聊天类型（embedding/audio/image 等）不注入聊天路由；对象 key 与 model.id 必须相等。
- `lib/catalog-store.mjs`：唯一临时文件、写前 journal、内容/修订校验、协调写锁、恢复未完成提交。不会用损坏桶替换原组。
- `lib/index.js`：启动/定时/手动/配置共用队列；重复刷新去重；每轮配置快照；dispose 先取消网络并等待队列收敛，在状态与 catalog 不再可能迟到写入后才释放生命周期租约；源/路由错误分别保留。
- `lib/state.mjs`：v3 状态和 v1/v2 迁移，损坏 JSON / 未来版本拒绝覆盖。
- `lib/manual-models.mjs`：手动模型与兼容字段验证；`lib/provider-config.mjs`：官方配置编辑、预览指纹、应用/撤销所有权及提交恢复。
- `lib/pi-ai-upstream.mjs`：获取 npm 最新 pi-ai 发布包，校验完整性和 provider 文件散列，归一化并缓存模型目录。
- `lib/host-{io,http,lease}.mjs`：原子持久化、严格同源 loopback Web API、有界 JSON 请求、Host 状态生命周期锁。
- `src/client/index.tsx`：默认折叠，搜索筛选，应用/待确认/冲突监控；provider 官方端点、凭据名称、协议、完整性和容量配置；代理及全局开关；授权说明独立弹窗。
- `src/client/ManualModels.tsx`：独立手动模型编辑、能力声明和配置预览/应用/撤销流程。
- `lib/merge.mjs` / `lib/catalog-patch.mjs`：旧纯函数兼容和字段/YAML/条目构造工具；Host 不再调用其旧 ID-only 回滚及第三方 stale 删除链路。

## 配置与安全默认

首次使用默认不写安装目录；自动发现的 provider 默认停用。显式 seed route 或已有配置保留原启用/目录写入选择，不替用户扩大范围。

默认状态路径为 `os.homedir()/.dsh/model-refresh/state.json`，不再从插件安装路径猜用户目录。目录优先从真实 DSH 消费入口解析 pi-ai，取消本机硬编码 fallback；找不到时配置 `DSH_PI_AI_DATA_DIR`，无效显式覆盖拒绝退回其它安装。

环境变量：

| 变量 | 用途 |
| --- | --- |
| `DSH_MODEL_REFRESH_STATE` | 状态路径；默认产物输出在状态目录 |
| `DSH_MODEL_REFRESH_CONFIG` | 首次种子配置路径 |
| `DSH_PI_AI_DATA_DIR` | 正在被 DSH 使用的 pi-ai `dist/providers/data` |

首次迁移会先把原始状态备份为 `state.json.pre-v3-<时间戳>.bak`；备份成功后才允许写 v3。若需要退回旧版，先停止 Host、回滚代码，再人工恢复对应旧状态备份，不能让 v0.5 直接读取 v3 状态（旧版会丢弃不认识的版本）。

已有 v2 状态迁移到 v3 时保留支持的 settings、provider 开关及排除/保留名单；旧版已移除的数据源配置不再使用。旧新增台账只有 ID，不能证明所有权：迁入 `runtime.legacyProtected`，**不自动删除这些历史新增条目**。旧删除备份只恢复缺失条目，不覆盖或制造跨协议重复 ID。旧版已经覆盖的原生元数据无法凭旧台账恢复，本版不假称能还原。

### 每 provider 官方配置

设置页高级配置或 `settings.officialRoutes`：

```json
{
  "officialRoutes": {
    "kimi-coding": {
      "endpoint": "https://api.kimi.com/coding/v1/models",
      "apiKeyEnv": "KIMI_CODING_API_KEY",
      "auth": "bearer",
      "protocol": "anthropic-messages",
      "complete": false
    }
  }
}
```

- `endpoint` 是**完整清单 URL**，`baseUrl` 是**推理根 URL**，不要混用；未设置时使用唯一目录端点。
- 凭据从环境变量或 DSH credentials 服务解析，状态中只保存名称；不保存真实密钥。
- `auth`：`bearer`（默认）、`anthropic`（x-api-key）、`none`（明确公开接口，不发送凭据）。带凭据的非 loopback 清单必须 HTTPS。
- `protocol` 留空时，仅能继承唯一现有协议；多协议路由不凭名字猜。OpenAI SDK 不能证明使用 Responses。
- `contextWindow` / `maxTokens` 是用户显式默认值，不是已测模型容量；可用于官方仅返回 ID 的补缺，界面提示此区别。
- `assumeChat` 默认 false：容量和 ID 本身不证明聊天用途；没有明确类型元数据的官方新 ID 进入待确认。只有用户明确确认套餐未知 ID 的聊天用途时才允许 text-only 补缺；明确非聊天类型始终拒绝。
- `complete` 默认 false，完整性未确认也可以使用正向发现，但不能删模型。HTTP Link、has_more、next_cursor 等分页迹象强制降级为部分清单；当前不自动追页。
- `null` 禁用该 route 的官方请求；默认内置表包含 kimi-coding、zai-coding-cn、fireworks、together、Qwen token plan 三路、vercel-ai-gateway。其它 provider 可显式配置，不伪造全覆盖。Azure 的通用模型 ID 不等于 deployment ID，无法从通用数据库证明可用部署。
- models.dev 只在 pi-ai 上游不可用且用户启用备选时读取；它不会覆盖 pi-ai 模型或提供推理可用性保证。

Web API：`GET /plugins/dsh-model-refresh/status`；`POST .../refresh`、`.../config`、`.../route`。POST 必须精确同源 Origin、loopback Host、application/json；64 KiB / 10 秒有界 body。配置使用 `expectedRevision` 乐观锁，避免不同页面覆盖草稿；轮询不覆盖未保存的表单。

## 产物与生效

输出 `<route>.models.json`、`<route>.models.yml`、`<route>.diff.json`；保留原文件名和 models 数组结构，原先引用不需改。

```yaml
opencode-go:
  models: !!js JSON.parse(process.getBuiltinModule("node:fs").readFileSync(process.env.USERPROFILE.replaceAll(String.fromCharCode(92), "/") + "/.dsh/model-refresh/opencode-go.models.json", "utf8")).models
```

该表达式只是原部署的兼容示例，非跨平台 HOME 解析；请按自己的配置位置指定路径。模型目录是 pi-ai 静态 import，产物也不是自动热注册新模型；写盘后设置页提示重启。首次加载插件 → 刷新写目录 → 再加载消费进程，具体次数取决于当前是否已经加载新插件。不会自动重启应用。

Program Files 的权限不足是**可诊断错误**，不是所有写入错误都要提权。设置页只提供独立授权说明/复制命令，不执行命令；请按实际用户权限和授权范围检查。插件不更改 DSH 核心、ASAR、profile 或全局代理。

## 故障恢复边界

- 目录写入前 journal 落在状态目录的 `transactions/`；catalog 已提交但 state 写失败时，下一次恢复根据 before/after hash 补台账；两者都不匹配则保留 journal 报冲突，不覆盖外部修改。
- 状态 `.lock` 从 Host 启动持有到关闭队列完全收敛，正常 dispose 最后释放，防止替代实例与迟到的状态/catalog 写入重叠。进程被强杀或崩溃时，若锁记录 PID 已由系统确证不存在，下一实例会原子归档旧锁为 `.stale-<pid>-<时间>.bak` 后接管；活进程、无法判定 PID、损坏或不可读锁仍 fail-closed，不能在活跃 Host 运行时删除锁。
- 同一安装目录建议只由一个配置状态管理。不同状态目录的多个 Host 不提供全局协调保证；更新/安装 pi-ai 时应停止插件消费者。非合作外部写者的检查与 rename 之间仍存在竞态，文件 API 不提供跨程序原子 CAS；不能声称绝对事务隔离。
- 包或 manifest 修订不变、内容也完全相同的外部同版本重装无法区别所有权；检测到修订变化会保守释放，不删升级模型。
- 旧台账保护/同步冲突需要人工核验，不能静默“清理”。损坏状态保持原文件不覆盖。

## 验证

```text
npm test
npm run build:client
node scripts/smoke.mjs  # 安全别名：运行隔离 Host 场景，不连接真实网络
```

默认测试只用 fixture、fake credentials 和 mkdtemp 隔离目录，不读取真实密钥、不写正式产物或安装树。覆盖主源失败时官方补缺、容量/协议待确认、分页/空清单、错误鉴权、旧数据保护、类型过滤、keep/namespace、宽限删除、同内容上游收录、写前日志恢复、状态迁移、并发去重、Origin/body 安全、dispose、锁释放。

测试 Host controller 的真实文件/HTTP/生命周期路径，但并不等价于真实 Cordis Loader composition 或已加载设置页验收；这两项及真实凭据的官方响应应在明确部署/重载后验证，不把 stub 测试称为已测通生产环境。

历史恢复脚本 `scripts/restore-all.mjs` 属于事故工具，不是测试，不运行它来验证插件。

## 升级与回滚

升级前停止使用同一状态目录和同一 pi-ai catalog 的所有插件消费者，并备份：

- `~/.dsh/model-refresh/state.json`、同目录 transactions 与路由产物；
- 当前插件源码或已安装版本；
- 目标 pi-ai package/version 与 `dist/providers/data/.manifest.json`（若存在）。

从 v1/v2 状态首次迁移到 v3 时，Host 会在首次写入前创建 `state.json.pre-v3-<时间戳>.bak`。回滚到不理解 v3 的旧版本前必须先停止 Host，并人工恢复对应旧状态备份；不能让旧版直接加载 v3 文件。

0.6.2 调整了状态租约生命周期：正常关闭会等待队列收敛后释放；崩溃遗留锁只有在记录 PID 被系统确证不存在时才会被归档接管。不要在活跃 Host 运行时删除 `.lock`。

## HTTP API

设置页使用 loopback Web API：

- `GET /plugins/dsh-model-refresh/status`
- `POST /plugins/dsh-model-refresh/refresh`
- `POST /plugins/dsh-model-refresh/config`
- `POST /plugins/dsh-model-refresh/route`

写操作要求精确同源 loopback Origin、`application/json`、64 KiB 最大请求体和 10 秒读取超时。`config` 支持 `expectedRevision` 乐观锁；第三方调用方不得绕过设置页暴露的安全限制。

## 贡献与安全

- 开发流程与不变量见 [CONTRIBUTING.md](CONTRIBUTING.md)。
- 版本变化见 [CHANGELOG.md](CHANGELOG.md)。
- 漏洞报告与安全边界见 [SECURITY.md](SECURITY.md)。
- 项目使用 [MIT License](LICENSE)。
