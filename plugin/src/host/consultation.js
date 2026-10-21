/**
 * Consultation orchestration.
 *
 * One function per tool shape:
 * - `consultSingle` asks exactly one slot;
 * - `consultCouncil` asks several slots **concurrently**, each in its own
 *   attempt, and never lets one slot's failure destroy another's answer.
 *
 * Everything that produces a model-visible or card-visible fact happens here,
 * so the tool layer stays a thin argument/result adapter.
 */
import { createHash, randomBytes } from 'node:crypto'

import { CATEGORY } from './categories.js'
import { buildBrief, briefHash, routeSingle } from './brief.js'
import { checkEndpoint, performRequest } from './http.js'
import { redactBrief, redactText } from './redact.js'
import { slotReadiness } from './config.js'

const UNKNOWN_USAGE = Object.freeze({
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  cacheReadTokens: null,
  reasoningTokens: null,
})

function newConsultationId(now) {
  const stamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  return `ec-${stamp}-${randomBytes(3).toString('hex')}`
}

function estimateCost(usage, pricing) {
  const inputPrice = pricing?.inputPerMTokUsd
  const outputPrice = pricing?.outputPerMTokUsd
  if (typeof inputPrice !== 'number' || typeof outputPrice !== 'number') {
    return { estimatedUsd: null, source: 'unknown' }
  }
  if (typeof usage.inputTokens !== 'number' || typeof usage.outputTokens !== 'number') {
    return { estimatedUsd: null, source: 'unknown' }
  }
  const usd = (usage.inputTokens / 1_000_000) * inputPrice + (usage.outputTokens / 1_000_000) * outputPrice
  return { estimatedUsd: Number(usd.toFixed(6)), source: 'estimated' }
}

function errorRecord(category, message, extra = {}) {
  return {
    category,
    message,
    httpStatus: extra.httpStatus ?? null,
    providerCode: extra.providerCode ?? null,
    requestId: extra.requestId ?? null,
    retryable: extra.retryable ?? false,
  }
}

/**
 * Resolve the credential for one slot.
 * @returns {Promise<{ ok: true, value: string } | { ok: false, category: string, message: string }>}
 */
async function resolveSlotCredential(credentials, slot) {
  if (credentials === undefined || credentials === null) {
    return { ok: false, category: CATEGORY.CREDENTIAL_MISSING, message: 'the credential service is not mounted in this profile' }
  }
  try {
    const resolved = await credentials.resolve(slot.credentialRef)
    if (resolved === undefined || resolved === null || typeof resolved.value !== 'string' || resolved.value === '') {
      return {
        ok: false,
        category: CATEGORY.CREDENTIAL_MISSING,
        message: `credential "${slot.credentialRef}" resolves to no value; set it in the Expert Council settings page or export the environment variable`,
      }
    }
    return { ok: true, value: resolved.value }
  } catch (error) {
    return { ok: false, category: CATEGORY.CREDENTIAL_MISSING, message: `credential "${slot.credentialRef}" could not be read: ${error?.message ?? error}` }
  }
}

/**
 * Run one slot end to end.
 *
 * @param {object} ctx
 * @param {object} ctx.slot normalized slot config.
 * @param {object} ctx.brief normalized brief (already redacted).
 * @param {object} ctx.protocols the protocol registry module.
 * @param {object} ctx.security normalized security config.
 * @param {object} ctx.credentials the credentials service, if mounted.
 * @param {AbortSignal} ctx.signal caller cancellation.
 * @param {string[]} [ctx.knownSecrets] resolved credential values to scrub from anything echoed back.
 * @returns {Promise<object>} one `SlotResultMeta` (without `requestedOutput`).
 */
