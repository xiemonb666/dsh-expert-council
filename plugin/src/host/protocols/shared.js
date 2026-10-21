// Shared primitives for the provider adapters (docs/contracts.md §2).
//
// Hard constraints (docs/contracts.md §0): pure ESM, no bare imports, no
// third-party dependencies, Node built-ins only. This file imports nothing.

export const DEFAULT_ANTHROPIC_VERSION = '2023-06-01'

const ENDPOINT_PATHS = Object.freeze({
  openai_chat_completions: '/chat/completions',
  anthropic_messages: '/messages',
})

const RETRYABLE_CATEGORIES = Object.freeze([
  'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'NETWORK_ERROR',
  'TIMEOUT',
])

// 5xx that are terminal by definition (not transient).
const NON_RETRYABLE_5XX = Object.freeze([501, 505])

const REQUEST_ID_HEADERS = Object.freeze([
  'x-request-id',
  'request-id',
  'x-amzn-requestid',
  'x-amzn-request-id',
  'openai-request-id',
  'anthropic-request-id',
  'cf-ray',
  'x-goog-request-id',
])

// Local (pre-flight) error reasons that are not themselves ErrorCategory values.
// A ProtocolError always exposes a §1 ErrorCategory through `code` (so a caller
// may forward it verbatim) and the precise local reason through `reason`.
const LOCAL_CODE_CATEGORY = Object.freeze({
  INVALID_BRIEF: 'PROVIDER_ERROR',
  UNKNOWN_PROTOCOL: 'CAPABILITY_UNSUPPORTED',
})

/**
 * Error thrown by adapters for locally-detected problems (bad config, bad
 * endpoint, aborted signal).
 *
 * - `code`     always a docs/contracts.md §1 ErrorCategory, safe to forward.
 * - `reason`   the precise local reason (e.g. `INVALID_BRIEF`), for diagnostics.
 * - `category` alias of `code`, for callers that prefer the explicit name.
 */
export class ProtocolError extends Error {
  constructor(code, message, extra = {}) {
    super(message)
    this.name = 'ProtocolError'
    this.reason = code
    this.code = LOCAL_CODE_CATEGORY[code] ?? code
    this.category = this.code
    for (const key of Object.keys(extra)) {
      this[key] = extra[key]
    }
  }
}

export function isKnownProtocol(protocol) {
  return typeof protocol === 'string'
    && Object.prototype.hasOwnProperty.call(ENDPOINT_PATHS, protocol)
}

function invalidEndpoint(message) {
  return new ProtocolError('INVALID_ENDPOINT', message)
}

function snippet(text, max = 200) {
  const value = String(text == null ? '' : text).replace(/\s+/g, ' ').trim()
  if (value.length <= max) return value
  return `${value.slice(0, max)}…`
}

/**
 * Normalize a provider base URL.
 *
 * - trims whitespace and all trailing slashes
 * - keeps an existing `/v1` suffix (the endpoint builder never duplicates it)
 * - rejects relative URLs, non-http(s) schemes, embedded credentials, query
 *   strings and fragments with `ProtocolError('INVALID_ENDPOINT')`
 *
 * @param {string} baseUrl
 * @param {string} [protocol] protocol id, used for validation only
 * @returns {string} normalized base URL, e.g. `https://api.openai.com/v1`
 */
