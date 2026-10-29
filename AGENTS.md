# dsh-model-refresh 维护说明

## 项目目的

本插件为已配置的 DSH pi-ai 路由注册独立的 `refresh-*` 镜像路由，以更新的 pi-ai 模型目录补齐可由已安装协议驱动处理的模型。它不修改 DSH 安装目录、原 provider 配置或用户默认模型。

## 设计与边界

- 运行时通过宿主公开的 pi-ai/DSH 接口发现已安装 provider 和模型；上游 npm 包只作为经完整性校验的 JSON 数据来源，不执行其代码。
- 每个源路由对应独立、不可变的镜像目录快照。新请求使用刷新后的快照，已准备请求保持旧快照。
- 镜像保留原生协议实现所需的 vendor provider 身份进行派发，但在 DSH 注册和模型选择器中使用 `refresh-*` 身份。
- 只读取源路由的连接事实和凭据引用。镜像不复制请求头、OAuth grant 或原路由模型白名单；镜像凭据存储为只读空实现，写入会明确失败，OAuth-only 路由需要显式 API-key 引用。
- 模型记录中的 `maxTokens` 表示能力上限，不是请求的默认输出上限；不继承源路由逐模型输出覆盖。

## 兼容性与验收

- 当前兼容目标为官方 DSH Core `0.2.1-rc.3` 和 pi-ai `1.2.0`，以宿主实际导出的运行时契约为准。
- 行为修改必须更新离线回归测试与用户文档。常规验证运行 `node scripts/test-all.mjs`、`node scripts/build-client.mjs`、`node scripts/check-manifest.mjs`。
- `scripts/preflight-mirror-core.mjs` 仅用于对目标已安装库进行离线契约核验；实际 Profile 加载、浏览器交互和远端推理需独立验证。
- 不提交凭据、状态文件、安装包、`dist/`、`.work/` 下的本地审查资料或构建产物。
