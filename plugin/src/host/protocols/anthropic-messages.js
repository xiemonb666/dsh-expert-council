// Anthropic Messages adapter (docs/contracts.md §2).
//
// Wire contract:
//   POST {baseUrl}/v1/messages
//   anthropic-version: <apiVersion> (default 2023-06-01)
//   x-api-key: <apiKey>  (or Authorization: Bearer <apiKey> when authScheme='bearer')
//   system: top-level string
//   messages: [{ role: 'user', content: [{ type: 'text', text }] }]
//   max_tokens: required
//
// Non-streaming only. `thinking` / `redacted_thinking` blocks are never counted
// as displayable answer text.

import {
  DEFAULT_ANTHROPIC_VERSION,
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

export const id = 'anthropic_messages'
export const label = 'Anthropic Messages'

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

export { DEFAULT_ANTHROPIC_VERSION }

/**
 * Normalize a base URL for this protocol (see shared.normalizeBaseUrl).
 * `https://api.anthropic.com` and `https://api.anthropic.com/v1` both resolve
 * to `.../v1/messages`; `/v1/v1` is impossible.
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
 * Map a slot's reasoning settings onto an Anthropic thinking budget.
 *
 * Two inputs, in priority order:
 *  1. `thinkingBudget` — an explicit token budget, used verbatim (clamped to the
 *     protocol's own constraints). This is the only setting some gateways honor,
 *     so it must be reachable directly.
 *  2. `reasoningEffort` — a level mapped onto a fraction of `max_tokens`.
 *
 * Anthropic requires `budget_tokens` to be smaller than `max_tokens` and at
 * least 1024, and `null` means "no extended thinking".
 *
 * @param {object} slot normalized slot configuration.
 * @param {number} maxTokens the slot's positive max_tokens.
 * @returns {number|null} budget_tokens, or null when thinking is off.
 */
function thinkingBudgetFor(slot, maxTokens) {
  const MIN_BUDGET = 1024
  const ceiling = maxTokens - 1

  const explicit = slot && typeof slot.thinkingBudget === 'number' && Number.isFinite(slot.thinkingBudget)
    ? Math.round(slot.thinkingBudget)
    : null
  if (explicit !== null && explicit > 0) {
    const budget = Math.min(explicit, ceiling)
    return budget < MIN_BUDGET ? null : budget
  }

  const effort = slot && typeof slot.reasoningEffort === 'string' ? slot.reasoningEffort : ''
  if (effort === '' || effort === 'minimal' || effort === 'none' || effort === 'off') return null

  const share = {
    low: 0.25,
    medium: 0.5,
    high: 0.7,
    xhigh: 0.8,
    max: 0.85,
  }[effort]
  if (share === undefined) return null

  // Leave room for the visible answer: budget must stay below max_tokens.
  const candidate = Math.floor(maxTokens * share)
  const budget = Math.min(candidate, ceiling)
  if (budget < MIN_BUDGET) {
    // The output budget is too small to also fund thinking; skip it rather than
    // send a request Anthropic will reject.
    return null
  }
  return budget
}

/**
 * Build the HTTP request for the Anthropic Messages wire format.
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

  // Anthropic requires max_tokens; never invent a default budget.
  const maxTokens = positiveInteger(slot.maxOutputTokens)
  if (maxTokens === null) {
    throw new ProtocolError(
      'CAPABILITY_UNSUPPORTED',
      'anthropic_messages requires a positive integer maxOutputTokens (max_tokens is mandatory)',
    )
  }

  const body = {
    model: modelId,
    max_tokens: maxTokens,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: userText }],
      },
    ],
    stream: false,
  }

  const system = typeof brief.system === 'string' ? brief.system.trim() : ''
  if (system !== '') body.system = system

  const temperature = optionalTemperature(slot.temperature)
  if (temperature !== null) body.temperature = temperature

  // Extended thinking. Anthropic requires `budget_tokens` < `max_tokens`, so the
  // budget is derived from the slot's own output budget instead of a fixed
  // number: an explicit effort maps to a fraction of max_tokens. `temperature`
  // must not be sent alongside thinking, so it is dropped when thinking is on.
  const thinkingBudget = thinkingBudgetFor(slot, maxTokens)
  if (thinkingBudget !== null) {
    body.thinking = { type: 'enabled', budget_tokens: thinkingBudget }
    Reflect.deleteProperty(body, 'temperature')
  }

  const apiVersion = typeof slot.apiVersion === 'string' && slot.apiVersion.trim() !== ''
    ? slot.apiVersion.trim()
    : DEFAULT_ANTHROPIC_VERSION

  const headers = {
    'content-type': 'application/json',
    accept: 'application/json',
    'anthropic-version': apiVersion,
  }
  const apiKey = typeof slot.apiKey === 'string' ? slot.apiKey.trim() : ''
  if (apiKey !== '') {
    if (slot.authScheme === 'bearer') {
      headers.authorization = `Bearer ${apiKey}`
    } else {
      headers['x-api-key'] = apiKey
    }
  }

  const url = buildEndpointUrl(slot.baseUrl, id)
  const redactedBody = cloneJson(body)
  return { url, method: 'POST', headers, body, redactedBody }
}

/**
 * Parse an Anthropic Messages response into the unified contract §2 structure.
 * `thinking` blocks are skipped from the displayable answer (kept only as
 * `reasoning-summary` blocks). Malformed / empty responses never throw.
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

  if (!Array.isArray(parsed.content)) {
    const fields = extractErrorFields(parsed)
    if (fields.message !== null) {
      return makeFailure('PROVIDER_ERROR', fields.message, {
        providerCode: fields.code,
        requestId,
        apiKey,
      })
    }
    return makeFailure('BAD_RESPONSE', 'response has no content[] array', { requestId, apiKey })
  }

  const blocks = extractBlocks(parsed.content)
  const answer = joinTextBlocks(blocks)
  const finishReason = mapStopReason(parsed.stop_reason)

  if (answer === '') {
    return makeFailure(
      'EMPTY_RESPONSE',
      finishReason === null
        ? 'provider returned no displayable text'
        : `provider returned no displayable text (stop_reason=${finishReason})`,
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

function extractBlocks(content) {
  const blocks = []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    const type = typeof part.type === 'string' ? part.type.toLowerCase() : ''
    if (type === 'text') {
      if (typeof part.text === 'string' && part.text.trim() !== '') {
        blocks.push({ type: 'text', text: part.text })
      }
    } else if (type === 'thinking') {
      // Skipped from the answer, retained as a diagnostic reasoning-summary.
      const reasoning = typeof part.thinking === 'string'
        ? part.thinking
        : (typeof part.text === 'string' ? part.text : '')
      if (reasoning.trim() !== '') blocks.push({ type: 'reasoning-summary', text: reasoning })
    }
    // redacted_thinking / tool_use / tool_result / server_tool_use: intentionally
    // dropped — the adapter sends no tools and cannot display opaque payloads.
  }
  return blocks
}

function mapStopReason(value) {
  if (typeof value !== 'string' || value.trim() === '') return null
  const key = value.trim().toLowerCase()
  if (key === 'end_turn' || key === 'stop_sequence') return 'stop'
  if (key === 'max_tokens') return 'max_tokens'
  if (key === 'tool_use') return 'tool_use'
  if (key === 'pause_turn') return 'pause'
  if (key === 'refusal') return 'refusal'
  return key
}

function mapUsage(usage) {
  const out = emptyUsage()
  if (!usage || typeof usage !== 'object') return out
  out.inputTokens = tokenCount(usage.input_tokens)
  out.outputTokens = tokenCount(usage.output_tokens)
  // Anthropic does not report a total; leave it null rather than inventing one.
  out.totalTokens = tokenCount(usage.total_tokens)
  out.cacheReadTokens = tokenCount(usage.cache_read_input_tokens)
  out.reasoningTokens = tokenCount(usage.reasoning_tokens)
  return out
}