async function runSlot({ slot, brief, protocols, security, credentials, signal, knownSecrets = [] }) {
  const startedAt = new Date()
  const base = {
    slot: slot.slot,
    displayName: slot.displayName,
    protocol: slot.protocol,
    providerLabel: slot.providerLabel,
    endpointHost: '',
    modelId: slot.modelId,
    status: 'ERROR',
    startedAt: startedAt.toISOString(),
    durationMs: 0,
    attempts: 0,
    usage: { ...UNKNOWN_USAGE },
    cost: { estimatedUsd: null, source: 'unknown' },
    capabilities: {},
  }

  const readiness = slotReadiness(slot, slot.enabled ? true : false)
  if (!readiness.ok) {
    // Distinguish "disabled" from "incomplete" for the card.
    const category = readiness.category === CATEGORY.CREDENTIAL_MISSING && (slot.baseUrl === '' || slot.modelId === '')
      ? CATEGORY.SLOT_UNCONFIGURED
      : readiness.category
    return { ...base, status: category === CATEGORY.SLOT_DISABLED ? 'DISABLED' : 'UNCONFIGURED', error: errorRecord(category, readiness.reason) }
  }

  const endpoint = checkEndpoint(slot.baseUrl, security)
  if (!endpoint.ok) {
    return { ...base, status: 'ERROR', error: errorRecord(endpoint.category, endpoint.reason) }
  }
  base.endpointHost = endpoint.host

  const credential = await resolveSlotCredential(credentials, slot)
  if (!credential.ok) {
    return { ...base, status: 'ERROR', error: errorRecord(credential.category, credential.message) }
  }

  const known = [...knownSecrets, credential.value]
  const resolvedSlot = { ...slot, apiKey: credential.value }

  let request
  try {
    request = protocols.buildRequestForSlot({ slot: resolvedSlot, brief, signal })
  } catch (error) {
    const category = typeof error?.code === 'string' ? error.code : CATEGORY.PROVIDER_ERROR
    return {
      ...base,
      status: 'ERROR',
      error: errorRecord(category, redactText(String(error?.message ?? error), { knownSecrets: known }).text),
    }
  }

  const payloadBytes = Buffer.byteLength(JSON.stringify(request.redactedBody ?? request.body ?? {}), 'utf8')
  if (payloadBytes > security.maxPayloadBytes) {
    return {
      ...base,
      status: 'ERROR',
      error: errorRecord(
        CATEGORY.PAYLOAD_TOO_LARGE,
        `redacted request body is ${payloadBytes} bytes, over security.maxPayloadBytes (${security.maxPayloadBytes}); narrow the evidence`,
      ),
    }
  }

  const response = await performRequest({
    url: request.url,
    method: request.method ?? 'POST',
    headers: request.headers,
    body: request.body,
    timeoutMs: slot.timeoutMs,
    retries: slot.retries,
    signal,
    parseError: (input) => protocols.parseErrorForSlot({ slot: resolvedSlot, ...input }),
    isRetryable: (category, status) => protocols.isRetryableError(category, status),
  })

  const requestSent = {
    system: typeof request.redactedBody?.system === 'string' ? redactText(request.redactedBody.system, { knownSecrets: known }).text : undefined,
    user: redactText(extractUserText(request.redactedBody), { knownSecrets: known }).text,
    hash: createHash('sha256').update(JSON.stringify(request.redactedBody ?? {})).digest('hex'),
    bytes: payloadBytes,
  }

  if (response.ok !== true) {
    const error = response.error ?? errorRecord(CATEGORY.UNKNOWN, 'request failed without a classified error')
    const status = error.category === CATEGORY.TIMEOUT
      ? 'TIMEOUT'
      : error.category === CATEGORY.CANCELLED
        ? 'CANCELLED'
        : 'ERROR'
    return {
      ...base,
      status,
      durationMs: response.durationMs,
      attempts: response.attempts,
      error: {
        category: error.category,
        message: redactText(String(error.message ?? ''), { knownSecrets: known }).text,
        httpStatus: error.httpStatus ?? response.status ?? null,
        providerCode: error.providerCode ?? null,
        requestId: error.requestId ?? null,
        retryable: error.retryable === true,
      },
      requestSent,
    }
  }

  let parsed
  try {
    parsed = protocols.parseResponseForSlot({
      slot: resolvedSlot,
      response: { status: response.status, headers: response.headers },
      text: response.text,
      startedAt: startedAt.getTime(),
    })
  } catch (error) {
    return {
      ...base,
      status: 'ERROR',
      durationMs: response.durationMs,
      attempts: response.attempts,
      error: errorRecord(CATEGORY.BAD_RESPONSE, `response could not be parsed: ${String(error?.message ?? error)}`),
      requestSent,
    }
  }

  if (parsed?.ok !== true) {
    const error = parsed?.error ?? errorRecord(CATEGORY.BAD_RESPONSE, 'adapter reported a parse failure without a category')
    return {
      ...base,
      status: 'ERROR',
      durationMs: response.durationMs,
      attempts: response.attempts,
      error: {
        category: error.category ?? CATEGORY.BAD_RESPONSE,
        message: redactText(String(error.message ?? ''), { knownSecrets: known }).text,
        httpStatus: error.httpStatus ?? response.status ?? null,
        providerCode: error.providerCode ?? null,
        requestId: error.requestId ?? null,
        retryable: error.retryable === true,
      },
      requestSent,
    }
  }

  const answer = typeof parsed.answer === 'string' ? parsed.answer : ''
  if (answer.trim() === '') {
    return {
      ...base,
      status: 'ERROR',
      durationMs: response.durationMs,
      attempts: response.attempts,
      error: errorRecord(CATEGORY.EMPTY_RESPONSE, 'the provider returned no displayable text'),
      requestSent,
      capabilities: parsed.capabilities ?? {},
    }
  }

  const usage = { ...UNKNOWN_USAGE, ...(parsed.usage ?? {}) }

  return {
    ...base,
    status: 'SUCCESS',
    durationMs: response.durationMs,
    attempts: response.attempts,
    requestId: parsed.requestId ?? null,
    usage,
    cost: estimateCost(usage, slot.pricing),
    finishReason: parsed.finishReason ?? null,
    answer: redactText(answer, { knownSecrets: known }).text,
    blocks: Array.isArray(parsed.blocks) ? parsed.blocks : undefined,
    requestSent,
    capabilities: parsed.capabilities ?? {},
  }
}