export function normalizeBaseUrl(baseUrl, protocol) {
  if (protocol != null && !isKnownProtocol(protocol)) {
    throw new ProtocolError('UNKNOWN_PROTOCOL', `unknown protocol: ${String(protocol)}`)
  }
  if (typeof baseUrl !== 'string') {
    throw invalidEndpoint('baseUrl must be a string')
  }
  const raw = baseUrl.trim()
  if (raw === '') {
    throw invalidEndpoint('baseUrl is empty')
  }
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw invalidEndpoint(`baseUrl is not a valid absolute URL: ${snippet(raw, 80)}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw invalidEndpoint(`baseUrl must use http or https, got ${parsed.protocol}`)
  }
  if (parsed.hostname === '') {
    throw invalidEndpoint('baseUrl is missing a host')
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw invalidEndpoint('baseUrl must not contain embedded credentials')
  }
  if (parsed.search !== '') {
    throw invalidEndpoint('baseUrl must not contain a query string')
  }
  if (parsed.hash !== '') {
    throw invalidEndpoint('baseUrl must not contain a hash fragment')
  }
  const pathname = parsed.pathname.replace(/\/+$/, '')
  return `${parsed.protocol}//${parsed.host}${pathname}`
}

/**
 * Build the full endpoint URL for a protocol.
 *
 * `https://x` and `https://x/` -> `https://x/v1/<path>`.
 * `https://x/v1` -> `https://x/v1/<path>` (never `/v1/v1`).
 * A base URL that already ends with the protocol path is used verbatim.
 */
export function buildEndpointUrl(baseUrl, protocol) {
  if (!isKnownProtocol(protocol)) {
    throw new ProtocolError('UNKNOWN_PROTOCOL', `unknown protocol: ${String(protocol)}`)
  }
  const base = normalizeBaseUrl(baseUrl, protocol)
  const suffix = ENDPOINT_PATHS[protocol]
  if (base.endsWith(suffix)) return base
  const versioned = /\/v1$/.test(base) ? base : `${base}/v1`
  return `${versioned}${suffix}`
}

/** Host (and non-default port) of an endpoint URL, for diagnostics only. */
export function endpointHost(url) {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

const SECTION_ORDER = Object.freeze(['question', 'context', 'evidence', 'requestedOutput', 'mode'])

const SECTION_TITLES = Object.freeze({
  question: 'Question',
  context: 'Context',
  evidence: 'Evidence',
  requestedOutput: 'Requested output',
  mode: 'Mode',
})

/**
 * Render a consultation brief into the protocol-neutral user text.
 *
 * Both adapters call this exact function so the OpenAI and Anthropic requests
 * are semantically equivalent (only the wire envelope differs). Empty optional
 * sections are omitted, so the rendered text is deterministic.
 *
 * @param {{ system?: string, question?: string, context?: string, evidence?: string, requestedOutput?: string, mode?: string }} brief
 * @returns {string}
 */
export function renderUserText(brief) {
  if (!brief || typeof brief !== 'object') {
    throw new ProtocolError('INVALID_BRIEF', 'brief is required')
  }
  const question = typeof brief.question === 'string' ? brief.question.trim() : ''
  if (question === '') {
    throw new ProtocolError('INVALID_BRIEF', 'brief.question is required')
  }
  const sections = []
  for (const key of SECTION_ORDER) {
    const value = brief[key]
    if (typeof value !== 'string') continue
    const text = value.trim()
    if (text === '') continue
    sections.push(`## ${SECTION_TITLES[key]}\n${text}`)
  }
  return sections.join('\n\n')
}

/** Empty UsageMeta: every unknown field is null, never 0 (contract §1). */
export function emptyUsage() {
  return {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    cacheReadTokens: null,
    reasoningTokens: null,
  }
}

/** Coerce a provider token count to a non-negative number, else null. */
export function tokenCount(value) {
  let n = value
  if (typeof n === 'string' && n.trim() !== '') n = Number(n)
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null
  return n
}

/** Positive integer (max token budgets), else null. */
export function positiveInteger(value) {
  const n = tokenCount(value)
  if (n === null || n <= 0 || !Number.isInteger(n)) return null
  return n
}

/** Optional temperature: only finite numbers (including 0) are sent. */
export function optionalTemperature(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

function headerValue(headers, name) {
  if (!headers || typeof headers !== 'object') return null
  if (typeof headers.get === 'function') {
    const value = headers.get(name)
    return value == null ? null : String(value)
  }
  if (headers instanceof Map) {
    const value = headers.get(name)
    return value == null ? null : String(value)
  }
  const lower = String(name).toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== lower) continue
    const value = headers[key]
    if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : null
    return value == null ? null : String(value)
  }
  return null
}

export function getHeader(headers, name) {
  return headerValue(headers, name)
}

/** Best-effort provider request id from headers, falling back to body id. */
export function pickRequestId(headers, body) {
  for (const name of REQUEST_ID_HEADERS) {
    const value = headerValue(headers, name)
    if (value != null && value.trim() !== '') return value.trim()
  }
  if (body && typeof body === 'object') {
    for (const key of ['request_id', 'requestId', 'id']) {
      const value = body[key]
      if (typeof value === 'string' && value.trim() !== '') return value.trim()
    }
  }
  return null
}

/** Parse `retry-after` (seconds or HTTP-date) into milliseconds. */
export function parseRetryAfter(headers) {
  const raw = headerValue(headers, 'retry-after')
  if (raw == null || raw.trim() === '') return null
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const at = Date.parse(raw)
  if (Number.isFinite(at)) return Math.max(0, at - Date.now())
  return null
}

export function tryParseJson(text) {
  if (typeof text !== 'string') return { ok: false, value: null }
  const raw = text.trim()
  if (raw === '') return { ok: false, value: null }
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch {
    return { ok: false, value: null }
  }
}

export function looksLikeHtml(text) {
  if (typeof text !== 'string') return false
  return /<\s*(?:!doctype|html|head|body|div|span|p|h1|h2|pre|title|center)\b/i.test(text)
}

/**
 * Sanitize a provider/transport message before it reaches the session log.
 * Removes the API key if the provider echoed it, strips HTML tags and control
 * characters, collapses whitespace and caps the length.
 */
export function sanitizeMessage(input, { apiKey = null, maxLength = 600 } = {}) {
  let text = typeof input === 'string' ? input : String(input == null ? '' : input)
  text = redactSecretLike(text, apiKey)
  text = text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
  text = text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length > maxLength) text = `${text.slice(0, maxLength)}…`
  return text
}

