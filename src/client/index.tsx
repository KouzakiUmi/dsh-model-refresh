//
// dsh-model-refresh —— 浏览器设置页（模型刷新）。
//
// 照 dsh-grok-kit / dsh-xai 的模式：settings.section slot 注册独立设置区，
// 数据经同源 Web 路由 /plugins/dsh-model-refresh/* 与 Host 通信。
//
// 布局约定（2026-10-03 用户要求）：
//   - 每个 provider 默认折叠，点头部 ⬇️ 展开模型详情；开关在折叠态可直接用；
//   - 授权命令独立弹窗 + 复制按钮，不与页面说明文字混排。
//
import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'

const BASE = '/plugins/dsh-model-refresh'

type RouteStatus = {
  route: string
  as?: string
  enabled: boolean
  keep: string[]
  exclude: string[]
  // runtime 部分（可能缺失）
  fetchedAt?: string
  installedAt?: string | null
  source?: string // 'models.dev' | 'litellm' | 'none'
  official?: string // 'verified' | 'no-key' | 'failed' | 'unconfigured'
  officialAdded?: string[] // 官方接口补缺（目录与上游全无）
  models?: number
  added?: string[]
  updated?: string[]
  stale?: string[]
  excluded?: string[]
  unverified?: string[] // 官方接口核对剔除的"新增"
}

type Status = {
  version: number
  running: boolean
  lastRun: string | null
  lastError: string | null
  restartRequired: boolean
  catalogWritable: boolean | null
  catalogGrantCommand: string | null
  catalogGrantNote: string | null
  settings: {
    endpoint: string
    intervalMinutes: number
    proxyUrl: string
    patchCatalog: boolean
    removeStale: boolean
    litellmEnabled: boolean
    officialVerify: boolean
    proxyConfigured: boolean
    outputDir?: string
  }
  routes: RouteStatus[]
}

const box: CSSProperties = {
  border: '1px solid var(--dsh-border, #333)',
  borderRadius: 8,
  padding: '12px 14px',
  marginBottom: 10,
}
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }
const muted: CSSProperties = { opacity: 0.65, fontSize: 12 }
const input: CSSProperties = {
  padding: '4px 8px',
  borderRadius: 6,
  border: '1px solid var(--dsh-border, #333)',
  background: 'transparent',
  color: 'inherit',
  minWidth: 240,
}
const button: CSSProperties = { padding: '4px 14px', borderRadius: 6, cursor: 'pointer' }
const codeBlock: CSSProperties = {
  display: 'block',
  padding: '10px 12px',
  borderRadius: 6,
  border: '1px solid var(--dsh-border, #333)',
  background: 'rgba(127,127,127,0.12)',
  fontFamily: 'ui-monospace, Consolas, monospace',
  fontSize: 13,
  wordBreak: 'break-all',
  userSelect: 'all',
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return res.json() as Promise<T>
}

async function postJson(path: string, body: unknown): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok && res.status !== 202) throw new Error(`${path}: ${res.status}`)
}

function fmtTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText !== undefined) return navigator.clipboard.writeText(text)
  // 非 https / 旧环境的回退
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy') ? resolve() : reject(new Error('copy failed'))
    } catch (e) {
      reject(e)
    } finally {
      ta.remove()
    }
  })
}

