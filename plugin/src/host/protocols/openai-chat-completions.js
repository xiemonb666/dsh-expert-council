// OpenAI-compatible Chat Completions adapter (docs/contracts.md §2).
//
// Wire contract:
//   POST {baseUrl}/v1/chat/completions
//   Authorization: Bearer <apiKey>
//   messages: [{ role: 'system' }, { role: 'user' }]
//   max_tokens (or max_completion_tokens when configured)
//
// Non-streaming only: `stream: false` is always sent, SSE responses are
// rejected as BAD_RESPONSE instead of being silently truncated.

import {
  ProtocolError,
  assertNotAborted,
  buildEndpointUrl,
  buildErrorResult,
  emptyUsage,
  extractErrorFields,
  isRetryable,
  joinTextBlocks,
  makeFailure,
  makeSuccess,
  normalizeBaseUrl as normalizeBase,
  optionalTemperature,
  parseRetryAfter,
  pickRequestId,
  positiveInteger,
  renderUserText,
  resolveResponsePayload,
  sanitizeCode,
  sanitizeMessage,
  statusOf,
  tokenCount,
  tryParseJson,
} from './shared.js'

export const id = 'openai_chat_completions'
export const label = 'OpenAI Chat Completions'

// First release is explicitly non-streaming; capabilities are reported
// honestly instead of pretending streaming/usage/tools support.
export const capabilities = Object.freeze({
  nonStream: true,
  streaming: false,
  systemPrompt: true,
  usage: 'optional',
  tools: false,
  reasoning: 'optional',
})

/**
 * Normalize a base URL for this protocol (see shared.normalizeBaseUrl).
 * `https://x/v1` stays `https://x/v1`; the endpoint builder appends only the
 * protocol path, so `/v1/v1` can never be produced.
 */
export function normalizeBaseUrl(baseUrl, protocol = id) {
  return normalizeBase(baseUrl, protocol)
}

function requireModelId(slot) {
  const modelId = slot && typeof slot.modelId === 'string' ? slot.modelId.trim() : ''
  if (modelId === '') {
    throw new ProtocolError('SLOT_UNCONFIGURED', 'slot.modelId is required')
  }
  return modelId
}

/**
 * Build the HTTP request for the Chat Completions wire format.
 *
 * @param {{ slot: object, brief: object, signal?: AbortSignal }} args
 * @returns {{ url: string, method: 'POST', headers: Record<string,string>, body: object, redactedBody: object }}
 */
export function buildRequest({ slot, brief, signal = null } = {}) {
  if (!slot || typeof slot !== 'object') {
    throw new ProtocolError('SLOT_UNCONFIGURED', 'slot is required')
  }
  assertNotAborted(signal)

  const modelId = requireModelId(slot)
  const userText = renderUserText(brief)
  const system = typeof brief.system === 'string' ? brief.system.trim() : ''

  const messages = []
  if (system !== '') messages.push({ role: 'system', content: system })
  messages.push({ role: 'user', content: userText })

  const body = {
    model: modelId,
    messages,
    stream: false,
  }

  const maxTokens = positiveInteger(slot.maxOutputTokens)
  if (maxTokens !== null) {
    // Newer OpenAI reasoning models reject `max_tokens`; the slot opts into
    // `max_completion_tokens` via normalizeSlot's `maxTokensParam`. Never send
    // both, and treat a missing field as the `max_tokens` default.
    if (slot.maxTokensParam === 'max_completion_tokens') {
      body.max_completion_tokens = maxTokens
    } else {
      body.max_tokens = maxTokens
    }
  }

  const temperature = optionalTemperature(slot.temperature)
  if (temperature !== null) body.temperature = temperature

  // Reasoning effort is passed through verbatim when the slot requests one. The
  // adapter never invents a value and never downgrades it: an endpoint that does
  // not accept it returns an error, and that error is shown instead of silently
  // running at a lower effort.
  if (typeof slot.reasoningEffort === 'string' && slot.reasoningEffort !== '') {
    body.reasoning_effort = slot.reasoningEffort
  }

  const headers = {
    'content-type': 'application/json',
    accept: 'application/json',
  }
  if (typeof slot.apiKey === 'string' && slot.apiKey.trim() !== '') {
    headers.authorization = `Bearer ${slot.apiKey.trim()}`
  }

  const url = buildEndpointUrl(slot.baseUrl, id)
  const redactedBody = cloneJson(body)
  return { url, method: 'POST', headers, body, redactedBody }
}

