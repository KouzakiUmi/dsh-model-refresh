// 模型目录设置：候选发现、真实应用与待确认分开展示。
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { ManualModels } from './ManualModels'
import type { ManualModel } from './ManualModels'

const BASE = '/plugins/dsh-model-refresh'
/** Namespace every llm-pi-ai provider shares in the models page (`ctx.fiber.entry.options.id`). */
const PI_AI_NAMESPACE = 'llm-pi-ai'
type Protocol = 'openai-completions' | 'openai-responses' | 'anthropic-messages'
type OfficialConfig = {
  endpoint?: string
  baseUrl?: string
  auth?: 'bearer' | 'anthropic' | 'none'
  protocol?: Protocol
  apiKeyEnv?: string
  complete?: boolean
  assumeChat?: boolean
  contextWindow?: number
  maxTokens?: number
}
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
  enabled: boolean
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
  applied?: string[]
  removed?: string[]
  conflicts?: string[]
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
  restartRequired: boolean
  catalogWritable: boolean | null
  catalogGrantCommand: string | null
  catalogGrantNote: string | null
  settings: {
    intervalMinutes: number
    proxyUrl: string
    patchCatalog: boolean
    removeStale: boolean
    modelsDevFallback: boolean
    officialVerify: boolean
    proxyConfigured: boolean
    outputDir?: string
    staleGraceHours?: number
    staleConfirmations?: number
    officialRoutes?: Record<string, OfficialConfig | null>
    manualModels?: Record<string, ManualModel[]>
  }
  routes: RouteStatus[]
  providerTargets?: { id: string }[]
  providerApplications?: Record<string, unknown>
  piAiUpstream?: { package: string; version: string | null; checkedAt: string; providerCount: number; modelCount: number; stale: boolean; error: string | null } | null
}
type GlobalDraft = {
  intervalMinutes: string
  proxyUrl: string
  patchCatalog: boolean
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
  protocol: Protocol | ''
  apiKeyEnv: string
  complete: boolean
  assumeChat: boolean
  contextWindow: string
  maxTokens: string
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
  return Boolean(r.error || r.warnings?.length || r.conflicts?.length || r.official === 'failed' || r.official === 'no-key')
}
function toGlobalDraft(s: Status['settings']): GlobalDraft {
  return { intervalMinutes: String(s.intervalMinutes), proxyUrl: s.proxyUrl,
    patchCatalog: s.patchCatalog, removeStale: s.removeStale, modelsDevFallback: s.modelsDevFallback,
    officialVerify: s.officialVerify, staleGraceHours: String(s.staleGraceHours ?? 24), staleConfirmations: String(s.staleConfirmations ?? 2) }
}
function toOfficialDraft(config: OfficialConfig | null | undefined): OfficialDraft {
  return { disabled: config === null, endpoint: config?.endpoint ?? '', baseUrl: config?.baseUrl ?? '', auth: config?.auth ?? '', protocol: config?.protocol ?? '',
    apiKeyEnv: config?.apiKeyEnv ?? '', complete: config?.complete === true, assumeChat: config?.assumeChat === true,
    contextWindow: config?.contextWindow === undefined ? '' : String(config.contextWindow),
    maxTokens: config?.maxTokens === undefined ? '' : String(config.maxTokens) }
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
  const contextWindow = draft.contextWindow.trim() ? numberValue(draft.contextWindow, '上下文容量', 1, true) : undefined
  const maxTokens = draft.maxTokens.trim() ? numberValue(draft.maxTokens, '输出容量', 1, true) : undefined
  if (contextWindow !== undefined && maxTokens !== undefined && maxTokens > contextWindow) throw new Error('输出容量不能大于上下文容量')
  const baseUrl = draft.baseUrl.trim()
  if (baseUrl) {
    const url = new URL(baseUrl)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('推理 baseUrl 无效')
  }
  return { endpoint: endpoint || undefined, baseUrl: baseUrl || undefined, auth: draft.auth || undefined, protocol: draft.protocol || undefined, apiKeyEnv: apiKeyEnv || undefined,
    complete: draft.complete, assumeChat: draft.assumeChat, contextWindow, maxTokens }
}
async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  const previous = document.activeElement as HTMLElement | null
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  try {
    ta.select()
    if (!document.execCommand('copy')) throw new Error('剪贴板不可用')
  } finally { ta.remove(); previous?.focus() }
}
function GrantDialog(props: { command: string; note: string; onClose: () => void }): JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const [copyResult, setCopyResult] = useState('')
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = root.current
    dialog?.querySelector<HTMLButtonElement>('button')?.focus()
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); props.onClose(); return }
      if (event.key !== 'Tab' || !dialog) return
      const items = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]'))
      const first = items[0]; const last = items[items.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); previous?.focus() }
  }, [props.onClose])
  const copy = async (): Promise<void> => {
    try { await copyText(props.command); setCopyResult('已复制') }
    catch { setCopyResult('复制失败，请选中下面命令后手动复制。') }
  }
  return <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={props.onClose}>
    <div ref={root} role="dialog" aria-modal="true" aria-labelledby="model-refresh-grant-title" style={{ ...box, background: 'var(--dsh-bg, #1e1e1e)', width: '90%', maxWidth: 600, maxHeight: '85vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
      <div style={{ ...row, justifyContent: 'space-between' }}><strong id="model-refresh-grant-title">目录写入授权说明</strong><button style={button} onClick={props.onClose}>关闭</button></div>
      <p style={muted}>仅在确认授权范围后，以管理员身份打开 PowerShell 手动执行。此页面不会执行命令或自动重启。</p>
      <code tabIndex={0} style={{ display: 'block', padding: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', userSelect: 'all', border: '1px solid var(--dsh-border, #555)' }}>{props.command}</code>
      <div style={{ ...row, marginTop: 10 }}><button style={button} onClick={() => void copy()}>复制命令</button><span role="status" style={muted}>{copyResult}</span></div>
      <p style={muted}>{props.note}</p>
    </div>
  </div>
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
  r: RouteStatus; busy: boolean; expanded: boolean; config?: OfficialConfig | null
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
  return <section style={box}>
    <div style={row}>
      <button type="button" style={{ ...button, fontWeight: 600 }} aria-expanded={expanded} onClick={props.onToggle}>{expanded ? '▾' : '▸'} {r.route}</button>
      <label style={row}><input type="checkbox" checked={r.enabled} disabled={busy} onChange={(e) => props.onEnable(e.target.checked)} />启用</label>
      <span style={r.official === 'failed' || r.official === 'no-key' ? warning : badge}>{officialLabel}</span>
      <span style={muted}>{r.models ?? '—'} 个模型{pendingCount ? ` · 待确认 ${pendingCount}` : ''}{addedCount ? ` · 新增 ${addedCount}` : ''}</span>
      {hasIssue(r) && <span style={warning}>有异常 / 警告</span>}
    </div>
    {expanded && <div style={{ marginTop: 12, borderTop: '1px solid var(--dsh-border, #555)', paddingTop: 10 }}>
      <div style={muted}>刷新时间：{fmtTime(r.fetchedAt)} · 目录基线：{fmtTime(r.installedAt)}{r.as ? ` · 元数据映射：${r.as}` : ''}</div>
      {!r.enabled && <p style={warning}>路由已停用。是否恢复或回滚以实际同步记录为准，停用本身不证明回滚成功。</p>}
      {r.error && <div role="alert" style={failure}>路由错误：{r.error}</div>}
      {r.warnings?.map((item, i) => <div key={i} style={warning}>警告：{item}</div>)}
      {r.conflicts?.map((item, i) => <div key={i} style={warning}>同步冲突：{item}</div>)}
      {modelRows.length > 0
        ? <ModelTable rows={modelRows} filter={modelFilter} onFilter={setModelFilter} />
        : <p style={muted}>尚无模型记录；执行一次刷新后这里会列出每个模型及其状态。</p>}
      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: 'pointer' }}>诊断详情</summary>
        <p style={muted}>以下为原始分类，用于排查异常。主表已按模型合并展示。</p>
        <IdList label="发现新增（diff.added，不等于写入成功）" ids={r.added} />
        <IdList label="真实已应用" ids={r.applied} unknown="后端尚未提供应用记录，不能推断已写入" />
        <IdList label="实际已移除" ids={r.removed} unknown="后端尚未提供移除记录" />
        <IdList label="官方补缺候选" ids={r.officialAdded} />
        <IdList label="缺失候选（不等于已删除）" ids={r.stale} />
        <IdList label="未验证候选" ids={r.unverified} />
        <IdList label="固定保留" ids={r.keep} /><IdList label="固定排除" ids={r.exclude} />
        <div style={{ ...muted, marginTop: 8, overflowWrap: 'anywhere' }}>实际核对端点：{r.officialEndpoint ?? '尚无记录'}</div>
      </details>
      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: 'pointer' }}>官方清单高级配置{dirty.current ? '（草稿未保存）' : ''}</summary>
        <p style={muted}>仅配置端点、协议与凭据名称，不输入真实密钥。空字段允许后端采用已验证默认值；未知协议不得猜测。完整性默认关闭。</p>
        <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
          <label style={row}><input type="checkbox" checked={draft.disabled} onChange={(e) => change('disabled', e.target.checked)} />禁用此路由官方核对（配置为 null）</label>
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            <label>官方列表完整 URL <input style={{ ...input, width: '100%' }} type="url" value={draft.endpoint} disabled={draft.disabled} placeholder="https://provider.example/v1/models" onChange={(e) => change('endpoint', e.target.value)} /></label>
            <label>推理 baseUrl（与列表 URL 分开） <input style={{ ...input, width: '100%' }} type="url" value={draft.baseUrl} disabled={draft.disabled} placeholder="留空继承目录同协议端点" onChange={(e) => change('baseUrl', e.target.value)} /></label>
            <label>清单鉴权 <select style={{ ...input, marginLeft: 8 }} value={draft.auth} disabled={draft.disabled} onChange={(e) => change('auth', e.target.value as OfficialDraft['auth'])}><option value="">使用适配器默认</option><option value="bearer">Bearer</option><option value="anthropic">Anthropic x-api-key</option><option value="none">公开接口（不发凭据）</option></select></label>
            <label>推理协议 <select style={{ ...input, marginLeft: 8 }} value={draft.protocol} disabled={draft.disabled} onChange={(e) => change('protocol', e.target.value as Protocol | '')}>
              <option value="">使用已验证默认 / 不指定</option><option value="openai-completions">openai-completions</option><option value="openai-responses">openai-responses</option><option value="anthropic-messages">anthropic-messages</option>
            </select></label>
            <label>凭据环境变量名称 <input style={{ ...input, width: '100%' }} value={draft.apiKeyEnv} disabled={draft.disabled} placeholder="PROVIDER_API_KEY（名称，不是密钥）" autoComplete="off" onChange={(e) => change('apiKeyEnv', e.target.value)} /></label>
            <label style={row}><input type="checkbox" checked={draft.complete} disabled={draft.disabled} onChange={(e) => change('complete', e.target.checked)} />我确认此端点返回当前套餐的权威全量清单</label>
            <span style={warning}>仅明确确认套餐范围、分页处理和完整性后启用；开启后允许将清单缺失用于移除判定。</span>
            <div style={row}>
              <label>未知模型上下文默认值 <input style={{ ...input, width: 130 }} type="number" min={1} step={1} value={draft.contextWindow} disabled={draft.disabled} onChange={(e) => change('contextWindow', e.target.value)} /></label>
              <label>未知模型输出默认值 <input style={{ ...input, width: 130 }} type="number" min={1} step={1} value={draft.maxTokens} disabled={draft.disabled} onChange={(e) => change('maxTokens', e.target.value)} /></label>
            </div>
            <span style={muted}>显式默认值是你的配置，不是官方已公布的模型能力；留空时能力不足的模型可能待确认。</span>
            <label style={row}><input type="checkbox" checked={draft.assumeChat} disabled={draft.disabled} onChange={(e) => change('assumeChat', e.target.checked)} />我确认缺少类型元数据的官方新增 ID 可用于文本聊天</label>
            <span style={warning}>默认不猜用途。仅在明确此套餐只提供聊天模型时确认；明确标为 embedding、音频或图像生成的条目仍不会加入。</span>
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
  const [grantOpen, setGrantOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const closeGrant = useCallback(() => setGrantOpen(false), [])
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
    }, '设置已保存。实际变更请以刷新后的应用记录为准。')
  }
  const saveOfficial = async (route: string, config: OfficialConfig | null): Promise<boolean> => run(async () => {
    // 提交完整字典前读取最新状态，只覆盖当前路由，保留其他 provider 配置。
    const latest = await getJson<Status>(`${BASE}/status`)
    const previous = latest.settings.officialRoutes ?? {}
    const value = config === null ? null : { ...(previous[route] ?? {}), ...config }
    await postJson(`${BASE}/config`, { expectedRevision: latest.settingsRevision, officialRoutes: { ...previous, [route]: value } })
    await reload()
  }, `${route} 官方配置已保存。`)
  const toggleRoute = async (route: string, enabled: boolean): Promise<void> => {
    await run(async () => { await postJson(`${BASE}/route`, { route, enabled }); await reload() }, `${route} ${enabled ? '启用' : '停用'}请求已接受；同步结果以状态记录为准。`)
  }
  const refreshNow = async (): Promise<void> => {
    await run(async () => { await postJson(`${BASE}/refresh`, {}); await reload() }, '刷新请求已接受；发现新增、已应用与待确认会分别更新。')
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
    return !search || [r.route, r.as ?? '', ...(r.added ?? []), ...(r.applied ?? []), ...(r.pending ?? []).map((item) => `${item.id} ${item.reason}`), ...(r.warnings ?? []), ...(r.conflicts ?? []), r.error ?? ''].join(' ').toLocaleLowerCase().includes(search)
  })
  const sum = (key: 'added' | 'applied' | 'pending' | 'removed'): number => routes.reduce((n, r) => n + (r[key]?.length ?? 0), 0)
  const disabled = busy || status?.running === true || status?.initialized === false
  return <div style={{ maxWidth: 920 }}>
    <h2 style={{ marginTop: 0 }}>模型目录刷新（高级）</h2>
    <p style={muted}>日常用法：在「模型」页每个 provider 卡片上点「从端点获取可用模型」，即可看到该服务商真正提供的模型并一键追加。本页只用于诊断、批量核对与移除策略。</p>
    {loadError && <div role="alert" style={{ ...box, ...failure }}>状态读取失败：{loadError}。保留上次状态与未保存草稿。</div>}
    {actionError && <div role="alert" style={{ ...box, ...failure }}>操作失败：{actionError} <button style={button} onClick={() => setActionError(null)}>关闭错误提示</button></div>}
    {notice && <div role="status" style={{ ...box, ...muted }}>{notice}</div>}
    {!status && !loadError && <p role="status">正在读取状态…</p>}
    {status && <>
      <section style={box}>
        <div style={{ ...row, justifyContent: 'space-between' }}><strong>{status.degraded ? '插件启动失败' : status.running ? '正在刷新…' : '刷新就绪'}</strong><span style={muted}>上次运行：{fmtTime(status.lastRun)}</span><button style={button} disabled={disabled} onClick={() => void refreshNow()}>立即刷新</button></div>
        <div style={{ ...row, marginTop: 12 }}><span>{routes.length} 个路由</span><span>{routes.filter((r) => r.enabled).length} 已启用</span><span>{routes.filter(hasIssue).length} 有异常</span><span>发现 {sum('added')}</span><span>已应用 {sum('applied')}{routes.some((r) => r.applied === undefined) ? '（部分路由未报告）' : ''}</span><span>待确认 {sum('pending')}</span><span>已移除 {sum('removed')}</span></div>
        {status.piAiUpstream && <div style={{ ...row, marginTop: 8 }}><span style={badge}>pi-ai {status.piAiUpstream.version ? `@${status.piAiUpstream.version}` : '不可用'}</span><span style={muted}>{status.piAiUpstream.providerCount} 个 provider · {status.piAiUpstream.modelCount} 个聊天模型 · 检查于 {fmtTime(status.piAiUpstream.checkedAt)}</span>{status.piAiUpstream.stale && <span style={warning}>上游不可用，正在使用缓存：{status.piAiUpstream.error}</span>}{!status.piAiUpstream.version && <span style={warning}>未找到有效上游缓存：{status.piAiUpstream.error}</span>}</div>}
        {status.degraded && <p role="alert" style={failure}>启动失败：{status.lastError ?? '未知原因'}。{status.degradedHint}</p>}
        {status.warnings?.map((item, i) => <p key={i} style={warning}>{item}</p>)}
        {!status.degraded && status.lastError && <p role="alert" style={failure}>最近运行错误：{status.lastError}</p>}
        {status.restartRequired && <p style={warning}>后端报告目录已变更，需要重启后生效。本页面不会自动重启。</p>}
        {status.catalogWritable === false && <div style={{ ...row, marginTop: 10 }}><span style={warning}>目录写入不可用；候选发现不等于写入成功。</span>{status.catalogGrantCommand && <button style={button} onClick={() => setGrantOpen(true)}>查看授权说明</button>}</div>}
      </section>
      <ManualModels models={(status.settings as Status['settings'] & { manualModels?: Record<string, ManualModel[]> }).manualModels ?? {}}
        targets={status.providerTargets ?? []} applications={status.providerApplications ?? {}} disabled={busy || status.initialized === false}
        request={<T,>(endpoint: string, body: unknown) => postJson<T>(`${BASE}/${endpoint}`, body)} reload={reload} getLatest={() => getJson<Status>(`${BASE}/status`)} />
      <div style={{ ...row, marginBottom: 12 }}>
        <label style={{ flexGrow: 1 }}>搜索路由 / 模型 <input style={{ ...input, width: '100%' }} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="名称、模型 ID、待确认原因" /></label>
        <label>筛选 <select style={input} value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">全部</option><option value="enabled">已启用</option><option value="issues">异常 / 警告</option><option value="pending">待确认</option></select></label>
      </div>
      <h3>Provider 路由 <small style={muted}>{visible.length} / {routes.length} · 默认折叠</small></h3>
      {visible.length === 0 && <p style={muted}>没有匹配的路由。</p>}
      {routes.map((r) => <div key={r.route} hidden={!visible.some((item) => item.route === r.route)}><RouteCard r={r} config={status.settings.officialRoutes?.[r.route]} busy={disabled} expanded={expanded.has(r.route)} onToggle={() => toggleExpand(r.route)} onEnable={(enabled) => void toggleRoute(r.route, enabled)} onSaveOfficial={(config) => saveOfficial(r.route, config)} /></div>)}
      {draft && <section style={{ ...box, marginTop: 18 }}>
        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>全局设置 · 检查间隔、代理、写入权限与移除策略</summary>
          <p style={muted}>模型清单同步自 pi-ai 上游；官方清单用于核对套餐可用性。默认不写安装目录、不移除模型。</p>
          <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: '10px 0 0', display: 'grid', gap: 10 }}>
            <div style={row}><label>间隔（分钟） <input style={{ ...input, width: 110 }} type="number" min={1} value={draft.intervalMinutes} onChange={(e) => updateDraft('intervalMinutes', e.target.value)} /></label><label>代理 URL（留空直连） <input style={input} value={draft.proxyUrl} placeholder="http://127.0.0.1:7890" onChange={(e) => updateDraft('proxyUrl', e.target.value)} /></label></div>
            <label style={row}><input type="checkbox" checked={draft.patchCatalog} onChange={(e) => updateDraft('patchCatalog', e.target.checked)} />允许同步安装目录 catalog（需写权限）</label>
            <label style={row}><input type="checkbox" checked={draft.modelsDevFallback} onChange={(e) => updateDraft('modelsDevFallback', e.target.checked)} />pi-ai 上游不可用时改用 models.dev 备选</label>
            <label style={row}><input type="checkbox" checked={draft.officialVerify} onChange={(e) => updateDraft('officialVerify', e.target.checked)} />启用官方清单核对与补缺</label>
            <details>
              <summary style={{ cursor: 'pointer', ...muted }}>移除策略（默认关闭；只有权威全量清单连续确认缺失才会移除）</summary>
              <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                <label style={row}><input type="checkbox" checked={draft.removeStale} onChange={(e) => updateDraft('removeStale', e.target.checked)} />允许移除连续确认缺失的模型</label>
                <div style={row}><label>缺失宽限期（小时） <input style={{ ...input, width: 110 }} type="number" min={1} value={draft.staleGraceHours} onChange={(e) => updateDraft('staleGraceHours', e.target.value)} /></label><label>连续确认次数 <input style={{ ...input, width: 100 }} type="number" min={2} step={1} value={draft.staleConfirmations} onChange={(e) => updateDraft('staleConfirmations', e.target.value)} /></label></div>
              </div>
            </details>
            <div style={row}><button style={button} onClick={() => void saveGlobal()}>保存全局设置</button><button style={button} onClick={() => { const reset = toGlobalDraft(status.settings); setDraft(reset); globalBase.current = reset; draftRevision.current = status.settingsRevision }}>放弃全局草稿</button></div>
          </fieldset>
        </details>
      </section>}
    </>}
    {grantOpen && status?.catalogGrantCommand && <GrantDialog command={status.catalogGrantCommand} note={status.catalogGrantNote ?? ''} onClose={closeGrant} />}
  </div>
}