/** 授权命令弹窗：说明 + 命令 + 复制按钮，独立于页面正文。 */
function GrantDialog(props: { command: string; note: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const doCopy = async (): Promise<void> => {
    try {
      await copyText(props.command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch (_e) {
      // 复制失败时 code 块的 userSelect:all 保底可手动 Ctrl+C
    }
  }
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={props.onClose}
    >
      <div
        style={{
          ...box, maxWidth: 560, width: '92%', marginBottom: 0,
          background: 'var(--dsh-bg, #1e1e1e)', padding: 18,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ ...row, justifyContent: 'space-between' }}>
          <strong>一次性管理员授权</strong>
          <button style={button} onClick={props.onClose}>关闭</button>
        </div>
        <p style={{ fontSize: 13, opacity: 0.85 }}>
          以<strong>管理员身份</strong>打开 PowerShell，粘贴下面的命令并回车（运行一次即可）。
        </p>
        <code style={codeBlock}>{props.command}</code>
        <div style={{ ...row, marginTop: 10 }}>
          <button style={{ ...button, fontWeight: 600 }} onClick={() => void doCopy()}>
            {copied ? '✓ 已复制' : '复制命令'}
          </button>
          <span style={muted}>命令基于真实安装路径；SID 545 是内置 Users 组，各语言系统通用。</span>
        </div>
        <p style={{ ...muted, marginTop: 10, lineHeight: 1.6 }}>{props.note}</p>
      </div>
    </div>
  )
}

/** 单个 provider 卡片：默认折叠，点头部展开模型详情。 */
function RouteCard(props: {
  r: RouteStatus
  busy: boolean
  expanded: boolean
  onToggle: () => void
  onEnable: (enabled: boolean) => void
}) {
  const { r, busy, expanded } = props
  const badgeStyle: CSSProperties = {
    fontSize: 11, padding: '1px 8px', borderRadius: 999,
    border: '1px solid var(--dsh-border, #333)', opacity: 0.9,
  }
  const sourceBadge = (() => {
    if (r.source === 'models.dev') {
      return <span style={{ ...badgeStyle, opacity: 0.7 }}>models.dev</span>
    }
    if (r.source === 'litellm') {
      return <span style={{ ...badgeStyle, borderColor: '#3b82f6', color: '#3b82f6' }}>LiteLLM 补</span>
    }
    if (r.source === 'none') {
      return <span style={{ ...badgeStyle, borderColor: '#b8860b', color: '#b8860b' }}>无上游数据源</span>
    }
    return null
  })()
  const officialBadge = (() => {
    if (r.official === 'verified') {
      return <span style={{ ...badgeStyle, borderColor: '#22c55e', color: '#22c55e' }}>官方已核对</span>
    }
    if (r.official === 'no-key' || r.official === 'failed') {
      return <span style={{ ...badgeStyle, borderColor: '#b8860b', color: '#b8860b' }}>
        官方未核对{r.official === 'no-key' ? '（缺 key）' : '（拉取失败）'}
      </span>
    }
    return null
  })()
  return (
    <div style={box}>
      <div
        style={{ ...row, cursor: 'pointer', userSelect: 'none' }}
        onClick={props.onToggle}
        role="button"
        aria-expanded={expanded}
      >
        <span style={{ fontSize: 12, width: 16 }}>{expanded ? '⬆️' : '⬇️'}</span>
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}
          onClick={(e) => e.stopPropagation()} // 点开关不触发折叠
        >
          <input
            type="checkbox"
            checked={r.enabled}
            disabled={busy}
            onChange={(e) => props.onEnable(e.target.checked)}
          />
          {r.route}
        </label>
        {sourceBadge}
        {officialBadge}
        {r.models !== undefined && <span style={{ fontSize: 13 }}>{r.models} 个模型</span>}
        {!r.enabled && <span style={{ ...muted, color: '#b8860b' }}>已停用</span>}
        <span style={muted}>数据时间：{fmtTime(r.fetchedAt)}</span>
      </div>
      {expanded && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--dsh-border, #333)' }}>
          {r.source === 'none' && (
            <div style={{ ...muted, marginBottom: 6 }}>
              models.dev 与 LiteLLM 均无此 provider 的数据：只显示安装目录快照，不做上游合并
              （该 provider 无公开数据源，等 pi-ai 整包升级）。
            </div>
          )}
          {r.added !== undefined ? (
            <div style={{ fontSize: 13, lineHeight: 1.9 }}>
              {(r.officialAdded?.length ?? 0) > 0 && (
                <div style={{ color: '#22c55e' }}>
                  官方接口补缺 {r.officialAdded?.length}（目录与所有上游都没有，按官方 /models 加入）：
                  <span style={muted}>{r.officialAdded?.join(', ')}</span>
                </div>
              )}
              <div>新增 {r.added.length}：<span style={muted}>{r.added.join(', ') || '—'}</span></div>
              <div>刷新 {r.updated?.length ?? 0} · 过时 {r.stale?.length ?? 0} · 排除 {r.excluded?.length ?? 0}</div>
              {(r.unverified?.length ?? 0) > 0 && (
                <div style={{ color: '#b8860b' }}>
                  官方接口未确认、已剔除 {r.unverified?.length}：<span style={muted}>{r.unverified?.join(', ')}</span>
                </div>
              )}
              {(r.stale?.length ?? 0) > 0 && (
                <div>过时（上游已移除、默认保留）：<span style={muted}>{r.stale?.join(', ')}</span></div>
              )}
              {(r.excluded?.length ?? 0) > 0 && (
                <div>本轮排除：<span style={muted}>{r.excluded?.join(', ')}</span></div>
              )}
            </div>
          ) : (
            <div style={muted}>尚未拉取（等待首轮刷新）</div>
          )}
          {r.exclude.length > 0 && <div style={{ ...muted, marginTop: 6 }}>固定排除：{r.exclude.join(', ')}</div>}
          {r.keep.length > 0 && <div style={{ ...muted, marginTop: 2 }}>固定保留：{r.keep.join(', ')}</div>}
          {!r.enabled && (
            <div style={{ ...muted, marginTop: 6 }}>
              已停用：产物回退为安装目录快照，插件合入的 catalog 条目已回滚。
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ModelRefreshSettings(): JSX.Element {
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [grantOpen, setGrantOpen] = useState(false)
  // 表单草稿（编辑中不直接生效，保存才提交）
  const [endpoint, setEndpoint] = useState('')
  const [interval, setInterval_] = useState('')
  const [proxyUrl, setProxyUrl] = useState('')
  const [patchCatalog, setPatchCatalog] = useState(true)
  const [removeStale, setRemoveStale] = useState(false)
  const [litellmEnabled, setLitellmEnabled] = useState(true)
  const [officialVerify, setOfficialVerify] = useState(true)
  const [draftReady, setDraftReady] = useState(false)

  const reload = useCallback(async () => {
    try {
      const next = await getJson<Status>(`${BASE}/status`)
      setStatus(next)
      setError(null)
      if (!draftReady) {
        setEndpoint(next.settings.endpoint)
        setInterval_(String(next.settings.intervalMinutes))
        setProxyUrl(next.settings.proxyUrl)
        setPatchCatalog(next.settings.patchCatalog)
        setRemoveStale(next.settings.removeStale)
        setLitellmEnabled(next.settings.litellmEnabled)
        setOfficialVerify(next.settings.officialVerify)
        setDraftReady(true)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [draftReady])

  useEffect(() => {
    void reload()
    const timer = window.setInterval(() => void reload(), 10_000)
    return () => window.clearInterval(timer)
  }, [reload])

  const toggleExpand = (route: string): void => {
    setExpanded((prev) => {
      const nextSet = new Set(prev)
      if (nextSet.has(route)) nextSet.delete(route)
      else nextSet.add(route)
      return nextSet
    })
  }

  const saveConfig = async (): Promise<void> => {
    setBusy(true)
    try {
      await postJson(`${BASE}/config`, {
        endpoint,
        intervalMinutes: Number(interval) || 360,
        proxyUrl,
        patchCatalog,
        removeStale,
        litellmEnabled,
        officialVerify,
      })
      setDraftReady(false)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const toggleRoute = async (route: string, enabled: boolean): Promise<void> => {
    setBusy(true)
    try {
      await postJson(`${BASE}/route`, { route, enabled })
      window.setTimeout(() => void reload(), 1_500)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const refreshNow = async (): Promise<void> => {
    setBusy(true)
    try {
      await postJson(`${BASE}/refresh`, {})
      window.setTimeout(() => void reload(), 2_000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <h2 style={{ marginTop: 0 }}>模型刷新（dsh-model-refresh）</h2>
      <p style={muted}>
        从 models.dev 定期拉取最新模型元数据，与已安装 pi-ai 目录合并，并把新模型合入安装树 catalog。
        模型列表变更需重启 DSH 生效（两次重启之间是快照）。
      </p>

      {error !== null && (
        <div style={{ ...box, borderColor: '#c0392b' }}>加载失败：{error}</div>
      )}

      {status !== null && (
        <>
          <div style={box}>
            <div style={row}>
              <strong>运行状态</strong>
              <span>{status.running ? '刷新中…' : '空闲'}</span>
              <span style={muted}>上次刷新：{fmtTime(status.lastRun)}</span>
              <button style={button} disabled={busy || status.running} onClick={() => void refreshNow()}>
                立即刷新
              </button>
            </div>
            {status.lastError !== null && (
              <div style={{ color: '#c0392b', marginTop: 6 }}>最近错误：{status.lastError}</div>
            )}
            {status.restartRequired && (
              <div style={{ marginTop: 6, color: '#b8860b' }}>
                安装树 catalog 已变更 —— 重启 DSH 后生效。
              </div>
            )}
            {status.catalogWritable === false && status.catalogGrantCommand !== null && (
              <div style={{ ...row, marginTop: 8 }}>
                <span style={{ color: '#b8860b' }}>新模型无法写入安装树 catalog（目录无写权限）。</span>
                <button style={{ ...button, fontWeight: 600 }} onClick={() => setGrantOpen(true)}>
                  查看授权命令
                </button>
              </div>
            )}
          </div>

          <h3>Provider 路由（{status.routes.length} 个，点击展开详情）</h3>
          {status.routes.map((r) => (
            <RouteCard
              key={r.route}
              r={r}
              busy={busy}
              expanded={expanded.has(r.route)}
              onToggle={() => toggleExpand(r.route)}
              onEnable={(enabled) => void toggleRoute(r.route, enabled)}
            />
          ))}

          <h3>全局设置</h3>
          <div style={box}>
            <div style={row}>
              <label>数据源</label>
              <input style={input} value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
            </div>
            <div style={row}>
              <label>刷新间隔（分钟）</label>
              <input
                style={{ ...input, minWidth: 100 }}
                value={interval}
                onChange={(e) => setInterval_(e.target.value)}
              />
            </div>
            <div style={row}>
              <label>代理（http(s)://，留空直连）</label>
              <input
                style={input}
                value={proxyUrl}
                placeholder="http://127.0.0.1:7890"
                onChange={(e) => setProxyUrl(e.target.value)}
              />
            </div>
            <div style={row}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={patchCatalog}
                  onChange={(e) => setPatchCatalog(e.target.checked)}
                />
                把新模型写入安装树 catalog（需要目录写权限）
              </label>
            </div>
            <div style={row}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={removeStale}
                  onChange={(e) => setRemoveStale(e.target.checked)}
                />
                移除过时模型
              </label>
              <span style={{ ...muted, flexBasis: '100%' }}>
                models.dev 已移除的 id：从模型列表剔除，并从安装目录删除（删除前完整备份，关闭本开关即恢复；
                与新增 id 构成命名空间对应的除外——那是上游换了 id 体系，不是真过时）
              </span>
            </div>
            <div style={row}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={litellmEnabled}
                  onChange={(e) => setLitellmEnabled(e.target.checked)}
                />
                LiteLLM 第二上游（models.dev 没数据的 provider 从 LiteLLM 补缺）
              </label>
            </div>
            <div style={row}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={officialVerify}
                  onChange={(e) => setOfficialVerify(e.target.checked)}
                />
                官方接口核对与补缺（GET /models 权威清单：修正误报过时、剔除幽灵新增、补入官方新模型）
              </label>
            </div>
            <div style={{ ...row, marginTop: 8 }}>
              <button style={button} disabled={busy} onClick={() => void saveConfig()}>
                保存设置
              </button>
              <span style={muted}>保存后下一轮刷新生效（或点「立即刷新」）。</span>
            </div>
          </div>
        </>
      )}

      {grantOpen && status?.catalogGrantCommand != null && (
        <GrantDialog
          command={status.catalogGrantCommand}
          note={status.catalogGrantNote ?? ''}
          onClose={() => setGrantOpen(false)}
        />
      )}
    </div>
  )
}

/** 插件 client 入口：注册设置区。 */
export const name = 'dsh-model-refresh-client'
export const inject = ['slots', 'locale']

export function apply(ctx: {
  slots: {
    inject: (name: string, setup: () => (() => void) | void) => void
    entries: (name: string) => readonly unknown[]
    register: (
      spec: { name: string; id?: string; key?: string; order?: number; label?: () => string; inject: () => unknown },
      component: unknown,
    ) => (() => void)
  }
}): void {
  ctx.slots.inject('settings.section', () => {
    const existing = ctx.slots.entries('settings.section').some(
      (entry) => (entry as { id?: string }).id === 'model-refresh',
    )
    if (existing) return () => undefined
    return ctx.slots.register(
      {
        name: 'settings.section',
        id: 'model-refresh',
        order: 17,
        label: () => '模型刷新',
        inject: () => ({}),
      },
      ModelRefreshSettings,
    )
  })
}