/** Best-effort extraction of the human-readable user text from a native body. */
function extractUserText(body) {
  if (body === null || typeof body !== 'object') return ''
  if (typeof body.system === 'string' && Array.isArray(body.messages)) {
    // Anthropic: system is top level, user text lives in content blocks.
    const user = body.messages.find((message) => message?.role === 'user')
    const content = user?.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n\n')
    }
    return ''
  }
  if (Array.isArray(body.messages)) {
    const user = [...body.messages].reverse().find((message) => message?.role === 'user')
    if (typeof user?.content === 'string') return user.content
    if (Array.isArray(user?.content)) {
      return user.content
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n\n')
    }
  }
  if (typeof body.input === 'string') return body.input
  return ''
}

/**
 * Mechanical aggregation of council answers.
 *
 * This is deliberately *lexical*: it finds numbers, identifiers and formula-like
 * tokens that several answers share, and it lists what only one answer contains.
 * It is not a semantic judgement, it cannot establish agreement, and the note
 * says so in every payload. Deciding what the agreement means is the calling
 * agent's job.
 */
export function aggregateCouncil(results) {
  const succeeded = results.filter((result) => result.status === 'SUCCESS')
  const failed = results.filter((result) => result.status !== 'SUCCESS' && result.status !== 'UNCONFIGURED' && result.status !== 'DISABLED')
  const absent = results.filter((result) => result.status === 'UNCONFIGURED' || result.status === 'DISABLED')

  const tokenSets = new Map()
  for (const result of succeeded) {
    const tokens = extractTokens(result.answer ?? '')
    tokenSets.set(result.slot, tokens)
  }

  const counts = new Map()
  for (const tokens of tokenSets.values()) {
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
  }

  const overlap = []
  for (const [token, count] of counts) {
    if (count < 2) continue
    const slots = [...tokenSets.entries()].filter(([, tokens]) => tokens.has(token)).map(([slot]) => slot)
    overlap.push({ token, kind: classifyToken(token), slots })
  }
  overlap.sort((a, b) => b.slots.length - a.slots.length || a.token.localeCompare(b.token))

  const uniqueBySlot = [...tokenSets.entries()].map(([slot, tokens]) => ({
    slot,
    items: [...tokens].filter((token) => counts.get(token) === 1).slice(0, 40),
  }))

  const answerLengths = succeeded.map((result) => ({ slot: result.slot, chars: (result.answer ?? '').length }))

  return {
    requested: results.map((result) => result.slot),
    succeeded: succeeded.map((result) => result.slot),
    failed: failed.map((result) => result.slot),
    absent: absent.map((result) => result.slot),
    counts: { success: succeeded.length, requested: results.length },
    overlap: overlap.slice(0, 60),
    uniqueBySlot,
    answerLengths,
    note: 'Lexical overlap only: these tokens appear in more than one answer. Shared wording is not agreement, and agreement is not correctness — verify every load-bearing claim independently.',
  }
}

