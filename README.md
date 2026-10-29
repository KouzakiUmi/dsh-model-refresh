# dsh-model-refresh

开发中：**动态目录镜像 provider**。解决 DSH 内置 pi-ai 版本固定、模型目录落后，导致新模型无法出现在选择器中的问题。

插件不升级或修改 pi-ai 代码，不写安装目录，不修改原 provider 配置。它读取最新 pi-ai 的模型数据，为已配置的服务商提供独立的 `refresh-*` 路由：

```text
opencode-go  → refresh-opencode-go
kimi-coding  → refresh-kimi-coding
minimax-cn   → refresh-minimax-cn
```

镜像包含完整的旧模型与兼容新模型，而不只是新增 ID。原 provider、旧会话和默认选择不变；使用镜像需要在 DSH 模型选择器中主动选择对应的新路由。

## 运行方式

```text
已安装 pi-ai：公共模型目录 + provider 协议实现
                           │
最新 pi-ai npm JSON ──> 完整模型快照 ──> 独立 mirror provider
官方 /models（可选） ──> 可用性证据              │
原路由连接配置 ─────────────────────> PiAiAdapter
                                              │
                                   DSH LLM registry / 选择器
```

- 通过公共 `builtinProviders()` / `getBuiltinModels()` 获取已安装 provider 与模型，不解析安装目录文件。
- npm 包只作为 JSON 数据来源：校验 tarball 完整性和 provider 文件散列，不执行下载的代码。
- 新版缓存保留 `api`、`compat`、`thinkingLevelMap`、`inputLimits`、`cost` 等完整模型字段。旧投影缓存只可用于诊断，不能假装能驱动新模型推理。
- 原路由的端点、凭据引用、请求头及适用的兼容设置在内存中继承；凭据值不写状态或返回前端。显式凭据按 credentials 服务、启动环境快照、进程环境顺序解析。
- 刷新构造新 profiles 快照。新请求使用新快照，已准备的请求仍持有旧快照；不需要为模型数据刷新重启 Host。已打开的模型选择器可能需要重新打开才能重新查询目录。
- 已接受的完整模型记录以数据形式保存在插件自己的状态中（无请求头、凭据和源连接覆盖），新模型不会因上游暂时漏项或插件重启就消失；禁用/排除/移除只改变投影。
- DSH 注册与认证使用 `refresh-*` 身份；委托给原生协议驱动时恢复原 provider ID，保留服务商特有的请求和历史回放分支。
- 禁用镜像立即撤销该独立路由；卸载只撤销插件拥有的注册项，原 provider 不变。

## 使用

通过目标 DSH 支持的插件管理入口加载 bundle。一般 CLI 示例（`web` 仅为示例 Profile，不代表实际安装目标）：

```sh
dsh plugin --profile web add <local-directory-or-package-spec>
```

源码开发目录需要先完成依赖准备及 Client 构建；安装、重载与运行验证是独立步骤。不要手工覆盖 ASAR、核心包或 Profile 的依赖文件。

加载后：

1. 保持原 `llm-pi-ai` provider 已配置，作为镜像的连接信息来源。
2. 打开“模型刷新（高级）”，为需要的源路由开启“动态镜像”。自动发现的新路由默认关闭。
3. 刷新后查看 `源路由 → 镜像路由`、注册状态与待确认原因。
4. 在 DSH 模型选择器选择 `refresh-*` provider。选择器可见不代表套餐权限、工具调用或远端推理已经验证。

首次 seed 见 [config.example.json](config.example.json)。状态与缓存默认写入插件自己的目录：

```text
~/.dsh/model-refresh/state.json
~/.dsh/model-refresh/pi-ai-upstream.json
```

环境变量 `DSH_MODEL_REFRESH_STATE` 可指定状态文件，`DSH_MODEL_REFRESH_CONFIG` 可指定 seed。镜像 Host 不使用旧的 `DSH_PI_AI_DATA_DIR` 或 YAML 产物接线。

## 支持范围与保守规则

**更新目录不等于更新驱动代码。** 新模型使用原 provider 已支持的协议时，可以交给旧驱动；需要新协议或新驱动行为时必须升级 pi-ai / DSH，插件不会下载执行新实现。

