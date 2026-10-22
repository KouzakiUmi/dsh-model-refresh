# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow semantic versioning.

## [Unreleased]

### Fixed

- 写入新版 `chat:<id>` catalog 时保留类型前缀、非聊天条目和未修改协议桶；事务指纹覆盖完整原始文档，拒绝损坏键名而非静默丢弃。新增目录条目显式写入 `type: "chat"`，避免 pi-ai 1.3 的聊天目录读取器忽略新模型。
- 端点清单追加模型时保留隐式目录模型、空数组回退语义与 modelOverrides；去重 ID，拒绝过期配置和提交前动态 models 变更，不凭 reasoning 布尔值猜推理档位。
- 清单请求只使用显式或安装目录的唯一协议端点，不再自动把凭据发送到第三方目录给出的 URL；不按模型 ID 猜聊天用途，不按 provider 名猜失败原因。
- 清单发现加入 Host 串行队列与销毁等待；跨配置入口收集声明，保留有目录所有权或待恢复事务的停用路由，保留 discovered 标记以正确裁剪无关路由。旧状态已丢失来源标记时无法区分手工路由，保守保留而不自动删除。
- 兼容 v1 事务日志省略空协议桶的历史指纹，避免包含非聊天协议桶的目录在升级恢复时误报冲突；未验证候选也纳入模型状态表。
- 修复 provider 切换后旧请求污染新卡片、刷新失败后仍可选择旧清单，以及追加成功提示被后续刷新清空的问题。

### Tests

- 增加隔离 discovery/adopt API 回归，覆盖默认/显式模型保留、覆盖项、并发冲突、鉴权回退、凭据快照、类型判断、namespace 与销毁租约。
- 增加 typed catalog 写入、回滚、事务恢复与非聊天数据外部修改冲突回归，以及真实 React provider-card 交互测试。

## [0.8.7] - 2026-10-21

### Fixed

- 列表端点的鉴权不再从推理协议推导。OpenDesign 以 anthropic-messages 提供推理却拒绝 x-api-key、只接受 Authorization Bearer，按协议推导会一律 401。现在先试协议对应的方式，仅在 401/403 时回退到另一种并采用成功者；404/5xx/网络错误不重试，避免把端点故障误判为凭据问题。
- 响应中带上实际生效的鉴权方式，便于界面与排障时对照。

## [0.8.6] - 2026-10-21

### Fixed

- 凭据解析顺序改为：凭据服务 → 启动器环境快照 → 进程环境。此前只读 `process.env`，而桌面启动器会把用户级环境变量解析进自己的快照，导致 `xiaomi-token-plan-cn` 这类凭据其实已配置却报「凭据未解析到值」。

## [0.8.5] - 2026-10-21

### Fixed

- `settings.models.provider-card` 是 keyed slot，必须按渲染时的 `entryKey`（即 provider 的 `settingsNs`）注册 `options.key`；此前用 `id` 注册导致渲染器抛 `keyed slot requires options.key`，整个模型设置页渲染失败，「从端点获取可用模型」按钮不出现，内置「获取可用模型」仍走宿主静态目录所以看不到新模型。改为按 `llm-pi-ai` 命名空间注册。

## [0.8.4] - 2026-10-21

### Fixed

- `catalog-store.mjs` 里还有第二份目录读取实现，未做键名规范化，导致修复 0.8.1 后仍有 `invalid catalog entry: <api>/chat:<id>` 报错。现在两处读取统一剥离类型前缀并只保留 chat 桶。

## [0.8.3] - 2026-10-21

### Fixed

- 启动时清除仍保有 `discovered` 来源标记、但 profile 从未声明的停用自动发现路由；旧状态若已丢失标记，则无法安全区分手工路由而保留，不会自动猜测后删除。

## [0.8.2] - 2026-10-21

### Fixed

- 刷新轮次同样跳过 profile 未声明且未启用的 provider；已写入 state 的历史路由不再产生无关失败。

## [0.8.1] - 2026-10-21

### Fixed

- 当前 pi-ai 目录把条目键写成 `<kind>:<id>`，插件按 `key === entry.id` 校验导致每个 provider 都报 `invalid catalog entry`。现在读取目录时剥掉类型前缀并只保留 chat 桶。
- 启动时不再扫描 pi-ai 自带的全部目录，只登记 profile 里真正声明过的 provider，避免几十条与用户无关的 per-route 失败。

