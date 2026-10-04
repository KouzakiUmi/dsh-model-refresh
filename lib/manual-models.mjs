/** User declarations are separate from discovery evidence and never become deletion evidence. */
import { validModelId } from './official.mjs';
import { MANUAL_PROTOCOLS, COMPAT_FIELDS } from './model-capabilities.mjs';
export { MANUAL_PROTOCOLS } from './model-capabilities.mjs';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const compatBooleans = ['supportsStore', 'supportsDeveloperRole', 'supportsReasoningEffort', 'supportsUsageInStreaming', 'supportsFinishReason',
  'requiresToolResultName', 'requiresAssistantAfterToolResult', 'requiresThinkingAsText', 'requiresReasoningContentOnAssistantMessages',
  'supportsThinkingTokenBudget', 'supportsMaxOutputTokens', 'supportsStrictMode', 'supportsLongCacheRetention',
  'supportsEagerToolInputStreaming', 'supportsCacheControlOnTools', 'supportsTemperature', 'forceAdaptiveThinking', 'allowEmptySignature', 'supportsStrictTools'];
const compatEnums = { maxTokensField: ['max_tokens', 'max_completion_tokens'], thinkingFormat: ['openai', 'deepseek', 'openrouter', 'together', 'baseten', 'zai', 'qwen', 'chat-template', 'qwen-chat-template', 'string-thinking', 'ant-ling'],
  thinkingTokenBudgetField: ['thinking_token_budget', 'thinking_budget', 'thinking_budget_tokens'], cacheControlFormat: ['anthropic'] };
export function validateReasoning(value) {
  if (value === false) return false;
  if (!object(value) || !Object.keys(value).length) throw new Error('推理档位须为 false 或非空 JSON 对象');
  for (const [level, wire] of Object.entries(value)) {
    if (!levels.includes(level) || !(typeof wire === 'string' && wire.length > 0 && wire.length < 128 || level === 'off' && wire === null)) throw new Error(`无效推理档位 ${level}；仅 off 可为 null`);
  }
  if (!Object.keys(value).some(key => key !== 'off')) throw new Error('推理能力至少需要一个非 off 档位');
  return structuredClone(value);
}
export function validateCompat(value, protocol) {
  if (!object(value)) throw new Error('兼容设置须为 JSON 对象');
  for (const [key, item] of Object.entries(value)) {
    if (protocol && !COMPAT_FIELDS[protocol]?.includes(key)) throw new Error(`${key} 不适用于协议 ${protocol}`);
    if (compatBooleans.includes(key)) { if (typeof item !== 'boolean') throw new Error(`${key} 须为 boolean`); }
    else if (compatEnums[key]) { if (!compatEnums[key].includes(item)) throw new Error(`${key} 不支持该值`); }
    else if (key === 'vllmPriority') { if (!Number.isSafeInteger(item)) throw new Error('vllmPriority 须为整数'); }
    else if (key === 'chatTemplateKwargs' || key === 'chatTemplateArgs') {
      if (!object(item) || Object.keys(item).length > 100) throw new Error(`${key} 须为有界对象`);
      for (const [field, parameter] of Object.entries(item)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(field) || ['__proto__', 'constructor', 'prototype'].includes(field) || /api.?key|authorization|secret|password/i.test(field)) throw new Error('模板参数不接受危险属性或凭据');
        if (parameter === null || typeof parameter === 'boolean' || typeof parameter === 'number' && Number.isFinite(parameter) || typeof parameter === 'string' && parameter.length <= 256) continue;
        if (!object(parameter) || !['thinking.enabled', 'thinking.effort', 'thinking.budget'].includes(parameter.$var) || Object.keys(parameter).some(k => !['$var', 'omitWhenOff'].includes(k)) || parameter.omitWhenOff !== undefined && typeof parameter.omitWhenOff !== 'boolean') throw new Error('无效的模板变量参数');
      }
    }
    else throw new Error(`不支持的兼容字段 ${key}；不会接受任意请求参数或密钥`);
  }
  return structuredClone(value);
}
export function validateManualModel(value) {
  if (!object(value)) throw new Error('model 须为对象');
  const allowed = ['id', 'name', 'protocol', 'baseUrl', 'contextWindow', 'maxTokens', 'input', 'reasoningEfforts', 'compat'];
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`未知模型字段 ${key}`);
  if (!validModelId(value.id) || value.id.trim() !== value.id) throw new Error('模型 ID 无效');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 256) throw new Error('模型名称无效');
  if (!MANUAL_PROTOCOLS.includes(value.protocol)) throw new Error('请选择明确的推理协议');
  let url;
  try { url = new URL(value.baseUrl); } catch { throw new Error('推理端点无效'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('推理端点不能包含密钥或 fragment');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('非本机推理端点须使用 HTTPS');
  for (const key of ['contextWindow', 'maxTokens']) if (!Number.isSafeInteger(value[key]) || value[key] <= 0 || value[key] > 100_000_000) throw new Error(`${key} 须为有效正整数`);
  if (value.maxTokens > value.contextWindow) throw new Error('输出容量不能大于上下文容量');
  if (!Array.isArray(value.input) || !value.input.length || value.input.some(x => !['text', 'image'].includes(x))) throw new Error('当前 pi-ai 路由只支持 text/image 输入');
  return { id: value.id, name: value.name.trim(), protocol: value.protocol, baseUrl: url.href.replace(/\/+$/, ''),
    contextWindow: value.contextWindow, maxTokens: value.maxTokens, input: [...new Set(value.input)],
    ...(value.reasoningEfforts === undefined ? {} : { reasoningEfforts: validateReasoning(value.reasoningEfforts) }),
    ...(value.compat === undefined ? {} : { compat: validateCompat(value.compat, value.protocol) }) };
}
export function manualProfileModel(model) {
  const { protocol, baseUrl, ...fields } = validateManualModel(model);
  return fields;
}
