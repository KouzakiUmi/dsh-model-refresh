# 动态目录镜像 provider 设计

> 本文记录当前已实现的镜像方案，不满足后续明确的“同 provider、原列表只补新增模型”目标。优化提案见[同 provider 增量模型补齐](in-place-model-supplement-design.md)；该提案尚未实施。

## 目标与非目标

目标：在 DSH 内置 pi-ai 版本不变时，动态提供同一服务商的新聊天模型数据，覆盖“目录冻结但已有协议驱动仍可服务”的情况。

不做：修改核心或安装目录、替换原路由、自动迁移默认模型、下载执行最新 npm 代码、复制 OAuth grant、证明远端模型已可推理。

## 组件与所有权

| 组件 | 职责 |
|---|---|
| [pi-ai-upstream.mjs](../lib/pi-ai-upstream.mjs) | 获取并校验 npm 数据包，保存完整记录及兼容投影；严格区分完整缓存与旧投影缓存 |
| [mirror-catalog.mjs](../lib/mirror-catalog.mjs) | 纯函数：旧目录 + 上游记录 + 官方证据 → 完整运行时模型与诊断 |
| [mirror-provider.mjs](../lib/mirror-provider.mjs) | 纯结构工厂：独立 provider 身份、快照目录、原生流式委托、API-key 桥接和 adapter profile |
| [mirror-host.mjs](../lib/mirror-host.mjs) | 源路由只读发现、凭据解析、刷新队列、注册替换、同源 HTTP 与生命周期 |
| [index.js](../lib/index.js) | `apply()` 注入 llm 并启动镜像 Host；保留旧 createHost 给迁移回归工具 |
| [Client](../src/client/index.tsx) | 镜像开关、源/目标路由、实际注册状态、数据源和 pending 原因 |

插件只拥有 `refresh-*` 注册项与自己的状态/缓存。不拥有源路由、已安装 provider、原 provider 凭据记录或用户默认模型。

## 数据流与原子性

1. 从消费 DSH 入口解析真实 `dsh-llm-pi-ai`，再从该 adapter 的查找路径解析其 pi-ai。import-only 子路径严格按 manifest 公共导出加载，不猜测私有 dist 入口，不使用插件自带的第二份宿主包。
2. 只读收集各 `llm-pi-ai` 配置入口声明的连接信息；同名路由跨 namespace 不唯一时拒绝猜选。
3. 安装目录基线通过公共 `builtinProviders()`、`getBuiltinModels()` 获取。
4. 后台下载上游 JSON 数据；网络失败时沿用经过验证的完整缓存。没有完整证据时只能保留已安装模型，不能把旧投影伪装成完整驱动数据。
5. 每个源路由独立构建完整快照。新 ID 的协议须在该原生 provider 的已安装模型 API 集合中，缺少必要数据则 pending。已接受历史记录保存在自有状态中，并重新校验/按当前原生 API 白名单过滤；即使上游漏项或重启也能保留新模型，排除/移除不销毁历史数据。
6. 重写目录中的 provider 身份，选择可信端点，合并适用的连接兼容设置；原 models 白名单不作为镜像白名单。调用原生 stream/deferred 时克隆模型并恢复 baseProvider.id，保留原生服务商判断及 replay 身份；注册/认证阶段仍保持镜像身份。
7. 用新 Map 发布 profiles，并通过 adapter 注册句柄更新插件拥有的路由。发生注册冲突时不覆盖他人；旧 Map 在失败时保留。
8. 已准备请求持有旧 Map/Models，下一次请求使用新 Map。选择器查询不触发上游网络 I/O。

## 安全与降级

- npm tarball 与 provider 文件双层完整性核对；只读 JSON，不执行远程代码。
- 上游任意 headers 不进入镜像请求。凭据使用当前源连接的引用，值只存在请求路径内，状态/前端只含诊断。
- source baseURL、安装目录同协议端点优先；官方 listing endpoint 不能被当作推理地址。models.dev 不能指定请求目标。
- 官方核对失败/部分页不能产生负证据。仅完整权威清单连续缺失并经过宽限期才移除镜像投影；原目录永不删除。
- 配置缺失、未知驱动协议、OAuth-only 无显式 key、路由冲突分别按源路由诊断；不冒称已注册。
- 普通配置保存有 settingsRevision 乐观锁；队列串行、刷新合并，dispose 先撤销注册/取消请求并等待队列收敛，最后释放状态租约。
- 旧 catalog 台账与事务只警告，不自动清除或恢复。需要旧版恢复时独立执行，不能让一次插件升级隐含写安装目录。

## 验收矩阵

| 层级 | 必须覆盖 |
|---|---|
| 数据/缓存 fixture | 嵌套 catalog、完整 compat/thinkingLevelMap/inputLimits/cost 保真、旧缓存降级、不可信缓存、校验失败与离线缓存 |
| 镜像纯函数 | 新增/同 ID 更新、旧模型保留、未知协议 pending、端点优先级、命名空间、keep/exclude、官方未验证、完整性/连续观察/宽限期 |
| provider fixture | 不可变快照、原生 stream 委托、API-key 结构、可选 deferred 请求委托、禁止刷新/登录目录操作 |
| Host fixture | 原 provider 不变、独立注册/冲突/禁用/销毁、metadata 不泄密、无 catalog/profile/artifact 写入、配置并发、错误可见性、租约收敛 |
| React fixture | 唯一 settings.section、源→目标路由、registered 三态、开关请求、无旧授权/重启/追加入口、草稿保护 |
| 已安装库离线合同 | 真实 PiAiAdapter 的模型元数据、推理档位、profiles 代际、认证桥接、流式转换和 attribution headers；不挂载、不推理 |
| 后续运行验收 | 目标 Profile 中真实装载、页面/选择器更新、远端多轮工具/推理/附件；需独立环境与授权，离线测试不替代 |

对应入口：[test-all.mjs](../scripts/test-all.mjs)、[preflight-mirror-core.mjs](../scripts/preflight-mirror-core.mjs)。