## [0.8.0] - 2026-10-21

### Added

- 模型设置页每个 provider 卡片新增「从端点获取可用模型」：直接请求该 provider 自己的 listing 端点（tools 自动处理 anthropic x-api-key 与 bearer、`/models` 与 `/v1/models` 双候选），按「非聊天模型」过滤后列成勾选表。
- 新增 `POST /discover` 与 `POST /adopt`：前者只读拉取候选，后者仅把选中模型**追加**进该 provider 的 `models`，不改写或删除已有条目。

### Changed

- 高级设置页更名为「模型刷新（高级）」，检查间隔/代理/catalog 写入/models.dev 备选/移除策略全部折叠，默认不可见。
- 每个路由的八个并列状态列表合并为一张按模型的状态表（可用/新增/待确认/缺失/未验证），原始分类收进「诊断详情」。
- 读屏与文案降噪：移除主界面的长篇免责声明，改为页首一句日常用法说明。

### Fixed

- `perRoute` 只记录模型数量、设置页无法按模型展示状态的问题；现在同时写出 `modelList`。

## [0.7.2] - 2026-10-06

### Fixed

- Read chat models from the nested API protocol buckets in the current pi-ai catalog format; retain support for flat catalogs and include Google Generative AI models.

## [0.7.1] - 2026-10-05

### Changed

- Download and validate the latest published pi-ai npm provider catalog at runtime; show upstream version and cache status in settings.
- Make models.dev an opt-in fallback, disabled by default, and remove LiteLLM code and settings.

## [0.7.0] - 2026-10-04

### Added

- Add manual model creation and editing with explicit protocol, endpoint, capacity, input modalities, reasoning levels, and compatibility settings.
- Preview and apply manual declarations through DSH configEditor, preserving existing models and credentials; support ownership-aware rollback and durable commit recovery.
- Add offline regressions for manual workflows, client interactions, external edits, interrupted commits, source provenance, and simultaneous stale-lease reclamation.

### Fixed

- Merge exact-ID LiteLLM metadata into missing models.dev fields while retaining source provenance.
- Accept text chat models that do not support tool calls.
- Protect migrated legacy model IDs from stale deletion; share ownership-aware leases between Host and catalog transactions and serialize stale reclamation.
- Keep live preflight output in an isolated temporary directory; derive reported plugin version from package metadata.
- Reject stale settings and provider previews rather than overwriting concurrent edits.

## [0.6.2] - 2026-10-03

### Fixed

- Remove LiteLLM fetching, configuration, and the matching test suite.
- Reclaim a stale Host state lease only when the recorded PID is provably dead; archive the old lock before taking ownership.
- Add a synchronous process-exit cleanup fallback for an owned state lease.
- Keep the state lease until queued refresh and catalog work has fully settled during normal disposal, preventing a replacement Host from overlapping late state or catalog writes.
- Register status routes before bootstrap so initialization failures remain observable.

### Tests

- Add dead-owner, live-owner, malformed-lock, reclaim opt-out, idempotent-release, and stale-bootstrap lease coverage.
- Add a cross-instance shutdown regression in which a deliberately non-cooperative fetch ignores cancellation; the replacement lease remains blocked until the old queue settles.

## [0.6.1] - 2026-10-03

### Fixed

- Preserve the status endpoint when bootstrap fails so the settings UI reports the degraded state instead of returning 404.

## [0.6.0] - 2026-10-03

### Changed

- Reworked discovery around independent evidence sources, explicit protocol/capacity requirements, transactional catalog writes, ownership-aware rollback, and conservative stale removal.

[Unreleased]: https://github.com/KouzakiUmi/dsh-model-refresh/compare/v0.7.2...HEAD
[0.7.2]: https://github.com/KouzakiUmi/dsh-model-refresh/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/KouzakiUmi/dsh-model-refresh/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/KouzakiUmi/dsh-model-refresh/compare/v0.6.10...v0.7.0
[0.6.2]: https://github.com/KouzakiUmi/dsh-model-refresh/compare/ac1ba92...v0.6.2
[0.6.1]: https://github.com/KouzakiUmi/dsh-model-refresh/commit/ac1ba92
[0.6.0]: https://github.com/KouzakiUmi/dsh-model-refresh/commit/ce77159
