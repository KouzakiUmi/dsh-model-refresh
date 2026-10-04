// Protocol fields offered by the DSH 0.2.1-alpha.1 profile editor.
// Pure data shared by the client form and declaration validator.
export const MANUAL_PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages'];
export const COMPAT_FIELDS = {
  'openai-completions': ['supportsStore', 'supportsDeveloperRole', 'supportsReasoningEffort', 'supportsUsageInStreaming', 'supportsFinishReason',
    'maxTokensField', 'requiresToolResultName', 'requiresAssistantAfterToolResult', 'requiresThinkingAsText',
    'requiresReasoningContentOnAssistantMessages', 'thinkingFormat', 'chatTemplateKwargs', 'chatTemplateArgs',
    'supportsThinkingTokenBudget', 'thinkingTokenBudgetField', 'vllmPriority', 'supportsStrictMode', 'cacheControlFormat', 'supportsLongCacheRetention'],
  'openai-responses': ['supportsDeveloperRole', 'supportsMaxOutputTokens', 'supportsStrictMode', 'supportsLongCacheRetention'],
  'anthropic-messages': ['supportsEagerToolInputStreaming', 'supportsLongCacheRetention', 'supportsCacheControlOnTools',
    'supportsTemperature', 'forceAdaptiveThinking', 'allowEmptySignature', 'supportsStrictTools'],
};