- 只镜像已配置且在已安装 pi-ai 中存在实现的 provider；自定义别名可在 seed 的 route 条目中通过 `as` 映射到原生 provider。
- 只读取原路由的连接事实，不继承它的 `models` 白名单或 `modelOverrides`，避免旧白名单继续屏蔽新模型。自定义协议覆盖仅限已有同协议基线，不自动切换协议。
- 目录 `maxTokens` 仅表示模型输出容量，不自动成为请求的输出默认值；镜像不继承源路由的逐模型输出覆盖。完整目录中不能共同支持的原路由默认推理档位不会被继承；逐模型档位仍来自模型数据。
- 镜像显式注入无持久化凭据存储：读取为空，写入或删除明确报错，不提供登录及 grant 刷新功能。原路由的 OAuth grant 不会隐式复制到新路由。OAuth-only provider 需要显式 API-key 引用才能在此版本镜像，否则给出诊断；原生 API-key 环境发现仍使用宿主认证上下文。
- 缺少聊天用途、容量、输入模态、协议或可信端点的新候选进入待确认；不按 ID 或邻居猜字段。未知协议候选标记需要升级 pi-ai。
- 原连接 `baseURL` 优先，其次已安装目录的协议端点，最后才是经过完整性核验的 pi-ai 数据端点；models.dev 不能决定携带凭据的请求目标。上游任意请求头不进入运行时模型。
- pi-ai 上游是主源；models.dev 仅作为默认关闭的降级数据源，不能提供缺少完整协议描述的新模型推理能力。
- 官方清单只提供存在性/可用性证据。配置了官方核对但请求失败时，新候选保留为待确认；已有模型仍可保留。
- 移除只影响镜像投影，不删除原模型。需要显式完整官方清单、连续缺失确认和宽限期；分页、失败、缺凭据、部分清单会中断缺失观察。`keep` / `exclude` 仍然生效。

## 从旧版迁移

生产 `apply()` 已切换到镜像 Host。设置页不再提供安装目录写入授权、目录重启提示、手动创建通用 provider 或向原路由追加模型入口。

旧 catalog、原路由中已经应用的配置、所有权台账和事务日志**不会被新版自动删除、覆盖或恢复**。检测到旧记录时仅显示警告。需要恢复时先使用与原记录匹配的旧版显式恢复流程，并核对所有权/冲突；不要直接删除旧状态文件。旧 `createHost()` 与相关恢复模块暂时保留用于迁移工具和回归测试，不是生产默认入口。

## 兼容性与验证

当前低层适配器合同针对[官方 dsh-v0.2.1-rc.3 源码](https://github.com/deepseek-ai/deepseek-harness/tree/1f81c047fc48fa190a683e469daa699857e9afe8)中的 `@deepseek-ai/dsh-llm` / `dsh-llm-pi-ai` 等 **Core 包 0.2.1-rc.3** 核对，pi-ai peer 固定为 **1.2.0**（官方适配器依赖范围为 `^1.1.0`）；不是桌面壳版本声明。manifest 使用窄 peer 范围，`optional` 元数据仅避免包管理器自动安装另一份宿主包，功能运行时仍要求宿主提供这些包。其它版本需要重新运行契约测试后调整兼容声明。

项目依赖准备好后，开发验证：

```sh
node scripts/test-all.mjs
node scripts/build-client.mjs
node scripts/check-manifest.mjs
```

真实安装库的离线合同核验（普通文件使用支持目标版本的 Node；ASAR 内库使用目标安装包支持的 Node/归档加载入口）：

```sh
node scripts/preflight-mirror-core.mjs <installed-DSH-entry-or-dsh-llm-pi-ai/lib/index.js>
```

此核验不挂载插件、不发网络请求、不读取真实凭据，使用假 provider 事件检查实际 `PiAiAdapter` 的元数据、认证桥接、快照和流式转换。它不替代实际 Profile 加载、浏览器交互及远端模型测试。

架构与验收矩阵见 [镜像设计](docs/mirror-provider-design.md)。旧端点追加提案 [discovery-design.md](docs/discovery-design.md) 属于历史路线，不是当前镜像方案。

## 贡献与安全

见 [CONTRIBUTING.md](CONTRIBUTING.md)、[CHANGELOG.md](CHANGELOG.md)、[SECURITY.md](SECURITY.md) 和 [MIT License](LICENSE)。