/**
 * Parse a Chat Completions response into the unified contract §2 structure.
 * Malformed / empty responses return `{ ok: false, error }`; they never throw.
 */
export function parseResponse({ slot, response = null, text = null, body = undefined, startedAt = null } = {}) {
  const apiKey = slot && typeof slot.apiKey === 'string' ? slot.apiKey : null
  const status = statusOf(response)
  const headers = response && typeof response === 'object' ? response.headers || null : null
  const payload = resolveResponsePayload({ text, body })
  const rawText = payload.rawText

  if (status !== null && status >= 400) {
    return { ok: false, error: parseError({ slot, status, text: rawText, body: payload.parsed, headers }) }
  }

  let parsed = payload.parsed
  if (parsed === undefined) {
    if (typeof rawText === 'string' && /^\s*(?:data|event):/i.test(rawText)) {
      return makeFailure(
        'BAD_RESPONSE',
        'streaming (SSE) responses are not supported by this non-streaming adapter',
        { apiKey },
      )
    }
    const attempt = tryParseJson(rawText)
    if (!attempt.ok) {
      return makeFailure(
        'BAD_RESPONSE',
        rawText && rawText.trim() !== ''
          ? 'response body is not valid JSON'
          : 'response body is empty',
        { apiKey },
      )
    }
    parsed = attempt.value
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return makeFailure('BAD_RESPONSE', 'response JSON is not an object', { apiKey })
  }

  const requestId = sanitizeCode(pickRequestId(headers, parsed), apiKey)
  const modelId = typeof parsed.model === 'string' && parsed.model !== '' ? parsed.model : null

  if (!Array.isArray(parsed.choices)) {
    const fields = extractErrorFields(parsed)
    if (fields.message !== null) {
      return makeFailure('PROVIDER_ERROR', fields.message, {
        providerCode: fields.code,
        requestId,
        apiKey,
      })
    }
    return makeFailure('BAD_RESPONSE', 'response has no choices[] array', { requestId, apiKey })
  }
  if (parsed.choices.length === 0) {
    return makeFailure('BAD_RESPONSE', 'response has an empty choices[] array', { requestId, apiKey })
  }

  const choice = parsed.choices[0] && typeof parsed.choices[0] === 'object' ? parsed.choices[0] : {}
  const blocks = extractBlocks(choice.message)
  const answer = joinTextBlocks(blocks)
  const finishReason = mapFinishReason(choice.finish_reason)

  if (answer === '') {
    return makeFailure(
      'EMPTY_RESPONSE',
      finishReason === null
        ? 'provider returned no displayable text'
        : `provider returned no displayable text (finish_reason=${finishReason})`,
      { requestId, apiKey },
    )
  }

  return makeSuccess({
    requestId,
    answer,
    blocks,
    finishReason,
    usage: mapUsage(parsed.usage),
    modelId,
    raw: parsed,
    startedAt,
    capabilities,
  })
}

/**
 * Classify an HTTP or transport failure (contract §2). Never throws.
 *
 * @param {{ slot?: object, status?: number, text?: string, body?: unknown, headers?: unknown,
 *           error?: Error, signal?: AbortSignal, timedOut?: boolean }} args
 * @returns {{ category: string, message: string, httpStatus: number|null, providerCode: string|null,
 *            requestId: string|null, retryable: boolean, retryAfterMs: number|null }}
 */
