# 从端点获取可用模型 —— 设计文档

> 状态：DRAFT，未来增强提案；下文不是当前版本已实现或已实测能力清单。
> 目标版本：0.9.0
> 相关代码：`lib/index.js` 的 `discoverProvider` / `adoptModels`，`src/client/index.tsx` 的 `ProviderFetch`
>
> 当前实现与提案的区别：只采用配置或安装目录中明确的协议/端点，不以 models.dev 给出的 URL 作为携带凭据的请求目标；不按 ID 猜模型类型，不把 reasoning 布尔值扩展为固定档位。候选元数据只展示端点明确返回的字段，尚未实现下文的第三方容量补全、来源字段、发布日期排序与控制面适配。追加请求必须携带发现结果的 `profileHash`，配置已变化则拒绝；隐式目录模型和 modelOverrides 会先保留到显式列表。按钮当前仅注册默认 `llm-pi-ai` namespace。以下历史端点样本和未来方案仍需单独验证，不表示当前运行环境已测通。

## 1. 问题陈述

设置页「获取可用模型」按钮由宿主 `dsh-llm-pi-ai` 提供，其行为是：

```js
async function discoverModels(request) {
  if (request.provider !== undefined) {
    const installed = catalogModels(request.provider);
    if (installed.size > 0) return [...installed.values()];   // 命中即返回静态目录
  }
  // 只有目录里没有的 provider 才真的发网络请求
}
```

因此对 pi-ai 内置目录覆盖到的 provider（minimax-cn、kimi-coding、opencode-go、xiaomi-*），按钮永远返回打包时冻结的快照，`.html` 意义上的"最新"无从谈起。pi-ai 1.3.0（当前 DSH 内置版本）的 `minimax-cn.json` 只有 3 个模型，而厂商端点返回 9 个。

本插件新增的"从端点获取可用模型"绕开该短路，直接向 provider 自己的 listing 端点取数据，再把用户勾选的模型**追加**进 `cordis.patch.yml` 的 provider 配置。

## 2. 范围

### 2.1 在范围内

- 读取一个**已配置** provider 的模型清单
- 把选中模型追加进该 provider 的 `models` 数组
- 展示每个候选的容量、输入模态、推理档位、数据来源
- 区分失败原因（端点不支持列表 / 凭据无效 / 网络错误 / 清单为空）

### 2.2 不在范围内

- 改写 pi-ai 安装目录（`app.asar` 内只读，此路不通）
- 自动删除已配置模型
- 发送任何推理请求（只调 `/models`）
- 为未配置的 provider 创建配置（用设置页已有的"添加 provider"）

## 3. 设计原则

四条硬约束，任何实现都必须满足：

**P1 有据可依，不猜**
每个取值必须来自明确的、可核验的来源。没有来源就记为「未知」并在界面标出，不允许用启发式规则（例如"变量名等于 provider 名大写加 _API_KEY"）填充。

**P2 来源可追溯**
界面要能回答"这个数字是哪来的"。候选行标注容量来源：端点 / models.dev / 目录 / 未知。

**P3 只追加，不破坏**
写入操作只能往 `models` 尾部追加新 id。已存在的 id 跳过，不覆盖、不删除、不重排。

**P4 失败要说清楚**
四类失败分别报，不合并成"拉取失败"：
- 端点不提供模型列表（404/405）
- 凭据无效或被拒（401/403）
- 网络/代理/超时
- 端点返回空清单或格式不可解析

## 4. 数据来源矩阵

每一行是 discovery 需要的一个信息维度，列出可用来源及优先级。