/**
 * Remove anything that looks like credential material from a provider-supplied
 * string: the exact configured key (when known) plus generic key-shaped tokens
 * such as `sk-...`. Used for error messages, provider codes and request ids,
 * none of which may ever carry the key.
 */
export function redactSecretLike(input, apiKey = null) {
  let text = typeof input === 'string' ? input : String(input == null ? '' : input)
  if (typeof apiKey === 'string') {
    const trimmed = apiKey.trim()
    if (trimmed.length >= 4) {
      text = text.split(apiKey).join('[REDACTED]')
      text = text.split(trimmed).join('[REDACTED]')
    }
  }
  // Generic provider key shapes: sk-..., pk-..., api_key..., bearer tokens.
  text = text.replace(/\b(?:sk|pk|rk|ak)[-_][A-Za-z0-9_-]{10,}/gi, '[REDACTED]')
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/gi, 'Bearer [REDACTED]')
  return text
}

/** Redact a short provider code / request id; null when nothing is left. */
export function sanitizeCode(input, apiKey = null, maxLength = 160) {
  if (typeof input !== 'string') return null
  const text = redactSecretLike(input, apiKey).trim()
  if (text === '' || text === '[REDACTED]') return null
  return text.length > maxLength ? text.slice(0, maxLength) : text
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return null
}

/**
 * Extract `{ message, code }` from a provider error body. Supports the OpenAI
 * (`{ error: { message, type, code } }`), Anthropic
 * (`{ type: 'error', error: { type, message } }`) and generic
 * (`{ message }`, `{ error: 'text' }`, `{ detail }`) shapes.
 */
export function extractErrorFields(body) {
  if (!body || typeof body !== 'object') return { message: null, code: null }
  let message = null
  let code = null
  const err = body.error
  if (typeof err === 'string') {
    message = err
  } else if (err && typeof err === 'object') {
    message = firstNonEmptyString(err.message, err.detail, err.msg, err.error_description)
    code = firstNonEmptyString(err.code, err.type)
  }
  if (message === null) {
    message = firstNonEmptyString(body.message, body.detail, body.msg, body.error_description, body.reason)
  }
  if (code === null) {
    code = firstNonEmptyString(body.code, body.error_code)
  }
  if (code === null && typeof body.type === 'string' && body.type !== 'error') {
    code = body.type
  }
  return {
    message: typeof message === 'string' ? message : null,
    code: typeof code === 'string' ? code : null,
  }
}

