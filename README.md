# dsh-model-refresh

把「模型目录更新」从等 pi-ai 发版变成插件式定时拉取：从 models.dev（pi-ai
目录数据本身的上游）拉最新数据，与**已安装** pi-ai catalog 做「并集 + 元数据
刷新」合并，产物落到 `~/.dsh/model-refresh/`，接进 `llm-pi-ai` 路由配置；
v0.2 起**自动发现安装目录的全部 provider route**（本机 41 条），把新增模型
和已知模型的元数据一并写进安装树 catalog（已获用户授权），并带设置页
（provider 开关 / 拉取监控 / 代理）。

## 背景（本机取证结论，官方 0.2.0-rc.2 / pi-ai 0.87.1）

- pi-ai 的目录是安装包内静态快照（`dist/providers/data/*.json`，静态 import），
  改安装数据必须重启；
- `llm-pi-ai` route 配置面：`models` 非空整体替换、条目只认
  id/name/contextWindow/maxTokens/input/reasoning 等 route 字段（vendor 级
  `compat` 进配置会报错，2026-10-03 实测）；**安装目录不认识的新 id 无法在
  route 配置里给 `api`**（resolveRouteModels 只看 route 级 api / 安装目录 /
  全目录共享协议，而 opencode-go 是多协议路由）→ 新模型必须进安装树
  catalog 才能干净落地，这正是 v0.2 catalog patch 的依据。

## v0.2 架构

```
lib/index.js        Host：定时刷新 + 代理 fetch + catalog patch + Web 路由
lib/merge.mjs       纯函数合并（已知 id 白名单投影 + 新 id 安全字段）
lib/state.mjs       插件自管状态 ~/.dsh/model-refresh/state.json（原子写）
lib/catalog-patch.mjs 安装树 data JSON 增量合入/回滚（纯函数）
src/client/index.tsx 设置页（React；esbuild 构建 → lib/client.js）
scripts/build-client.mjs 构建（react 保持 external，ModuleLoader wrapper）
```

- **配置与状态**全在 `state.json`（v0.1 的 `config.json` 只作首次种子导入）；
  **routes 自动发现**（`settings.autoDiscover`，默认开）：启动时扫描安装目录
  `data/*.json`，未登记的 provider 追加为 enabled 条目（models.dev 没有的
  自动 skip，只产出安装目录快照）；
- **Web 路由**（设置页数据通道，同源校验）：
  `GET /plugins/dsh-model-refresh/status`、`POST .../refresh`、
  `POST .../config`、`POST .../route`；
- **设置页**：Settings 里的「模型刷新」区 —— 每 provider 开关（禁用即回滚
  catalog patch 并把产物回退为安装目录快照）、拉取监控（lastRun/diff/错误）、
  endpoint / 间隔 / 代理 / patchCatalog / removeStale 开关、立即刷新按钮；
  provider 卡片默认折叠（点头部 ⬇️ 展开详情），授权命令在独立弹窗带复制按钮
  （v0.3）。
- **代理**：`proxyUrl` 经 undici `ProxyAgent`（仅本插件的 fetch，不碰全局）；
  仅 http(s)，拒绝内嵌凭据；
- **catalog patch**（默认开，可在设置页关）：对每个 enabled route 两件事——
  ① 已知模型元数据刷新（name/contextWindow/maxTokens/input/reasoning/cost，
  只刷已有字段、不碰 api/baseUrl/compat 等 vendor 字段，无变化不写盘）；
  ② diff.added 新模型写进对应 wire-protocol 分组（models.dev 无协议字段，
  按 `provider.npm` 线索映射：`@ai-sdk/anthropic`→anthropic-messages、
  `@ai-sdk/openai`→openai-responses、其余→openai-completions），条目只写
  展示/容量/成本字段（不猜 compat）。**命名空间错位防御**：added `org/model`
  与 stale `model`（或 `prefix/org/model`）互为对方时视为 id 体系变更而非新
  模型，跳过不写（cloudflare-ai-gateway 实测两种方向）。台账记录插件写入的
  id，route 禁用或 patchCatalog 关闭时自动回滚。**Program Files 默认不可写**：
  一次性管理员授权（设置页会显示命令）：
  `icacls "C:\Program Files\DSH NEXT\resources\app\node_modules\@earendil-works\pi-ai\dist\providers\data" /grant "*S-1-5-32-545:(OI)(CI)M"`
  pi-ai 整包升级会覆盖该文件（=官方数据回归），插件下一轮刷新重新合入。

## 用法

### 1. 配置

设置页（推荐）或直接编辑 `~/.dsh/model-refresh/state.json`。初始种子可放
插件目录 `config.json`（见 config.example.json；首次启动导入后不再读）。

环境变量：

- `DSH_MODEL_REFRESH_CONFIG` — 种子 config.json 路径（默认插件目录旁）；
- `DSH_MODEL_REFRESH_STATE` — state.json 路径（默认 `~/.dsh/model-refresh/`；测试隔离用）；
- `DSH_PI_AI_DATA_DIR` — 已安装 pi-ai 的 `dist/providers/data` 目录。