| 维度 | 优先级 1 | 优先级 2 | 优先级 3 | 无从得知时 |
|---|---|---|---|---|
| baseURL | `cordis.patch.yml` 的 `providers[route].baseURL` | pi-ai catalog 数据文件里的 `baseUrl`（唯一时） | pi-ai provider 表的 `defaultBaseURL` | 报错：该 provider 无端点 |
| 推理协议 | 配置 `api` | catalog 条目 `api` | models.dev `npm` 推断 | 报错 |
| 凭据引用名 | 配置 `apiKeyEnv` | — | — | 报错：请在配置中补 `apiKeyEnv` |
| 凭据值 | `ctx.credentials.resolve(credentialRef(name))` | `launchEnvironmentOf(ctx).get(name)?.value` | `process.env[name]` | 报错：凭据未解析 |
| 鉴权头 | 对 `/models` 逐次尝试 Bearer → x-api-key，采用第一个 200 | — | — | 报错：凭据被拒 |
| 列表路径 | `{base}/models` | `{base}/v1/models` | `{root}/v1/models`（anthropic 语义） | 报错：端点不支持列表 |
| 模型容量 | 端点返回的 `context_limit` / `output_budget` / `limit.*` | models.dev `limit.context` / `limit.output` | catalog 条目的 `contextWindow` / `maxTokens` | 留空并标注「需手工确认」 |
| 输入模态 | 端点 `architecture.input_modalities` | models.dev `modalities.input` | catalog `input` | 默认 `[text]` |
| 是否聊天模型 | 端点 `type` / `mode` | models.dev `output` 不含 text 即排除 | id 含 tts/asr/embedding 等即排除 | 视为候选，标注「类型未知」 |
| 推理档位 | 端点 `reasoning_options` | models.dev `reasoning_options` | catalog `thinkingLevelMap` | 不声明 `reasoningEfforts` |
| 弃用标记 | models.dev `status === "deprecated"` | — | — | 视为可用 |

### 4.1 凭据引用的契约（已核实）

来自 `@deepseek-ai/dsh-credentials`：

```js
const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
function credentialRef(value) {           // 校验失败抛 TypeError
  if (!isCredentialRefName(value)) throw new TypeError(...);
  return brandString(value);
}
function isCredentialRefName(value) { return REF_PATTERN.test(value); }
```

因此解析顺序必须是：先 `isCredentialRefName` 探测 → 通过才 `credentialRef` → 再 `resolve`。

### 4.2 参考实现（已核实）

`dsh-subusage` v0.14.3 的凭据解析（`lib/index.js:1194-1198`）：

```js
import { credentialKey, credentialRef, isCredentialRefName } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";

this.credentialByName = async refName =>
  await ctx.get("credentials")?.resolve(credentialRef(refName));
this.environmentByName = refName => launchEnvironmentOf(ctx).get(refName);
```

要点：
1. ref 必须先过 `credentialRef()`，不能把裸字符串交给 `resolve`
2. 环境值走 `launchEnvironmentOf(ctx)` 的快照，不是 `process.env`
3. `apiKeyEnv` 的语义就是「凭据引用名」，走同一条通道

### 4.3 关于 models.dev 的 `env` 字段