export function statusOf(response) {
  if (!response || typeof response !== 'object') return null
  const raw = response.status != null ? response.status : response.statusCode
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Map an HTTP status (+ provider wording) to an ErrorCategory.
 */
export function classifyHttpStatus(status, providerText = '', providerCode = null) {
  const n = Number(status)
  if (!Number.isFinite(n) || n <= 0) return 'NETWORK_ERROR'
  const haystack = `${providerCode || ''} ${providerText || ''}`.toLowerCase()
  if (n === 401) return 'AUTH_INVALID'
  if (n === 403) return 'AUTH_INVALID'
  if (n === 404) return 'MODEL_UNAVAILABLE'
  if (n === 408) return 'TIMEOUT'
  if (n === 413) return 'PAYLOAD_TOO_LARGE'
  if (n === 429) return 'RATE_LIMITED'
  if (n >= 500 && n <= 599) return 'PROVIDER_UNAVAILABLE'
  if (n === 400 || n === 422) {
    // The model-not-found pattern is deliberately tight: the gap may not span
    // quotes/newlines, so a JSON error envelope (or a sentence like "not
    // supported with this model") cannot masquerade as MODEL_UNAVAILABLE.
    if (/model[^"\n]{0,30}(not found|does not exist|not exist|unknown|unsupported|invalid)|no such model|model_not_found|unknown_model|invalid_model/.test(haystack)) {
      return 'MODEL_UNAVAILABLE'
    }
    if (/context[ _-]?(length|window)|maximum context|too many tokens|token limit|prompt is too long|request too large/.test(haystack)) {
      return 'PAYLOAD_TOO_LARGE'
    }
    if (/parameter|temperature|top_p|not supported|unsupported|invalid value/.test(haystack)) {
      return 'CAPABILITY_UNSUPPORTED'
    }
    return 'PROVIDER_ERROR'
  }
  if (n >= 400 && n <= 499) return 'PROVIDER_ERROR'
  return 'PROVIDER_ERROR'
}

/**
 * Classify a transport failure (no HTTP status) as TIMEOUT / CANCELLED /
 * NETWORK_ERROR. Callers must pass `timedOut: true` when their own timer fired,
 * or use `AbortSignal.timeout()` whose reason is a TimeoutError DOMException.
 */
export function classifyTransportError({ error = null, signal = null, timedOut = false } = {}) {
  // Node's http client reports an abort as `AbortError` and puts the real
  // abort reason (e.g. the TimeoutError of `AbortSignal.timeout()`) in `cause`,
  // so walk the cause chain before deciding between timeout and cancellation.
  const names = []
  const codes = []
  let cursor = error
  for (let depth = 0; depth < 4 && cursor && typeof cursor === 'object'; depth += 1) {
    if (typeof cursor.name === 'string') names.push(cursor.name)
    if (typeof cursor.code === 'string') codes.push(cursor.code)
    cursor = cursor.cause
  }
  const reasonName = signal && signal.reason && typeof signal.reason.name === 'string'
    ? signal.reason.name
    : ''
  const message = error && typeof error.message === 'string' ? error.message : ''
  const timeout = timedOut === true
    || names.includes('TimeoutError')
    || codes.includes('ETIMEDOUT')
    || codes.includes('ESOCKETTIMEDOUT')
    || reasonName === 'TimeoutError'
    || /timed?\s*out/i.test(message)
  if (timeout) return 'TIMEOUT'
  const aborted = names.includes('AbortError')
    || codes.includes('ABORT_ERR')
    || Boolean(signal && signal.aborted)
  if (aborted) return 'CANCELLED'
  return 'NETWORK_ERROR'
}

const RETRYABLE_SET = new Set(RETRYABLE_CATEGORIES)

/**
 * Retry policy shared by both protocols: 429, 408 and transient 5xx plus the
 * transient transport categories. Auth / model / payload errors are terminal.
 */
export function isRetryable(category, httpStatus) {
  const status = Number(httpStatus)
  if (Number.isFinite(status) && status > 0) {
    if (status === 429 || status === 408) return true
    if (status >= 500 && status <= 599) return !NON_RETRYABLE_5XX.includes(status)
    return false
  }
  return RETRYABLE_SET.has(category)
}

/** Throw a typed error when the caller's signal is already aborted. */
export function assertNotAborted(signal) {
  if (!signal || signal.aborted !== true) return
  const reason = signal.reason
  const category = classifyTransportError({
    signal,
    error: reason && typeof reason === 'object' ? reason : null,
  })
  throw new ProtocolError(
    category,
    category === 'TIMEOUT'
      ? 'request timed out before it was sent'
      : 'request cancelled before it was sent',
  )
}

/** Build the unified parseError result (contract §2). */
export function buildErrorResult({
  status = null,
  text = null,
  body = undefined,
  headers = null,
  error = null,
  signal = null,
  timedOut = false,
  apiKey = null,
} = {}) {
  const httpStatus = Number.isFinite(Number(status)) && Number(status) > 0 ? Number(status) : null
  const parsedBody = body !== undefined ? body : tryParseJson(typeof text === 'string' ? text : null).value
  const requestId = sanitizeCode(pickRequestId(headers, parsedBody), apiKey)
  const retryAfterMs = parseRetryAfter(headers)

  if (httpStatus === null) {
    if (error || timedOut || signal) {
      const category = classifyTransportError({ error, signal, timedOut })
      const raw = error && typeof error.message === 'string' ? error.message : ''
      let message
      if (category === 'TIMEOUT') message = 'request timed out'
      else if (category === 'CANCELLED') message = 'request cancelled by caller'
      else message = raw.trim() === '' ? 'network error' : `network error: ${raw}`
      return {
        category,
        message: sanitizeMessage(message, { apiKey }),
        httpStatus: null,
        providerCode: null,
        requestId,
        retryable: isRetryable(category, null),
        retryAfterMs,
      }
    }
    return {
      category: 'UNKNOWN',
      message: 'unknown provider error (no HTTP status and no transport error supplied)',
      httpStatus: null,
      providerCode: null,
      requestId,
      retryable: false,
      retryAfterMs,
    }
  }

  const fields = extractErrorFields(parsedBody)
  const rawText = typeof text === 'string' ? text : ''
  const html = looksLikeHtml(rawText)
  let message
  if (fields.message !== null) {
    message = fields.message
  } else if (rawText.trim() !== '' && !tryParseJson(rawText).ok) {
    message = html
      ? `HTTP ${httpStatus} (HTML error page): ${sanitizeMessage(rawText, { apiKey })}`
      : `HTTP ${httpStatus}: ${sanitizeMessage(rawText, { apiKey })}`
  } else {
    message = `HTTP ${httpStatus}`
  }
  const category = classifyHttpStatus(
    httpStatus,
    `${fields.message || ''} ${fields.code || ''} ${rawText}`,
    fields.code,
  )
  return {
    category,
    message: sanitizeMessage(message, { apiKey }),
    httpStatus,
    providerCode: sanitizeCode(fields.code, apiKey),
    requestId,
    retryable: isRetryable(category, httpStatus),
    retryAfterMs,
  }
}

/** Success envelope for parseResponse (contract §2) + `durationMs` and the
 * capability table echoed back so the caller can fill SlotResultMeta. */
export function makeSuccess({
  requestId = null,
  answer,
  blocks,
  finishReason = null,
  usage = null,
  modelId = null,
  raw = null,
  startedAt = null,
  capabilities = null,
}) {
  return {
    ok: true,
    requestId: requestId == null ? null : requestId,
    answer,
    blocks: Array.isArray(blocks) ? blocks : [],
    finishReason: finishReason == null ? null : finishReason,
    usage: usage || emptyUsage(),
    modelId: modelId == null ? null : modelId,
    capabilities: capabilities ? { ...capabilities } : {},
    durationMs: durationSince(startedAt),
    raw: raw === undefined ? null : raw,
  }
}

/** Failure envelope for parseResponse; never throws. */
export function makeFailure(category, message, {
  httpStatus = null,
  providerCode = null,
  requestId = null,
  retryable = undefined,
  apiKey = null,
} = {}) {
  return {
    ok: false,
    error: {
      category,
      message: sanitizeMessage(message, { apiKey }),
      httpStatus: httpStatus == null ? null : httpStatus,
      providerCode: sanitizeCode(providerCode, apiKey),
      requestId: sanitizeCode(requestId, apiKey),
      retryable: retryable === undefined ? isRetryable(category, httpStatus) : retryable,
    },
  }
}

export function durationSince(startedAt) {
  if (typeof startedAt === 'number' && Number.isFinite(startedAt)) {
    return Math.max(0, Date.now() - startedAt)
  }
  if (typeof startedAt === 'string') {
    const at = Date.parse(startedAt)
    if (Number.isFinite(at)) return Math.max(0, Date.now() - at)
  }
  return null
}

/** Join displayable text blocks into the final answer. */
export function joinTextBlocks(blocks) {
  return blocks
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n\n')
    .trim()
}

/** Resolve raw response text / parsed body from the parseResponse arguments. */
export function resolveResponsePayload({ text = null, body = undefined } = {}) {
  if (typeof text === 'string') return { rawText: text, parsed: undefined, parsedOk: null }
  if (text && typeof text === 'object') return { rawText: null, parsed: text, parsedOk: true }
  if (typeof body === 'string') return { rawText: body, parsed: undefined, parsedOk: null }
  if (body && typeof body === 'object') return { rawText: null, parsed: body, parsedOk: true }
  return { rawText: null, parsed: undefined, parsedOk: null }
}