function classifyToken(token) {
  if (/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(token)) return 'number'
  if (/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(token)) return 'identifier'
  return 'formula'
}

/** Numbers, identifiers and short formula fragments worth cross-checking. */
function extractTokens(text) {
  const tokens = new Set()
  if (typeof text !== 'string' || text === '') return tokens

  const numbers = text.match(/-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g) ?? []
  for (const number of numbers) {
    // Ignore list numbering and trivially common integers.
    if (/^\d$/.test(number)) continue
    tokens.add(number)
  }

  const identifiers = text.match(/\b[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\b/g) ?? []
  const stop = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'will', 'your', 'you', 'are', 'not', 'but', 'can', 'its', 'has', 'was', 'were', 'which', 'would', 'should', 'could', 'there', 'their', 'then', 'than', 'them', 'they', 'these', 'those', 'when', 'what', 'where', 'while', 'about', 'into', 'over', 'under', 'also', 'only', 'some', 'such', 'more', 'most', 'much', 'very', 'each', 'both', 'other', 'because', 'however', 'therefore', 'thus', 'here', 'moreover', 'furthermore'])
  for (const identifier of identifiers) {
    const lower = identifier.toLowerCase()
    if (lower.length < 3 || stop.has(lower)) continue
    // Keep identifiers that look technical: have a digit, an underscore, a dot,
    // or are longer than 4 characters (a real term, not a filler word).
    if (identifier.length < 5 && !/[_0-9.]/.test(identifier)) continue
    tokens.add(identifier)
  }

  const formulas = text.match(/\b[A-Za-z][A-Za-z0-9_]*\s*=\s*[^\n,;]{2,40}/g) ?? []
  for (const formula of formulas) {
    const compact = formula.replace(/\s+/g, ' ').trim()
    if (compact.length >= 5 && compact.length <= 48) tokens.add(compact)
  }

  return tokens
}

/**
 * Single-slot consultation.
 * @returns {Promise<{ meta: object, results: object[] }>}
 */