export function parseError({ slot, status, text, body, headers, error = null, signal = null, timedOut = false } = {}) {
  const result = buildErrorResult({
    status,
    text,
    body,
    headers,
    error,
    signal,
    timedOut,
    apiKey: slot && typeof slot.apiKey === 'string' ? slot.apiKey : null,
  })
  return {
    category: result.category,
    message: result.message,
    httpStatus: result.httpStatus,
    providerCode: result.providerCode,
    requestId: result.requestId,
    retryable: result.retryable,
    retryAfterMs: result.retryAfterMs,
  }
}

export { isRetryable, parseRetryAfter, sanitizeMessage }

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function extractBlocks(message) {
  const blocks = []
  if (!message || typeof message !== 'object') return blocks

  const content = message.content
  if (typeof content === 'string') {
    if (content.trim() !== '') blocks.push({ type: 'text', text: content })
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === 'string') {
        if (part.trim() !== '') blocks.push({ type: 'text', text: part })
        continue
      }
      if (!part || typeof part !== 'object') continue
      const type = typeof part.type === 'string' ? part.type.toLowerCase() : ''
      if (type === 'text' || type === 'output_text' || type === 'input_text') {
        if (typeof part.text === 'string' && part.text.trim() !== '') {
          blocks.push({ type: 'text', text: part.text })
        }
      } else if (type === 'reasoning' || type === 'thinking' || type === 'reasoning_summary') {
        const reasoning = reasoningText(part)
        if (reasoning !== null) blocks.push({ type: 'reasoning-summary', text: reasoning })
      }
    }
  }

  // DeepSeek-style `reasoning_content` / OpenAI-style `reasoning`: diagnostic
  // only, never part of the displayable answer.
  const reasoning = reasoningText({ text: message.reasoning_content })
    || reasoningText({ text: message.reasoning })
  if (reasoning !== null) blocks.push({ type: 'reasoning-summary', text: reasoning })

  if (typeof message.refusal === 'string' && message.refusal.trim() !== '') {
    blocks.push({ type: 'text', text: message.refusal })
  }
  return blocks
}

function reasoningText(part) {
  if (!part || typeof part !== 'object') return null
  if (typeof part.text === 'string' && part.text.trim() !== '') return part.text
  if (typeof part.summary === 'string' && part.summary.trim() !== '') return part.summary
  if (Array.isArray(part.summary)) {
    const joined = part.summary
      .map((item) => (item && typeof item.text === 'string' ? item.text : ''))
      .filter((item) => item.trim() !== '')
      .join('\n')
    if (joined.trim() !== '') return joined
  }
  return null
}

function mapFinishReason(value) {
  if (typeof value !== 'string' || value.trim() === '') return null
  const key = value.trim().toLowerCase()
  if (key === 'length') return 'max_tokens'
  if (key === 'tool_calls' || key === 'function_call') return 'tool_use'
  return key
}

function mapUsage(usage) {
  const out = emptyUsage()
  if (!usage || typeof usage !== 'object') return out
  out.inputTokens = tokenCount(usage.prompt_tokens)
  out.outputTokens = tokenCount(usage.completion_tokens)
  out.totalTokens = tokenCount(usage.total_tokens)
  const promptDetails = usage.prompt_tokens_details
  if (promptDetails && typeof promptDetails === 'object') {
    out.cacheReadTokens = tokenCount(promptDetails.cached_tokens)
  }
  if (out.cacheReadTokens === null) {
    // DeepSeek-compatible providers expose cache hits at the top level.
    out.cacheReadTokens = tokenCount(usage.prompt_cache_hit_tokens)
  }
  const completionDetails = usage.completion_tokens_details
  if (completionDetails && typeof completionDetails === 'object') {
    out.reasoningTokens = tokenCount(completionDetails.reasoning_tokens)
  }
  return out
}
