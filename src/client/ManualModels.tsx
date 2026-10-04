import { useState } from 'react'
import type { CSSProperties } from 'react'
import { MANUAL_PROTOCOLS, COMPAT_FIELDS } from '../../lib/model-capabilities.mjs'

export type ManualModel = {
  id: string; name: string; protocol: string; baseUrl: string; contextWindow: number; maxTokens: number
  input: string[]; reasoningEfforts?: false | Record<string, string | null>; compat?: Record<string, unknown>
}
type Draft = { route: string; id: string; name: string; protocol: string; baseUrl: string; context: string; output: string; image: boolean
  reasoning: 'inherit' | 'off' | 'on'; efforts: Record<string, string>; compat: string }
const levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const protocols = MANUAL_PROTOCOLS
const compatFlags = ['supportsDeveloperRole', 'supportsReasoningEffort', 'supportsStrictMode', 'supportsUsageInStreaming', 'supportsStore',
  'requiresToolResultName', 'requiresAssistantAfterToolResult', 'requiresThinkingAsText', 'requiresReasoningContentOnAssistantMessages',
  'supportsThinkingTokenBudget', 'supportsTemperature', 'forceAdaptiveThinking', 'allowEmptySignature', 'supportsStrictTools',
  'supportsLongCacheRetention', 'supportsCacheControlOnTools', 'supportsEagerToolInputStreaming', 'supportsMaxOutputTokens', 'supportsFinishReason']
const labels: Record<string, string> = { supportsDeveloperRole: 'developer 角色', supportsReasoningEffort: 'reasoning_effort 参数', supportsStrictMode: '严格工具模式',
  supportsUsageInStreaming: '流式 usage', supportsStore: 'store 参数', requiresToolResultName: '工具结果需要名称', requiresAssistantAfterToolResult: '工具结果后需要 assistant',
  requiresThinkingAsText: '思考作为文本', requiresReasoningContentOnAssistantMessages: 'assistant 需要 reasoning_content', supportsThinkingTokenBudget: '思考 token 预算',
  supportsTemperature: 'temperature 参数', forceAdaptiveThinking: '强制自适应思考', allowEmptySignature: '允许空思考签名', supportsStrictTools: '严格工具声明',
  supportsLongCacheRetention: '长时缓存', supportsCacheControlOnTools: '工具缓存控制', supportsEagerToolInputStreaming: '提前流式工具输入', supportsMaxOutputTokens: 'max_output_tokens 参数', supportsFinishReason: 'finish_reason' }