export async function consultSingle(options) {
  const {
    slots,
    defaults,
    security,
    credentials,
    protocols,
    input,
    requester,
    knownSecrets = [],
    signal,
  } = options

  const now = new Date()
  const consultationId = newConsultationId(now)
  const brief = buildBrief(input)

  const privacyCheck = checkPrivacyScopeLocal(input.privacyScope, security)
  if (!privacyCheck.ok) {
    return {
      meta: {
        version: 1,
        kind: 'single',
        consultationId,
        createdAt: now.toISOString(),
        durationMs: 0,
        status: 'FAILED',
        mode: brief.mode,
        reason: input.reason ?? '',
        requestedOutput: brief.requestedOutput,
        requester,
        routing: { requestedSlot: input.slot ?? null, autoRouted: input.slot === undefined, policy: 'rejected before routing' },
        privacy: { redactions: 0, appliedRules: [], externalBytes: 0, truncated: false },
        question: { normalized: brief.normalized, context: brief.context, evidence: brief.evidence, hash: briefHash(brief) },
        slots: [],
        diagnostics: { notes: [privacyCheck.reason] },
      },
      results: [],
      rejected: { category: privacyCheck.category, message: privacyCheck.reason },
    }
  }

  const routed = input.slot === undefined ? routeSingle(input, defaults) : { slot: input.slot, policy: 'slot named explicitly by the caller' }
  const slot = slots[routed.slot]
  if (slot === undefined) {
    return {
      meta: {
        version: 1,
        kind: 'single',
        consultationId,
        createdAt: now.toISOString(),
        durationMs: 0,
        status: 'FAILED',
        mode: brief.mode,
        reason: input.reason ?? '',
        requestedOutput: brief.requestedOutput,
        requester,
        routing: { requestedSlot: routed.slot, autoRouted: input.slot === undefined, policy: routed.policy },
        privacy: { redactions: 0, appliedRules: [], externalBytes: 0, truncated: false },
        question: { normalized: brief.normalized, context: brief.context, evidence: brief.evidence, hash: briefHash(brief) },
        slots: [],
        diagnostics: { notes: [`unknown slot "${routed.slot}"`] },
      },
      results: [],
    }
  }

  const { brief: redacted, audit } = redactBrief(brief, { knownSecrets, enabled: security.redactSecrets })
  const result = await runSlot({
    slot,
    brief: redacted,
    protocols,
    security,
    credentials,
    signal,
    knownSecrets,
  })

  const durationMs = Date.now() - now.getTime()
  const meta = {
    version: 1,
    kind: 'single',
    consultationId,
    createdAt: now.toISOString(),
    durationMs,
    status: result.status === 'SUCCESS' ? 'COMPLETE' : result.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
    mode: brief.mode,
    reason: input.reason ?? '',
    requestedOutput: brief.requestedOutput,
    requester,
    routing: { requestedSlot: routed.slot, autoRouted: input.slot === undefined, policy: routed.policy },
    privacy: {
      redactions: audit.redactions,
      appliedRules: audit.appliedRules,
      externalBytes: audit.sentBytes,
      truncated: audit.truncated,
    },
    question: { normalized: brief.normalized, context: brief.context, evidence: brief.evidence, hash: briefHash(brief) },
    slots: [result],
    diagnostics: { notes: [] },
  }

  return { meta, results: [result] }
}

/**
 * Council consultation: every requested slot asked the same frozen brief,
 * concurrently, with failures isolated per slot.
 */
