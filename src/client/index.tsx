// 模型刷新：已安装的 pi-ai 代码与原 provider 保持不变，刷新后由 refresh-* 独立 provider 提供最新完整模型目录。
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

const BASE = '/plugins/dsh-model-refresh'
/** 官方清单核对配置：只描述清单证据的来源，不声明镜像推理的协议或模型能力。 */
type OfficialConfig = {
  endpoint?: string
  baseUrl?: string
  auth?: 'bearer' | 'anthropic' | 'none'
  apiKeyEnv?: string
  complete?: boolean
}
/** Host 可能仍保存本页不再展示的历史字段；提交时原样保留，本页不解释其用途。 */
type StoredOfficialConfig = OfficialConfig & { [key: string]: unknown }
type ModelState = 'ok' | 'added' | 'pending' | 'stale' | 'unverified'
type ModelRow = {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  input?: string[]
  reasoning?: boolean
  state: ModelState
  reason?: string
}
type RouteStatus = {
  route: string
  as?: string
  /** 该源路由是否启用动态镜像。 */
  enabled: boolean
  /** 镜像路由（refresh-* provider）名称；后端未提供时为 undefined，不做推断。 */
  mirrorRoute?: string
  /** 镜像 provider 是否已在 DSH 注册；undefined 表示后端未提供，不能当作已注册。 */
  registered?: boolean
  keep: string[]
  exclude: string[]
  fetchedAt?: string
  installedAt?: string | null
  source?: string
  official?: string
  officialEndpoint?: string
  officialComplete?: boolean
  officialAdded?: string[]
  models?: number
  modelList?: ModelRow[]
  added?: string[]
  updated?: string[]
  stale?: string[]
  excluded?: string[]
  unverified?: string[]
  pending?: { id: string; reason: string }[]
  error?: string | null
  warnings?: string[]
}
type Status = {
  version: number
  pluginVersion?: string
  settingsRevision?: number
  initialized?: boolean
  degraded?: boolean
  degradedHint?: string | null
  warnings?: string[]
  running: boolean
  lastRun: string | null
  lastError: string | null
  settings: {
    intervalMinutes: number
    proxyUrl: string
    removeStale: boolean
    modelsDevFallback: boolean
    officialVerify: boolean
    proxyConfigured: boolean
    staleGraceHours?: number
    staleConfirmations?: number
    officialRoutes?: Record<string, StoredOfficialConfig | null>
  }
  routes: RouteStatus[]
  piAiUpstream?: { package: string; version: string | null; checkedAt: string; providerCount: number; modelCount: number; stale: boolean; error: string | null } | null
}
type GlobalDraft = {
  intervalMinutes: string
  proxyUrl: string
  removeStale: boolean
  modelsDevFallback: boolean
  officialVerify: boolean
  staleGraceHours: string
  staleConfirmations: string
}
type OfficialDraft = {
  disabled: boolean
  endpoint: string
  baseUrl: string
  auth: 'bearer' | 'anthropic' | 'none' | ''
  apiKeyEnv: string
  complete: boolean
}
const box: CSSProperties = { border: '1px solid var(--dsh-border, #555)', borderRadius: 8, padding: '12px 14px', marginBottom: 10 }
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }
const muted: CSSProperties = { opacity: 0.72, fontSize: 12, lineHeight: 1.6 }
const input: CSSProperties = { padding: '6px 8px', borderRadius: 6, border: '1px solid var(--dsh-border, #555)', background: 'var(--dsh-bg, #1e1e1e)', color: 'inherit', maxWidth: '100%', boxSizing: 'border-box' }
const button: CSSProperties = { padding: '6px 12px', borderRadius: 6, cursor: 'pointer' }
const warning: CSSProperties = { ...muted, color: 'var(--dsh-warning, #dba449)', opacity: 1 }
const failure: CSSProperties = { color: 'var(--dsh-error, #e97878)', fontSize: 13, overflowWrap: 'anywhere' }
const badge: CSSProperties = { ...muted, border: '1px solid var(--dsh-border, #555)', padding: '2px 8px', borderRadius: 999 }

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`读取状态失败（HTTP ${res.status}）`)
  return res.json() as Promise<T>
}
async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) {
    let detail = ''
    try {
      const data = await res.json() as { error?: string }
      if (typeof data.error === 'string') detail = `：${data.error}`
    } catch { /* 非 JSON 错误仅显示状态码 */ }
    throw new Error(`操作失败（HTTP ${res.status}）${detail}`)
  }
  return res.json() as Promise<T>
}
function fmtTime(value: string | null | undefined): string {
  if (!value) return '—'
  const time = new Date(value)
  return Number.isNaN(time.getTime()) ? value : time.toLocaleString()
}
function messageOf(e: unknown): string { return e instanceof Error ? e.message : String(e) }
function hasIssue(r: RouteStatus): boolean {
  return Boolean(r.error || r.warnings?.length || r.official === 'failed' || r.official === 'no-key')
}
function toGlobalDraft(s: Status['settings']): GlobalDraft {
  return { intervalMinutes: String(s.intervalMinutes), proxyUrl: s.proxyUrl,
    removeStale: s.removeStale, modelsDevFallback: s.modelsDevFallback,
    officialVerify: s.officialVerify, staleGraceHours: String(s.staleGraceHours ?? 24), staleConfirmations: String(s.staleConfirmations ?? 2) }
}
function toOfficialDraft(config: StoredOfficialConfig | null | undefined): OfficialDraft {
  return { disabled: config === null, endpoint: config?.endpoint ?? '', baseUrl: config?.baseUrl ?? '', auth: config?.auth ?? '',
    apiKeyEnv: config?.apiKeyEnv ?? '', complete: config?.complete === true }
}
/** 本页可编辑的官方清单字段；其余键属于存量未展示字段，提交时原样保留。 */
const EDITABLE_OFFICIAL_KEYS = ['endpoint', 'baseUrl', 'auth', 'apiKeyEnv', 'complete']
function withoutEditableOfficialKeys(stored: StoredOfficialConfig): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(stored)) if (!EDITABLE_OFFICIAL_KEYS.includes(key)) output[key] = value
  return output
}
function numberValue(value: string, label: string, minimum: number, integer = false): number {
  const n = Number(value)
  if (value.trim() === '' || !Number.isFinite(n) || n < minimum || (integer && !Number.isInteger(n))) {
    throw new Error(`${label}须为${integer ? '整数' : '数字'}，且不小于 ${minimum}`)
  }
  return n
}
function officialValue(draft: OfficialDraft): OfficialConfig | null {
  if (draft.disabled) return null
  const endpoint = draft.endpoint.trim()
  if (endpoint) {
    const url = new URL(endpoint)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('官方端点须为不含内嵌凭据的 HTTP(S) URL')
  }
  const apiKeyEnv = draft.apiKeyEnv.trim()
  if (apiKeyEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) throw new Error('凭据环境变量名称格式无效；请勿输入真实密钥')
  const baseUrl = draft.baseUrl.trim()
  if (baseUrl) {
    const url = new URL(baseUrl)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('清单请求根 URL 无效')
  }
  // 只提交本页展示的清单来源字段；不声明推理协议，也不声明模型能力。
  // 清空的字段直接不出现在结果里，因此合并时必须先把存量里的同名键剔除，否则旧值会复活。
  const value: OfficialConfig = { complete: draft.complete }
  if (endpoint) value.endpoint = endpoint
  if (baseUrl) value.baseUrl = baseUrl
  if (draft.auth) value.auth = draft.auth
  if (apiKeyEnv) value.apiKeyEnv = apiKeyEnv
  return value
}
function IdList(props: { label: string; ids?: string[]; unknown?: string }): JSX.Element {
  return <div style={{ fontSize: 13, marginTop: 5, overflowWrap: 'anywhere' }}><strong>{props.label}</strong> {props.ids === undefined ? (props.unknown ?? '尚无记录') : `${props.ids.length}：${props.ids.join('、') || '—'}`}</div>
}
const MODEL_STATES: Record<ModelState, { label: string; color: string }> = {
  ok: { label: '可用', color: 'var(--dsh-success, #3fb950)' },
  added: { label: '新增', color: 'var(--dsh-accent, #58a6ff)' },
  pending: { label: '待确认', color: 'var(--dsh-warning, #d29922)' },
  stale: { label: '缺失', color: 'var(--dsh-warning, #d29922)' },
  unverified: { label: '未验证', color: 'var(--dsh-muted, #8b949e)' },
}
function fmtTokens(value?: number): string {
  if (typeof value !== 'number' || value <= 0) return '—'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`
  if (value >= 1024) return `${Math.round(value / 1024)}K`
  return String(value)
}
function ModelTable(props: { rows: ModelRow[]; filter: string; onFilter: (value: string) => void }): JSX.Element {
  const counts: Record<string, number> = { all: props.rows.length }
  for (const row of props.rows) counts[row.state] = (counts[row.state] ?? 0) + 1
  const visible = props.filter === 'all' ? props.rows : props.rows.filter((row) => row.state === props.filter)
  const order: ModelState[] = ['pending', 'added', 'stale', 'unverified', 'ok']
  const ordered = [...visible].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state) || a.id.localeCompare(b.id))
  return <div style={{ marginTop: 8 }}>
    <div style={{ ...row, flexWrap: 'wrap', gap: 6 }}>
      {(['all', 'ok', 'added', 'pending', 'stale', 'unverified'] as const).map((key) => {
        const label = key === 'all' ? '全部' : MODEL_STATES[key as ModelState].label
        const active = props.filter === key
        return <button key={key} type="button" style={{ ...button, fontWeight: active ? 600 : 400, opacity: counts[key] ? 1 : 0.5 }}
          onClick={() => props.onFilter(key)}>{label} {counts[key] ?? 0}</button>
      })}
    </div>
    {ordered.length === 0
      ? <p style={muted}>此筛选下没有模型。</p>
      : <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 6 }}>
        <thead><tr style={{ textAlign: 'left' }}>
          <th style={{ padding: '4px 6px', width: 72 }}>状态</th>
          <th style={{ padding: '4px 6px' }}>模型</th>
          <th style={{ padding: '4px 6px', width: 110 }}>上下文 / 输出</th>
          <th style={{ padding: '4px 6px' }}>备注</th>
        </tr></thead>
        <tbody>{ordered.map((row) => {
          const meta = MODEL_STATES[row.state]
          return <tr key={row.id} style={{ borderTop: '1px solid var(--dsh-border, #333)' }}>
            <td style={{ padding: '4px 6px', color: meta.color, whiteSpace: 'nowrap' }}>{meta.label}</td>
            <td style={{ padding: '4px 6px', overflowWrap: 'anywhere' }}><code>{row.id}</code>{row.reasoning ? <span style={muted}> · 思考</span> : null}{row.input?.includes('image') ? <span style={muted}> · 图像</span> : null}</td>
            <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>{fmtTokens(row.contextWindow)} / {fmtTokens(row.maxTokens)}</td>
            <td style={{ padding: '4px 6px', ...muted }}>{row.reason ?? (row.name && row.name !== row.id ? row.name : '')}</td>
          </tr>
        })}</tbody>
      </table>}
  </div>
}
function RouteCard(props: {
  r: RouteStatus; busy: boolean; expanded: boolean; config?: StoredOfficialConfig | null
  onToggle: () => void; onEnable: (enabled: boolean) => void
  onSaveOfficial: (config: OfficialConfig | null) => Promise<boolean>
}): JSX.Element {
  const { r, busy, expanded } = props
  const [draft, setDraft] = useState(() => toOfficialDraft(props.config))
  const [localError, setLocalError] = useState<string | null>(null)
  const [modelFilter, setModelFilter] = useState('all')
  const dirty = useRef(false)
  useEffect(() => { if (!dirty.current) setDraft(toOfficialDraft(props.config)) }, [props.config])
  const change = <K extends keyof OfficialDraft>(key: K, value: OfficialDraft[K]): void => {
    dirty.current = true; setDraft((old) => ({ ...old, [key]: value }))
  }
  const save = async (): Promise<void> => {
    setLocalError(null)
    try { if (await props.onSaveOfficial(officialValue(draft))) dirty.current = false }
    catch (e) { setLocalError(messageOf(e)) }
  }
  const officialLabel = r.official === 'verified' ? `官方清单已返回${r.officialComplete === true ? ' · 完整' : ' · 完整性未确认'}`
    : r.official === 'failed' ? '官方清单拉取失败' : r.official === 'no-key' ? '官方清单缺凭据' : '官方清单未核对'
  const modelRows = r.modelList ?? []
  const pendingCount = modelRows.filter((m) => m.state === 'pending').length
  const addedCount = modelRows.filter((m) => m.state === 'added').length
  const mirrorName = r.mirrorRoute ?? '（后端未提供镜像路由）'
  const registeredLabel = r.registered === true ? '镜像 provider 已注册'
    : r.registered === false ? '镜像 provider 未注册' : '镜像 provider 注册状态未知'
  return <section style={box}>
    <div style={row}>
      <button type="button" style={{ ...button, fontWeight: 600 }} aria-expanded={expanded} onClick={props.onToggle}>{expanded ? '▾' : '▸'} {r.route}</button>
      <label style={row}><input type="checkbox" checked={r.enabled} disabled={busy} onChange={(e) => props.onEnable(e.target.checked)} />启用动态镜像</label>
      <span style={badge}>源路由 → 镜像路由：{r.route} → {mirrorName}</span>
      <span style={r.registered === true ? badge : warning}>{registeredLabel}</span>
      <span style={muted}>{r.enabled ? '已启用动态镜像' : '未启用动态镜像'}</span>
      <span style={r.official === 'failed' || r.official === 'no-key' ? warning : badge}>{officialLabel}</span>
      <span style={muted}>{r.models ?? '—'} 个模型{pendingCount ? ` · 待确认 ${pendingCount}` : ''}{addedCount ? ` · 新增 ${addedCount}` : ''}</span>
      {hasIssue(r) && <span style={warning}>有异常 / 警告</span>}
    </div>
    {expanded && <div style={{ marginTop: 12, borderTop: '1px solid var(--dsh-border, #555)', paddingTop: 10 }}>
      <div style={muted}>刷新时间：{fmtTime(r.fetchedAt)} · 基线：{fmtTime(r.installedAt)}{r.as ? ` · 元数据映射：${r.as}` : ''}</div>
      <p style={muted}>启用动态镜像后，刷新会在内存中生成该源路由的新模型快照，由 DSH 模型选择器中的 refresh-* 独立 provider 提供；已安装的 pi-ai 代码与原 provider 均保持不变。快照内容不代表远端推理已验证。</p>
      {!r.enabled && <p style={warning}>未启用动态镜像。启用后需在 DSH 模型选择器中选择对应的 refresh-* provider；原 provider 不会被替换。</p>}
      {r.error && <div role="alert" style={failure}>路由错误：{r.error}</div>}
      {r.warnings?.map((item, i) => <div key={i} style={warning}>警告：{item}</div>)}
      {modelRows.length > 0
        ? <ModelTable rows={modelRows} filter={modelFilter} onFilter={setModelFilter} />
        : <p style={muted}>尚无模型记录；执行一次刷新后这里会列出每个模型及其状态。</p>}
      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: 'pointer' }}>诊断详情</summary>
        <p style={muted}>以下为镜像快照的原始分类，用于排查异常。主表已按模型合并展示。</p>
        <IdList label="镜像目录新增" ids={r.added} />
        <IdList label="镜像目录已更新" ids={r.updated} />
        <IdList label="官方补缺候选" ids={r.officialAdded} />
        <IdList label="缺失候选" ids={r.stale} />
        <IdList label="已排除" ids={r.excluded} />
        <IdList label="未验证候选" ids={r.unverified} />
        <IdList label="固定保留" ids={r.keep} /><IdList label="固定排除" ids={r.exclude} />
        <div style={{ ...muted, marginTop: 8, overflowWrap: 'anywhere' }}>实际核对端点：{r.officialEndpoint ?? '尚无记录'}</div>
      </details>
      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: 'pointer' }}>官方清单核对配置{dirty.current ? '（草稿未保存）' : ''}</summary>
        <p style={muted}>这里只配置官方清单证据的来源：端点、清单根地址、鉴权方式与凭据名称，不输入真实密钥。此处不声明镜像推理的协议，也不声明模型能力；空字段允许后端采用已验证默认值。</p>
        <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
          <label style={row}><input type="checkbox" checked={draft.disabled} onChange={(e) => change('disabled', e.target.checked)} />禁用此路由官方核对（配置为 null）</label>
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            <label>官方列表完整 URL <input style={{ ...input, width: '100%' }} type="url" value={draft.endpoint} disabled={draft.disabled} placeholder="https://provider.example/v1/models" onChange={(e) => change('endpoint', e.target.value)} /></label>
            <label>清单请求根 URL（不修改推理端点） <input style={{ ...input, width: '100%' }} type="url" value={draft.baseUrl} disabled={draft.disabled} placeholder="留空使用默认清单根地址" onChange={(e) => change('baseUrl', e.target.value)} /></label>
            <label>清单鉴权 <select style={{ ...input, marginLeft: 8 }} value={draft.auth} disabled={draft.disabled} onChange={(e) => change('auth', e.target.value as OfficialDraft['auth'])}><option value="">使用适配器默认</option><option value="bearer">Bearer</option><option value="anthropic">Anthropic x-api-key</option><option value="none">公开接口（不发凭据）</option></select></label>
            <label>凭据环境变量名称 <input style={{ ...input, width: '100%' }} value={draft.apiKeyEnv} disabled={draft.disabled} placeholder="PROVIDER_API_KEY（名称，不是密钥）" autoComplete="off" onChange={(e) => change('apiKeyEnv', e.target.value)} /></label>
            <label style={row}><input type="checkbox" checked={draft.complete} disabled={draft.disabled} onChange={(e) => change('complete', e.target.checked)} />我确认此端点返回当前套餐的权威全量清单</label>
            <span style={warning}>仅明确确认套餐范围、分页处理和完整性后启用；开启后允许将清单缺失用于移除判定。</span>
          </div>
          <div style={{ ...row, marginTop: 10 }}><button style={button} onClick={() => void save()}>保存此路由官方配置</button><button style={button} onClick={() => { dirty.current = false; setDraft(toOfficialDraft(props.config)); setLocalError(null) }}>放弃草稿</button></div>
        </fieldset>
        {localError && <div role="alert" style={failure}>{localError}</div>}
      </details>
    </div>}
  </section>
}

export function ModelRefreshSettings(): JSX.Element {
  const [status, setStatus] = useState<Status | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const alive = useRef(true)
  const sequence = useRef(0)
  const draftInitialized = useRef(false)
  const draftRevision = useRef<number | undefined>(undefined)
  const globalBase = useRef<GlobalDraft | null>(null)
  const [draft, setDraft] = useState<GlobalDraft | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const reload = useCallback(async (): Promise<Status> => {
    const request = ++sequence.current
    const next = await getJson<Status>(`${BASE}/status`)
    if (alive.current && request === sequence.current) {
      setStatus(next); setLoadError(null)
      if (!draftInitialized.current && next.settings) { const initial = toGlobalDraft(next.settings); setDraft(initial); globalBase.current = initial; draftInitialized.current = true; draftRevision.current = next.settingsRevision }
    }
    return next
  }, [])
  useEffect(() => {
    alive.current = true
    const poll = (): void => { void reload().catch((e) => { if (alive.current) setLoadError(messageOf(e)) }) }
    poll()
    const timer = window.setInterval(poll, 10_000)
    return () => { alive.current = false; sequence.current++; window.clearInterval(timer) }
  }, [reload])
  const run = async (work: () => Promise<void>, success: string): Promise<boolean> => {
    if (locked.current || status?.running) return false
    locked.current = true; setBusy(true); setActionError(null); setNotice('')
    try { await work(); if (alive.current) setNotice(success); return true }
    catch (e) { if (alive.current) setActionError(messageOf(e)); return false }
    finally { locked.current = false; if (alive.current) setBusy(false) }
  }
  const updateDraft = <K extends keyof GlobalDraft>(key: K, value: GlobalDraft[K]): void => {
    setDraft((old) => old === null ? old : { ...old, [key]: value })
  }
  const saveGlobal = async (): Promise<void> => {
    if (!draft) return
    await run(async () => {
      const body = { ...draft, proxyUrl: draft.proxyUrl.trim(),
        expectedRevision: draftRevision.current,
        intervalMinutes: numberValue(draft.intervalMinutes, '刷新间隔', 1, true),
        staleGraceHours: numberValue(draft.staleGraceHours, '缺失宽限期', 1),
        staleConfirmations: numberValue(draft.staleConfirmations, '连续确认次数', 2, true) }
      const latest = await getJson<Status>(`${BASE}/status`)
      const latestDraft = toGlobalDraft(latest.settings)
      const changed = Object.keys(draft).filter(k => draft[k as keyof GlobalDraft] !== globalBase.current?.[k as keyof GlobalDraft]) as (keyof GlobalDraft)[]
      for (const key of changed) if (latestDraft[key] !== globalBase.current?.[key]) throw new Error(`${key} 已被其它页面修改，请核对后重载草稿`)
      await postJson(`${BASE}/config`, { ...Object.fromEntries(changed.map(k => [k, body[k]])), expectedRevision: latest.settingsRevision })
      const next = await reload()
      if (alive.current) { const saved = toGlobalDraft(next.settings); setDraft(saved); globalBase.current = saved; draftRevision.current = next.settingsRevision }
    }, '设置已保存。新的内存快照会在下一次刷新后生效。')
  }
  const saveOfficial = async (route: string, config: OfficialConfig | null): Promise<boolean> => run(async () => {
    // 提交完整字典前读取最新状态，只覆盖当前路由，保留其他 provider 配置。
    const latest = await getJson<Status>(`${BASE}/status`)
    const previous = latest.settings.officialRoutes ?? {}
    // 先剔除本页可编辑的 5 个键再合并：清空某个可见字段时旧值不会复活。
    // 其余未展示的历史字段（如 protocol/contextWindow/maxTokens/assumeChat）原样带回，本页不承诺其用途。
    const value = config === null ? null : { ...withoutEditableOfficialKeys(previous[route] ?? {}), ...config }
    await postJson(`${BASE}/config`, { expectedRevision: latest.settingsRevision, officialRoutes: { ...previous, [route]: value } })
    await reload()
  }, `${route} 官方清单配置已保存。`)
  const toggleRoute = async (route: string, enabled: boolean): Promise<void> => {
    await run(async () => { await postJson(`${BASE}/route`, { route, enabled }); await reload() }, `${route} ${enabled ? '启用' : '停用'}动态镜像请求已接受；快照结果以状态记录为准。`)
  }
  const refreshNow = async (): Promise<void> => {
    await run(async () => { await postJson(`${BASE}/refresh`, {}); await reload() }, '刷新请求已接受；新的内存模型快照会在刷新完成后生成。')
  }
  const toggleExpand = (route: string): void => setExpanded((old) => {
    const next = new Set(old); if (next.has(route)) next.delete(route); else next.add(route); return next
  })
  const routes = status?.routes ?? []
  const search = query.trim().toLocaleLowerCase()
  const visible = routes.filter((r) => {
    if (filter === 'enabled' && !r.enabled) return false
    if (filter === 'issues' && !hasIssue(r)) return false
    if (filter === 'pending' && !r.pending?.length) return false
    return !search || [r.route, r.mirrorRoute ?? '', r.as ?? '', ...(r.added ?? []), ...(r.updated ?? []), ...(r.pending ?? []).map((item) => `${item.id} ${item.reason}`), ...(r.warnings ?? []), r.error ?? ''].join(' ').toLocaleLowerCase().includes(search)
  })
  const sum = (key: 'added' | 'updated' | 'pending'): number => routes.reduce((n, r) => n + (r[key]?.length ?? 0), 0)
  const disabled = busy || status?.running === true || status?.initialized === false
  return <div style={{ maxWidth: 920 }}>
    <h2 style={{ marginTop: 0 }}>模型刷新（高级）</h2>
    <p style={muted}>已安装的 pi-ai 代码与原 provider 保持不变。插件刷新后由 refresh-* 独立 provider 提供最新完整模型目录：在 DSH 模型选择器中选择对应的 refresh-* provider 即可使用。本页用于刷新、启用镜像与诊断。</p>
    {loadError && <div role="alert" style={{ ...box, ...failure }}>状态读取失败：{loadError}。保留上次状态与未保存草稿。</div>}
    {actionError && <div role="alert" style={{ ...box, ...failure }}>操作失败：{actionError} <button style={button} onClick={() => setActionError(null)}>关闭错误提示</button></div>}
    {notice && <div role="status" style={{ ...box, ...muted }}>{notice}</div>}
    {!status && !loadError && <p role="status">正在读取状态…</p>}
    {status && <>
      <section style={box}>
        <div style={{ ...row, justifyContent: 'space-between' }}><strong>{status.degraded ? '插件启动失败' : status.running ? '正在刷新…' : '刷新就绪'}</strong><span style={muted}>上次运行：{fmtTime(status.lastRun)}</span><button style={button} disabled={disabled} onClick={() => void refreshNow()}>立即刷新</button></div>
        <div style={{ ...row, marginTop: 12 }}><span>{routes.length} 个路由</span><span>{routes.filter((r) => r.enabled).length} 已启用动态镜像</span><span>{routes.filter(hasIssue).length} 有异常</span><span>发现 {sum('added')}</span><span>已更新 {sum('updated')}</span><span>待确认 {sum('pending')}</span></div>
        {status.piAiUpstream && <div style={{ ...row, marginTop: 8 }}><span style={badge}>pi-ai {status.piAiUpstream.version ? `@${status.piAiUpstream.version}` : '不可用'}</span><span style={muted}>{status.piAiUpstream.providerCount} 个 provider · {status.piAiUpstream.modelCount} 个聊天模型 · 检查于 {fmtTime(status.piAiUpstream.checkedAt)}</span>{status.piAiUpstream.stale && <span style={warning}>上游不可用，正在使用缓存：{status.piAiUpstream.error}</span>}{!status.piAiUpstream.version && <span style={warning}>未找到有效上游缓存：{status.piAiUpstream.error}</span>}</div>}
        {status.degraded && <p role="alert" style={failure}>启动失败：{status.lastError ?? '未知原因'}。{status.degradedHint}</p>}
        {status.warnings?.map((item, i) => <p key={i} style={warning}>{item}</p>)}
        {!status.degraded && status.lastError && <p role="alert" style={failure}>最近运行错误：{status.lastError}</p>}
      </section>
      <div style={{ ...row, marginBottom: 12 }}>
        <label style={{ flexGrow: 1 }}>搜索路由 / 模型 <input style={{ ...input, width: '100%' }} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="名称、模型 ID、待确认原因" /></label>
        <label>筛选 <select style={input} value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">全部</option><option value="enabled">已启用镜像</option><option value="issues">异常 / 警告</option><option value="pending">待确认</option></select></label>
      </div>
      <h3>Provider 路由 <small style={muted}>{visible.length} / {routes.length} · 默认折叠</small></h3>
      {visible.length === 0 && <p style={muted}>没有匹配的路由。</p>}
      {routes.map((r) => <div key={r.route} hidden={!visible.some((item) => item.route === r.route)}><RouteCard r={r} config={status.settings?.officialRoutes?.[r.route]} busy={disabled} expanded={expanded.has(r.route)} onToggle={() => toggleExpand(r.route)} onEnable={(enabled) => void toggleRoute(r.route, enabled)} onSaveOfficial={(config) => saveOfficial(r.route, config)} /></div>)}
      {draft && <section style={{ ...box, marginTop: 18 }}>
        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>全局设置 · 检查间隔、代理与移除策略</summary>
          <p style={muted}>模型清单同步自 pi-ai 上游；官方清单用于核对套餐可用性。刷新会生成新的内存模型快照，新请求使用新快照；快照不代表远端推理已测通。移除策略只影响镜像目录，不改动原 provider。</p>
          <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: '10px 0 0', display: 'grid', gap: 10 }}>
            <div style={row}><label>间隔（分钟） <input style={{ ...input, width: 110 }} type="number" min={1} value={draft.intervalMinutes} onChange={(e) => updateDraft('intervalMinutes', e.target.value)} /></label><label>代理 URL（留空直连） <input style={input} value={draft.proxyUrl} placeholder="http://127.0.0.1:7890" onChange={(e) => updateDraft('proxyUrl', e.target.value)} /></label></div>
            <label style={row}><input type="checkbox" checked={draft.modelsDevFallback} onChange={(e) => updateDraft('modelsDevFallback', e.target.checked)} />pi-ai 上游不可用时改用 models.dev 备选</label>
            <label style={row}><input type="checkbox" checked={draft.officialVerify} onChange={(e) => updateDraft('officialVerify', e.target.checked)} />启用官方清单核对与补缺</label>
            <details>
              <summary style={{ cursor: 'pointer', ...muted }}>移除策略（默认关闭；只有权威全量清单连续确认缺失才会移除）</summary>
              <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                <label style={row}><input type="checkbox" checked={draft.removeStale} onChange={(e) => updateDraft('removeStale', e.target.checked)} />允许从镜像目录移除连续确认缺失的模型</label>
                <div style={row}><label>缺失宽限期（小时） <input style={{ ...input, width: 110 }} type="number" min={1} value={draft.staleGraceHours} onChange={(e) => updateDraft('staleGraceHours', e.target.value)} /></label><label>连续确认次数 <input style={{ ...input, width: 100 }} type="number" min={2} step={1} value={draft.staleConfirmations} onChange={(e) => updateDraft('staleConfirmations', e.target.value)} /></label></div>
              </div>
            </details>
            <div style={row}><button style={button} onClick={() => void saveGlobal()}>保存全局设置</button><button style={button} onClick={() => { const reset = toGlobalDraft(status.settings); setDraft(reset); globalBase.current = reset; draftRevision.current = status.settingsRevision }}>放弃全局草稿</button></div>
          </fieldset>
        </details>
      </section>}
    </>}
  </div>
}

export const name = 'dsh-model-refresh-client'
export const inject = ['slots', 'locale']
export function apply(ctx: {
  slots: {
    inject: (name: string, setup: () => (() => void) | void) => void
    entries: (name: string) => readonly unknown[]
    register: (spec: { name: string; id?: string; key?: string; order?: number; label?: () => string; inject: () => unknown }, component: unknown) => (() => void)
  }
}): void {
  ctx.slots.inject('settings.section', () => {
    if (ctx.slots.entries('settings.section').some((entry) => (entry as { id?: string }).id === 'model-refresh')) return () => undefined
    return ctx.slots.register({ name: 'settings.section', id: 'model-refresh', order: 17, label: () => '模型刷新（高级）', inject: () => ({}) }, ModelRefreshSettings)
  })
}