### 2. 产物

- `~/.dsh/model-refresh/<route>.models.json` — 完整结果（接线引用的就是它）；
- `~/.dsh/model-refresh/<route>.models.yml` — 可读 YAML 片段；
- `~/.dsh/model-refresh/<route>.diff.json` — added / updated / stale / excluded；
- `~/.dsh/model-refresh/state.json` — 配置 + 监控状态。

### 3. 接线（一次性，人工执行）

在 profile 的 `cordis.patch.yml` 里，把对应 route 的 `models:` 换成引用产物：

```yaml
opencode-go:
  models: !!js JSON.parse(process.getBuiltinModule("node:fs").readFileSync(process.env.USERPROFILE.replaceAll(String.fromCharCode(92), "/") + "/.dsh/model-refresh/opencode-go.models.json", "utf8")).models
```

依据：loader 对 `!!js` 的求值是 `new Function("ctx","with(ctx){return eval(expr)}")`，
ESM 宿主全局无 `require`，用 `process.getBuiltinModule("node:fs")`
（scripts/test-expression.mjs / verify-expression.mjs 验证）。

**生效时机（重要）**：`!!js` 只在 `internal/config` 事件时求值；catalog patch
也因 pi-ai 静态 import 需要重启。因此「新模型真正可用」的路径是：
icacls 授权 → 重启 DSH（插件 v0.2 运行 + patch catalog）→ 再重启一次
（新模型进 catalog 生效）。设置页的 restartRequired 会提示。

## 合并语义

- 已知 id：catalog 为底，models.dev 覆盖 name/contextWindow/maxTokens/input/reasoning；
  产物只投影 route 允许字段（vendor 级字段一律不进）；
- 新 id：models.dev 安全字段 + 容量必须齐全（缺失跳过），catalog patch 用
  完整条目写安装树；
- 上游移除的 id（stale）：默认保留（防抖动），diff 标 `stale`，决定后加进
  `exclude`。设置页**「移除过时模型」开关**（`settings.removeStale`，v0.3）
  打开后：产物剔除 stale（`keep` 白名单豁免），安装目录里的 stale 条目在
  **完整备份到 `state.runtime.catalogRemoved`** 后删除——关开关 / 禁用该
  provider 即从备份逐字段恢复（绝不覆盖现有条目）；与 added 构成命名空间
  对应的 stale 不删（上游换 id 体系，不是真过时）。

## 构建/测试

```
pnpm run build:client     # esbuild + wrapper（react external）
node scripts/test-merge.mjs        # 合并纯函数（固定基线 .orig-opencode-go.json）
node scripts/test-catalog-patch.mjs # patch/回滚/元数据/命名空间防御纯函数
node scripts/smoke.mjs             # stub ctx 冒烟（真实网络拉取，不写安装树）
node scripts/test-expression.mjs   # !!js 求值语义复刻
node scripts/verify-expression.mjs # 对真实产物跑接线表达式
node scripts/test-integration.mjs  # 全链路离线集成（fixture 服务器）
node scripts/restore-all.mjs <data-dir> # 从 npm 原包全量恢复安装树（事故恢复用）
```

**测试纪律（2026-10-03 事故教训）**：任何测试/smoke 进程都不得写安装树——
smoke 与 integration 现固定 `patchCatalog=false` + 隔离 state/临时 data 目录；
只有 Host 进程（安装树授权 + 状态台账）才写 catalog。测试断言的 installed
基线一律用 `.orig-opencode-go.json`（npm 原包提取），不读实时安装树（插件
patch 后"新模型"不再是新模型，断言会漂移）。

## 事故记录（2026-10-03）

- **组重置 bug**：`applyCatalogPatch` 曾用 `!Array.isArray(next[group])` 判断
  wire-protocol 组是否存在——组是对象映射而非数组，条件恒真，**每次 patch
  把整组清空重建**，安装树 opencode-go 一度只剩 26 条。修复为对象形态判断
  （test-catalog-patch 防回归）；
- **测试进程写安装树**：smoke/integration 与 Host 并发写同一文件（各写各的
  中间态，互相覆盖）→ 已按上述测试纪律彻底隔离；
- **污染恢复**：`restore-all.mjs` 从 npm pi-ai 0.87.1 原包恢复全部 41 个
  data 文件 + opencode-go 重新补入 2 个新模型 + state 台账对齐。

## 未验证 / 后续

- [ ] Host 进程内实际运行 v0.2（webServer 路由 key、设置页渲染）—— 重启后验证；
- [x] `!!js` 表达式环境与产物求值（复刻 + 真实产物）；
- [x] 刷新产物后的生效时机：不热生效，需重启；
- [x] Config：v0.2 选择插件自管 state.json（照 grok-kit options 模式），
      未走 schemastery `settings.register`（官方 Plugins 页自动表单）——
      监控 UI 需要自定义组件，schema 表单表达不了，列为一项权衡；
- [ ] routes 的增删目前只能编辑 state.json（设置页只提供开关），后续可加 UI。