models.dev 对 `minimax-cn` 给出 `env: ["MINIMAX_API_KEY"]`，但官方文档（[MiniMax 前置准备](https://platform.minimax.cn/docs/guides/quickstart-preparation)）对三种 SDK 给出三个不同变量名：

- Anthropic 兼容：`ANTHROPIC_API_KEY`（官方推荐）
- OpenAI 兼容：`OPENAI_API_KEY`
- AI SDK：`MINIMAX_API_KEY`

**结论：`env` 只是某个接入方式的名字，不能作为凭据名来源。** 凭据名一律取用户配置的 `apiKeyEnv`。

## 5. 流程

```
POST /plugins/dsh-model-refresh/discover { route }
  │
  ├─1 读 provider 配置：configEditor.entries() → 找 llm-pi-ai → providers[route]
  │     不存在 → 400「该 provider 尚未在配置中声明」
  │
  ├─2 解析 baseURL（矩阵第 1 行）
  │     全都取不到 → 400「该 provider 无可用端点」
  │
  ├─3 解析凭据
  │     apiKeyEnv 缺失 → 400「请在配置中补 apiKeyEnv」
  │     isCredentialRefName 不通过 → 400「apiKeyEnv 不是合法引用名」
  │     解析为空 → 400「凭据 <name> 未解析到值」
  │
  ├─4 拉列表：逐 (鉴权头 × 路径) 组合尝试
  │     200 且可解析 → 进入第 5 步
  │     全部 401/403 → 502「凭据被拒绝」
  │     全部 404/405 → 502「该端点不提供模型列表」
  │     其他 → 502「网络错误：<原始信息>」
  │
  ├─5 归一化：把各家不同的字段形状映射成统一候选结构
  │
  ├─6 enrich：容量/模态/档位按矩阵回填，记录每字段来源
  │
  ├─7 过滤：非聊天模型、models.dev 标 deprecated、已配置的置灰
  │
  └─8 排序：release_date 倒序 → 未配置优先 → id 字典序
```

## 6. 接口契约

### 6.1 `POST /discover`

请求：

```jsonc
{ "route": "minimax-cn", "namespace": "llm-pi-ai" }   // namespace 可省略
```

响应：

```jsonc
{
  "route": "minimax-cn",
  "baseURL": "https://api.minimaxi.com/anthropic",
  "endpoint": "https://api.minimaxi.com/anthropic/v1/models",
  "auth": "bearer",                  // 实际成功的鉴权方式
  "fetchedAt": "2026-10-21T02:40:00.000Z",
  "partial": false,
  "configured": ["MiniMax-M3.1-Flash"],
  "candidates": [
    {
      "id": "MiniMax-M3",
      "name": "MiniMax-M3",
      "contextWindow": 1000000,
      "maxTokens": 524288,
      "capacitySource": "models.dev",   // endpoint | models.dev | catalog | unknown
      "input": ["text", "image"],
      "reasoning": true,
      "deprecated": false,
      "configured": false
    }
  ],
  "filtered": [ { "id": "mimo-v2.5-tts", "reason": "非聊天模型" } ]
}
```

### 6.2 `POST /adopt`

请求：

```jsonc
{
  "route": "minimax-cn",
  "namespace": "llm-pi-ai",
  "ids": ["MiniMax-M3"],
  "params": { "MiniMax-M3": { "contextWindow": 1000000, "maxTokens": 524288 } }
}
```

响应：

```jsonc
{ "adopted": ["MiniMax-M3"], "skipped": ["MiniMax-M3.1-Flash"], "status": { ... } }
```

写入语义：仅追加，已存在 id 跳过；写前校验 `models` 是静态数组；通过 `configEditor.edit()` 提交，由 Loader 验证与应用。

## 7. 候选归一化对照

不同端点的字段形状差异（实测）：

| 端点 | 形状 | 容量字段 |
|---|---|---|
| MiniMax `/anthropic/v1/models` | `{data:[{id,type,display_name,created_at}]}` | **无** |
| OpenDesign `/v1/models` | `{data:[{id,architecture,metadata}]}` | `metadata.context_limit` / `metadata.output_budget` |
| OpenCode `/v1/models` | `{object,list,data:[{id,object,created,owned_by}]}` | **无** |
| 小米 `/v1/models` | `{data:[{id,...}]}` | 待核实 |
| UniRouter `/v1/models` | `{object,list,data:[{id,object,created,owned_by,supported_endpoint_types}]}` | **无** |

因此容量普遍要从 models.dev 补；只有 OpenDesign 类网关自带。

## 8. 已知限制

1. **models.dev 未收录的 provider 无法补容量**（opendesign、arkcli-*）。这些 provider 的候选会显示「容量未知」，用户需在设置页手工填，或接受 DSH 的默认回退（262144 / 32768）。
2. **端点清单不等于套餐清单**。UniRouter 返回 265 个模型，含大量 `:free` 与非本套餐条目。插件不做套餐归属判断，只在 UI 里提供搜索与「已配置」标记。
3. **不判断推理是否真的可用**。`/models` 返回 200 只证明该 id 存在于网关目录。
4. **DSH 升级会覆盖插件**（它是 profile 依赖，升级后需重装，这是 DSH 插件管理的正常行为）。

## 9. 与宿主「获取可用模型」的关系

两个按钮并存，语义不同：

| 按钮 | 来源 | 适用 |
|---|---|---|
| 宿主自带「获取可用模型」 | pi-ai 目录（对目录内 provider 短路） | 目录覆盖充分的 provider |
| 插件「从端点获取可用模型」 | 厂商端点 + models.dev 补全 | 目录落后、或需要容量补全时 |

本插件不替换、不遮蔽宿主按钮。

## 10. 实施计划

| 步骤 | 产出 | 验证方式 |
|---|---|---|
| 1 | `lib/discovery.mjs`：纯函数，输入配置+catalog+models.dev，输出归一化候选 | 单测覆盖 5 种端点形状 |
| 2 | 接进 `discoverProvider`，替换现有内联逻辑 | 用 8 个真实 provider 跑一遍 |
| 3 | UI 展示 `capacitySource`、错误分类 | 手动点击验证 |
| 4 | 补 `kimi-coding` / `opencode-go` 的 `apiKeyEnv` | 配置侧改动，需用户确认 |

## 11. 待决问题

1. `archcli-*` 两个火山方舟套餐的列表端点是否可访问，需实测确认。
2. 小米 `token-plan-cn.xiaomimimo.com/v1/models` 的字段形状需抓一次确认。
3. 是否要在 UI 中提供「批量勾选未配置」以外的排序（按容量、按新旧）。