type DiscoverCandidate = {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  reasoning?: boolean
  configured: boolean
}
type DiscoverResult = {
  route: string
  namespace: string
  profileHash: string
  api: string
  baseURL: string
  endpoint: string
  partial: boolean
  fetchedAt: string
  configured: string[]
  candidates: DiscoverCandidate[]
  filtered: { id: string; reason: string }[]
}
/**
 * 一键从 provider 自己的 `/models` 端点取真实清单，勾选后直接追加到该 provider 的
 * `models` 配置。只追加、不改写已有条目；拉取与写入都不发推理请求。
 */
function ProviderFetch(props: { provider?: { provider?: string; id?: string; settingsNs?: string } }): JSX.Element {
  const route = props.provider?.provider ?? props.provider?.id ?? ''
  const namespace = props.provider?.settingsNs ?? PI_AI_NAMESPACE
  return route ? <ProviderFetchPanel key={`${namespace}/${route}`} route={route} namespace={namespace} /> : <></>
}
function ProviderFetchPanel({ route, namespace }: { route: string; namespace: string }): JSX.Element {
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [data, setData] = useState<DiscoverResult | null>(null)
  const [message, setMessage] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  const run = async (notice = ''): Promise<void> => {
    setPhase('loading'); setMessage(notice); setData(null); setPicked(new Set())
    try {
      const next = await postJson<DiscoverResult>(`${BASE}/discover`, { route, namespace })
      if (!active.current) return
      setData(next); setOpen(true); setPhase('ready')
    } catch (e) { if (active.current) { setPhase('error'); setMessage(`${notice}${notice ? ' ' : ''}${messageOf(e)}`) } }
  }
  const adopt = async (): Promise<void> => {
    if (!data || picked.size === 0) return
    setSaving(true); setMessage('')
    try {
      const params = Object.fromEntries(data.candidates.filter((c) => picked.has(c.id)).map((c) => [c.id, {
        name: c.name, contextWindow: c.contextWindow, maxTokens: c.maxTokens, reasoning: c.reasoning === true,
      }]))
      const result = await postJson<{ adopted: string[] }>(`${BASE}/adopt`, { route, namespace: data.namespace, profileHash: data.profileHash, ids: [...picked], params })
      if (!active.current) return
      await run(`已追加并保存 ${result.adopted.length} 个模型；清单不代表推理已测通。`)
    } catch (e) { if (active.current) setMessage(messageOf(e)) } finally { if (active.current) setSaving(false) }
  }
  const toggle = (id: string): void => setPicked((old) => {
    const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next
  })
  const addable = data?.candidates.filter((c) => !c.configured) ?? []
  return <div style={{ marginTop: 8 }}>
    <div style={{ ...row, gap: 8 }}>
      <button type="button" style={button} disabled={saving || phase === 'loading'} onClick={() => void run()}>
        {phase === 'loading' ? '正在拉取…' : '从端点获取可用模型'}
      </button>
      {data && <span style={muted}>{data.candidates.length} 个清单候选 · 已配置 {data.configured.length} 个 · 端点 {data.endpoint}</span>}
    </div>
    {message && <div role="status" style={muted}>{message}</div>}
    {data && open && phase !== 'loading' && <div style={{ marginTop: 8 }}>
      <p style={muted}>清单仅证明端点列出这些 ID，不代表套餐权限、聊天用途或推理已验证；缺失容量沿用目录或 provider 默认值。未知能力可在手动模型编辑中确认。</p>
      {data.partial && <p style={warning}>端点返回的是分页清单，可能不完整。</p>}
      <div style={{ ...row, gap: 6 }}>
        <button type="button" style={button} onClick={() => setPicked(new Set(addable.map((c) => c.id)))}>全选未配置</button>
        <button type="button" style={button} onClick={() => setPicked(new Set())}>清空选择</button>
        <button type="button" style={button} disabled={saving || picked.size === 0} onClick={() => void adopt()}>添加选中 {picked.size || ''}</button>
        <button type="button" style={button} onClick={() => setOpen(false)}>收起</button>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 6 }}>
        <thead><tr style={{ textAlign: 'left' }}>
          <th style={{ padding: '4px 6px', width: 28 }} />
          <th style={{ padding: '4px 6px' }}>模型</th>
          <th style={{ padding: '4px 6px', width: 110 }}>上下文 / 输出</th>
        </tr></thead>
        <tbody>{data.candidates.map((c) => <tr key={c.id} style={{ borderTop: '1px solid var(--dsh-border, #333)', opacity: c.configured ? 0.55 : 1 }}>
          <td style={{ padding: '4px 6px' }}><input type="checkbox" disabled={c.configured} checked={c.configured || picked.has(c.id)} onChange={() => toggle(c.id)} /></td>
          <td style={{ padding: '4px 6px', overflowWrap: 'anywhere' }}><code>{c.id}</code>{c.reasoning ? <span style={muted}> · 思考</span> : null}{c.configured ? <span style={muted}> · 已配置</span> : null}</td>
          <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>{fmtTokens(c.contextWindow)} / {fmtTokens(c.maxTokens)}</td>
        </tr>)}</tbody>
      </table>
      {data.candidates.length === 0 && <p style={muted}>端点没有返回可用的聊天模型。</p>}
    </div>}
    {phase === 'error' && message && <div role="alert" style={failure}>{message}</div>}
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
  ctx.slots.inject('settings.models.provider-card', () => {
    // `settings.models.provider-card` is a keyed slot: the models page renders it with
    // `{ entryKey: row.entry.settingsNs }`, and the renderer picks the occupant whose
    // `options.key` equals that value. Every llm-pi-ai provider shares the namespace
    // `llm-pi-ai`, so one registration keyed by it appears inside each of those cards.
    if (ctx.slots.entries('settings.models.provider-card').some((entry) => (entry as { key?: string }).key === PI_AI_NAMESPACE)) return () => undefined
    return ctx.slots.register({ name: 'settings.models.provider-card', key: PI_AI_NAMESPACE, order: 50, inject: () => ({}) }, ProviderFetch)
  })
}