const box: CSSProperties = { border: '1px solid var(--dsh-border, #555)', borderRadius: 8, padding: 14, marginBottom: 12 }
const input: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: 7, borderRadius: 5, background: 'var(--dsh-bg, #1e1e1e)', color: 'inherit', border: '1px solid var(--dsh-border, #555)' }
const row: CSSProperties = { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }
const button: CSSProperties = { padding: '6px 12px', cursor: 'pointer' }
const empty = (route = ''): Draft => ({ route, id: '', name: '', protocol: 'openai-completions', baseUrl: '', context: '', output: '', image: false, reasoning: 'off', efforts: {}, compat: '{}' })
function modelDraft(route: string, m: ManualModel): Draft {
  return { route, id: m.id, name: m.name, protocol: m.protocol, baseUrl: m.baseUrl, context: String(m.contextWindow), output: String(m.maxTokens),
    image: m.input.includes('image'), reasoning: m.reasoningEfforts === undefined ? 'inherit' : m.reasoningEfforts === false ? 'off' : 'on',
    efforts: m.reasoningEfforts && typeof m.reasoningEfforts === 'object' ? Object.fromEntries(Object.entries(m.reasoningEfforts).map(([k, v]) => [k, v ?? ''])) : {}, compat: JSON.stringify(m.compat ?? {}, null, 2) }
}
export function ManualModels(props: { models: Record<string, ManualModel[]>; targets: { id: string }[]; applications: Record<string, unknown>; disabled: boolean
  request: <T>(endpoint: string, body: unknown) => Promise<T>; reload: () => Promise<unknown>; getLatest: () => Promise<{ settingsRevision?: number; settings: { manualModels?: Record<string, ManualModel[]> } }> }): JSX.Element {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [original, setOriginal] = useState<{ route: string; model: ManualModel } | null>(null)
  const [route, setRoute] = useState('')
  const [namespace, setNamespace] = useState('')
  const [apiKeyEnv, setApiKeyEnv] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState<{ text: string; revision?: number; route: string; namespace: string; apiKeyEnv: string; hash: string } | null>(null)
  const target = namespace || props.targets[0]?.id || ''
  const run = async (work: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try { await work() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const change = <K extends keyof Draft>(key: K, value: Draft[K]): void => setDraft(d => d ? { ...d, [key]: value } : d)
  const start = (selectedRoute: string, model?: ManualModel): void => {
    setOriginal(model ? { route: selectedRoute, model } : null); setDraft(model ? modelDraft(selectedRoute, model) : empty(selectedRoute)); setError('')
  }
  const save = (): void => { void run(async () => {
    if (!draft) return
    const compat = JSON.parse(draft.compat) as Record<string, unknown>
    const efforts = Object.fromEntries(levels.filter(k => draft.efforts[k]?.trim()).map(k => [k, draft.efforts[k].trim()]))
    const model: ManualModel = { id: draft.id.trim(), name: draft.name.trim(), protocol: draft.protocol, baseUrl: draft.baseUrl.trim(),
      contextWindow: Number(draft.context), maxTokens: Number(draft.output), input: draft.image ? ['text', 'image'] : ['text'], compat,
      ...(draft.reasoning === 'inherit' ? {} : { reasoningEfforts: draft.reasoning === 'off' ? false as const : efforts }) }
    const latest = await props.getLatest()
    if (original && JSON.stringify(latest.settings.manualModels?.[original.route]?.find(m => m.id === original.model.id)) !== JSON.stringify(original.model)) throw new Error('此模型已被其它页面修改，请重新打开编辑')
    await props.request('manual/save', { route: draft.route.trim(), model, previousId: original?.model.id, expectedRevision: latest.settingsRevision })
    setRoute(draft.route.trim()); setDraft(null); setPreview(null); await props.reload(); setNotice('模型声明已保存；请预览并应用到 DSH 配置。')
  }) }
  const remove = (selectedRoute: string, model: ManualModel): void => { void run(async () => {
    const latest = await props.getLatest()
    if (JSON.stringify(latest.settings.manualModels?.[selectedRoute]?.find(m => m.id === model.id)) !== JSON.stringify(model)) throw new Error('模型已变化，请重新载入')
    await props.request('manual/save', { route: selectedRoute, id: model.id, remove: true, expectedRevision: latest.settingsRevision })
    setPreview(null); await props.reload(); setNotice('声明已移除。已应用的配置需重新应用剩余声明，或撤销该 provider 的插件变更。')
  }) }
  const inspect = (): void => { void run(async () => {
    const latest = await props.getLatest()
    const result = await props.request<{ previewHash: string }>('manual/preview', { route, namespace: target, ...(apiKeyEnv.trim() ? { apiKeyEnv: apiKeyEnv.trim() } : {}), expectedRevision: latest.settingsRevision })
    setPreview({ text: JSON.stringify(result, null, 2), revision: latest.settingsRevision, route, namespace: target, apiKeyEnv: apiKeyEnv.trim(), hash: result.previewHash })
  }) }
  const apply = (): void => { void run(async () => {
    if (!preview || preview.route !== route || preview.namespace !== target || preview.apiKeyEnv !== apiKeyEnv.trim()) throw new Error('目标已变化，请重新预览')
    await props.request('manual/apply', { route, namespace: target, previewHash: preview.hash, ...(preview.apiKeyEnv ? { apiKeyEnv: preview.apiKeyEnv } : {}), expectedRevision: preview.revision })
    setPreview(null); await props.reload(); setNotice('DSH 配置已提交并由 Loader 应用；这不代表远端推理已验证。')
  }) }
  const revert = (): void => { void run(async () => {
    const latest = await props.getLatest()
    await props.request('manual/revert', { route, namespace: target, expectedRevision: latest.settingsRevision })
    setPreview(null); await props.reload(); setNotice('本插件对该 provider 的配置变更已撤销，模型声明仍保留。')
  }) }
  const locked = busy || props.disabled
  let compat: Record<string, unknown> = {}
  try { compat = JSON.parse(draft?.compat ?? '{}') } catch { /* Keep invalid JSON editable. */ }
  const setCompat = (key: string, value: string): void => {
    if (!draft) return
    try {
      const next = JSON.parse(draft.compat) as Record<string, unknown>
      if (value === '') delete next[key]; else next[key] = value === 'true' ? true : value === 'false' ? false : value
      change('compat', JSON.stringify(next, null, 2))
    } catch { setError('请先修正兼容 JSON，再使用字段控件') }
  }
  return <section style={box}>
    <div style={{ ...row, justifyContent: 'space-between' }}><h3 style={{ margin: 0 }}>手动模型与高级能力</h3><button style={button} disabled={locked} onClick={() => start(route)}>手动增加模型</button></div>
    <p style={{ fontSize: 12, opacity: .75 }}>可新增模型，也可覆盖现有模型的能力。声明与自动发现独立保存；无需写安装目录。凭据仅填写名称。相同 provider 使用同一协议和端点；不同端点请使用独立名称。</p>
    {Object.entries(props.models).flatMap(([provider, models]) => models.map(model => <div key={`${provider}/${model.id}`} style={{ ...row, marginBottom: 6 }}>
      <code>{provider} / {model.id}</code><span>{model.name}</span><small>{model.protocol} · {model.contextWindow} / {model.maxTokens}</small>
      <button style={button} disabled={locked} onClick={() => { setRoute(provider); start(provider, model) }}>编辑</button>
      <button style={button} disabled={locked} onClick={() => remove(provider, model)}>移除声明</button>
    </div>))}
    {draft && <fieldset disabled={locked} style={{ ...box, marginTop: 12 }}><legend>{original ? '编辑模型' : '新增模型'}</legend>
      <div style={grid}>
        <label>Provider 名称<input style={input} value={draft.route} disabled={Boolean(original)} placeholder="例如 my-provider" onChange={e => change('route', e.target.value)} /></label>
        <label>模型 ID<input style={input} value={draft.id} onChange={e => change('id', e.target.value)} /></label>
        <label>显示名称<input style={input} value={draft.name} onChange={e => change('name', e.target.value)} /></label>
        <label>推理协议<select style={input} value={draft.protocol} onChange={e => change('protocol', e.target.value)}>{protocols.map(p => <option key={p}>{p}</option>)}</select></label>
        <label>推理根 URL<input style={input} type="url" value={draft.baseUrl} placeholder="https://provider.example/v1" onChange={e => change('baseUrl', e.target.value)} /></label>
        <label>上下文容量<input style={input} type="number" min={1} value={draft.context} onChange={e => change('context', e.target.value)} /></label>
        <label>最大输出 token<input style={input} type="number" min={1} value={draft.output} onChange={e => change('output', e.target.value)} /></label>
        <label>推理能力<select style={input} value={draft.reasoning} onChange={e => change('reasoning', e.target.value as Draft['reasoning'])}><option value="inherit">继承原生模型（新 ID 不推断）</option><option value="off">关闭推理</option><option value="on">显式配置档位</option></select></label>
      </div>
      <p><label><input type="checkbox" checked={draft.image} onChange={e => change('image', e.target.checked)} />支持图像输入（默认文本）</label></p>
      {draft.reasoning === 'on' && <div><p>填写端点实际接受的档位值，留空表示不提供该档位。布尔“支持推理”无法确定 wire 参数。</p><div style={grid}>{levels.map(level => <label key={level}>{level}<input style={input} value={draft.efforts[level] ?? ''} placeholder="实际参数值；留空不提供" onChange={e => change('efforts', { ...draft.efforts, [level]: e.target.value })} /></label>)}</div></div>}
      <details style={{ marginTop: 12 }}><summary>协议兼容设置</summary><p style={{ fontSize: 12 }}>按端点文档设置；留空继承原生配置。目标 DSH 会验证字段是否适用于所选协议，不猜测兼容能力。</p>
        <div style={grid}>{compatFlags.filter(key => COMPAT_FIELDS[draft.protocol]?.includes(key)).map(key => <label key={key}>{labels[key]}<select style={input} value={compat[key] === undefined ? '' : String(compat[key])} onChange={e => setCompat(key, e.target.value)}><option value="">继承 / 未指定</option><option value="true">是</option><option value="false">否</option></select></label>)}</div>
        {draft.protocol === 'openai-completions' && <label>输出 token 参数<select style={input} value={String(compat.maxTokensField ?? '')} onChange={e => setCompat('maxTokensField', e.target.value)}><option value="">继承</option><option>max_tokens</option><option>max_completion_tokens</option></select></label>}
        <label>兼容 JSON（上述控件同步编辑；不接受密钥）<textarea style={{ ...input, minHeight: 130, fontFamily: 'monospace' }} value={draft.compat} onChange={e => change('compat', e.target.value)} /></label>
      </details>
      <div style={{ ...row, marginTop: 12 }}><button style={button} onClick={save}>保存模型声明</button><button style={button} onClick={() => { setDraft(null); setOriginal(null) }}>取消编辑</button></div>
    </fieldset>}
    <fieldset disabled={locked} style={{ border: 0, padding: 0, marginTop: 14 }}><div style={grid}>
      <label>应用到 provider<input style={input} list="manual-provider-names" value={route} onChange={e => { setRoute(e.target.value); setPreview(null) }} /><datalist id="manual-provider-names">{Object.keys(props.models).map(p => <option key={p} value={p} />)}</datalist></label>
      <label>DSH 配置入口<select style={input} value={target} onChange={e => { setNamespace(e.target.value); setPreview(null) }}>{props.targets.map(t => <option key={t.id}>{t.id}</option>)}</select></label>
      <label>凭据环境变量名称<input style={input} value={apiKeyEnv} autoComplete="off" placeholder="留空保留已有凭据配置" onChange={e => { setApiKeyEnv(e.target.value); setPreview(null) }} /></label>
    </div><div style={{ ...row, marginTop: 10 }}>
      <button style={button} disabled={!target || !route} onClick={inspect}>预览配置变更</button>
      <button style={button} disabled={!preview || !target} onClick={apply}>应用到 DSH</button>
      <button style={button} disabled={!props.applications[`${target}/${route}`]} onClick={revert}>撤销此 provider 的插件变更</button>
    </div></fieldset>
    {!props.targets.length && <p role="status">配置编辑服务尚不可用。模型声明可以保存；应用需要当前 DSH 挂载 configEditor 与 pi-ai 配置入口。</p>}
    {preview && <details open><summary>应用预览</summary><pre style={{ overflow: 'auto', maxHeight: 300 }}>{preview.text}</pre></details>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert" style={{ color: '#e97878' }}>{error}</p>}
  </section>
}