export async function consultCouncil(options) {
  const {
    slots,
    defaults,
    security,
    credentials,
    protocols,
    input,
    requester,
    knownSecrets = [],
    signal,
  } = options

  const now = new Date()
  const consultationId = newConsultationId(now)
  const brief = buildBrief(input)
  const questionHash = briefHash(brief)

  const requestedSlots = Array.isArray(input.slots) && input.slots.length > 0
    ? [...new Set(input.slots)]
    : Object.values(slots).filter((slot) => slot.enabled).map((slot) => slot.slot)

  const baseMeta = {
    version: 1,
    kind: 'council',
    consultationId,
    groupId: consultationId,
    createdAt: now.toISOString(),
    durationMs: 0,
    status: 'FAILED',
    mode: brief.mode,
    reason: input.reason ?? '',
    requestedOutput: brief.requestedOutput,
    requester,
    routing: {
      requestedSlot: undefined,
      autoRouted: !(Array.isArray(input.slots) && input.slots.length > 0),
      policy: Array.isArray(input.slots) && input.slots.length > 0 ? 'slots named explicitly by the caller' : 'all enabled slots',
    },
    privacy: { redactions: 0, appliedRules: [], externalBytes: 0, truncated: false },
    question: { normalized: brief.normalized, context: brief.context, evidence: brief.evidence, hash: questionHash },
    slots: [],
    diagnostics: { notes: [] },
  }

  if (defaults.allowCouncil !== true) {
    return {
      meta: { ...baseMeta, diagnostics: { notes: ['council consultations are disabled by defaults.allowCouncil'] } },
      results: [],
    }
  }

  const privacyCheck = checkPrivacyScopeLocal(input.privacyScope, security)
  if (!privacyCheck.ok) {
    return {
      meta: { ...baseMeta, diagnostics: { notes: [privacyCheck.reason] } },
      results: [],
      rejected: { category: privacyCheck.category, message: privacyCheck.reason },
    }
  }

  if (requestedSlots.length === 0) {
    return {
      meta: { ...baseMeta, diagnostics: { notes: ['no slot is configured and enabled; configure at least one slot before calling the council'] } },
      results: [],
    }
  }

  const { brief: redacted, audit } = redactBrief(brief, { knownSecrets, enabled: security.redactSecrets })

  // Concurrency is the point of a council: every slot starts before any slot
  // is awaited, so a slow provider cannot serialize the others.
  const pending = requestedSlots.map((slotId) => {
    const slot = slots[slotId]
    if (slot === undefined) {
      return Promise.resolve({
        slot: slotId,
        displayName: slotId,
        protocol: 'unknown',
        providerLabel: '',
        endpointHost: '',
        modelId: '',
        status: 'UNCONFIGURED',
        startedAt: now.toISOString(),
        durationMs: 0,
        attempts: 0,
        usage: { ...UNKNOWN_USAGE },
        cost: { estimatedUsd: null, source: 'unknown' },
        capabilities: {},
        error: errorRecord(CATEGORY.SLOT_UNCONFIGURED, `slot "${slotId}" does not exist in the configuration`),
      })
    }
    return runSlot({ slot, brief: redacted, protocols, security, credentials, signal, knownSecrets })
  })

  const results = await Promise.all(pending)
  results.sort((a, b) => requestedSlots.indexOf(a.slot) - requestedSlots.indexOf(b.slot))

  const successCount = results.filter((result) => result.status === 'SUCCESS').length
  const status = successCount === results.length ? 'COMPLETE' : successCount === 0 ? 'FAILED' : 'PARTIAL'

  const meta = {
    ...baseMeta,
    durationMs: Date.now() - now.getTime(),
    status,
    privacy: {
      redactions: audit.redactions,
      appliedRules: audit.appliedRules,
      externalBytes: audit.sentBytes,
      truncated: audit.truncated,
    },
    slots: results,
    synthesis: aggregateCouncil(results),
  }

  if (successCount === 0 && results.some((result) => result.status === 'CANCELLED')) meta.status = 'CANCELLED'

  return { meta, results }
}

/** Local copy of the privacy gate so this module has no import cycle with redact.js. */
function checkPrivacyScopeLocal(privacyScope, security) {
  if (privacyScope === undefined || privacyScope === null || privacyScope === '') return { ok: true }
  if (typeof privacyScope !== 'string') {
    return { ok: false, category: CATEGORY.DATA_APPROVAL_REQUIRED, reason: 'privacy_scope must be a short description string' }
  }
  if (security.allowRepoScope === true) return { ok: true }
  const normalized = privacyScope.toLowerCase()
  const forbidden = ['entire repo', 'whole repo', 'full repository', 'entire repository', '整个仓库', '全部仓库', 'whole workspace', 'entire workspace', '整个工作区', 'all environment variables', '全部环境变量', '整个环境变量', 'process.env', 'all files']
  if (forbidden.some((token) => normalized.includes(token))) {
    return {
      ok: false,
      category: CATEGORY.DATA_APPROVAL_REQUIRED,
      reason: `privacy_scope "${privacyScope}" would send more than a curated excerpt; narrow it to the specific files or values needed`,
    }
  }
  return { ok: true }
}
