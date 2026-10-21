/**
 * Configuration normalization for dsh-expert-council.
 *
 * The plugin row's `config` is written by the user (or by the settings page
 * through `ctx.configEditor`), so every field is treated as untrusted input:
 * normalization never throws, it records a warning and falls back to a safe
 * default. That keeps a partially configured profile loadable instead of
 * taking the whole plugin down.
 */
import { CATEGORY } from './categories.js'

export const SLOT_IDS = Object.freeze(['L1', 'L2', 'L3'])

export const SLOT_DEFAULTS = Object.freeze({
  L1: { displayName: 'Frontier Reasoning', protocol: 'anthropic_messages', authScheme: 'x-api-key', maxOutputTokens: 8192, timeoutMs: 180000 },
  L2: { displayName: 'Advanced Reasoning', protocol: 'openai_chat_completions', authScheme: 'bearer', maxOutputTokens: 8192, timeoutMs: 120000 },
  L3: { displayName: 'Core Reasoning', protocol: 'openai_chat_completions', authScheme: 'bearer', maxOutputTokens: 4096, timeoutMs: 90000 },
})

export const PROTOCOLS = Object.freeze(['openai_chat_completions', 'anthropic_messages'])

/**
 * Reasoning-effort levels a slot may request. These are passed through to the
 * provider, not interpreted: an endpoint that does not understand the value is
 * expected to reject it, and the card shows that rejection verbatim rather than
 * silently downgrading.
 */
export const REASONING_EFFORTS = Object.freeze(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

export const DEFAULT_SECURITY = Object.freeze({
  allowedHosts: [],
  trustedLocalEndpoints: [],
  maxPayloadBytes: 120000,
  redactSecrets: true,
  allowRepoScope: false,
  requireDataApproval: false,
})

export const DEFAULT_DEFAULTS = Object.freeze({
  singleSlot: 'L2',
  allowCouncil: true,
  maxCostUsdPerCall: null,
})

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

function asBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

function asFiniteNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asNullableNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clampInteger(value, min, max, fallback) {
  const number = asFiniteNumber(value, fallback)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

function normalizeStringList(value, limit = 64) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const entry of value) {
    const text = asString(entry)
    if (text !== '' && !out.includes(text)) out.push(text)
    if (out.length >= limit) break
  }
  return out
}

/**
 * Normalize one slot.
 * @param {string} slotId one of `L1`/`L2`/`L3`.
 * @param {unknown} raw the user-supplied slot object.
 * @returns {object} a slot whose every field has a defined type, plus `warnings`.
 */
export function normalizeSlot(slotId, raw) {
  const warnings = []
  const input = isPlainObject(raw) ? raw : {}
  const defaults = SLOT_DEFAULTS[slotId] ?? SLOT_DEFAULTS.L3

  const protocol = asString(input.protocol, defaults.protocol)
  if (!PROTOCOLS.includes(protocol)) {
    warnings.push(`slot ${slotId}: unknown protocol "${protocol}" replaced with ${defaults.protocol}`)
  }
  const resolvedProtocol = PROTOCOLS.includes(protocol) ? protocol : defaults.protocol

  const authSchemeRaw = asString(input.authScheme, defaults.authScheme)
  const authScheme = authSchemeRaw === 'bearer' || authSchemeRaw === 'x-api-key' ? authSchemeRaw : defaults.authScheme

  const baseUrl = asString(input.baseUrl)
  const modelId = asString(input.modelId)
  const credentialRef = asString(input.credentialRef, `DSH_EXPERT_${slotId}_API_KEY`)
  const apiVersion = asString(input.apiVersion, resolvedProtocol === 'anthropic_messages' ? '2023-06-01' : '')

  const enabled = asBoolean(input.enabled, false)
  const configured = enabled && baseUrl !== '' && modelId !== '' && credentialRef !== ''
  if (enabled && !configured) {
    const missing = []
    if (baseUrl === '') missing.push('baseUrl')
    if (modelId === '') missing.push('modelId')
    if (credentialRef === '') missing.push('credentialRef')
    warnings.push(`slot ${slotId}: enabled but missing ${missing.join(', ')}`)
  }

  const pricingInput = isPlainObject(input.pricing) ? input.pricing : {}
  const pricing = {
    inputPerMTokUsd: asNullableNumber(pricingInput.inputPerMTokUsd),
    outputPerMTokUsd: asNullableNumber(pricingInput.outputPerMTokUsd),
  }

  const reasoningEffortRaw = asString(input.reasoningEffort).toLowerCase()
  if (reasoningEffortRaw !== '' && !REASONING_EFFORTS.includes(reasoningEffortRaw)) {
    warnings.push(`slot ${slotId}: unknown reasoningEffort "${reasoningEffortRaw}" ignored`)
  }
  const reasoningEffort = REASONING_EFFORTS.includes(reasoningEffortRaw) ? reasoningEffortRaw : null

  return {
    slot: slotId,
    enabled,
    configured,
    displayName: asString(input.displayName, defaults.displayName),
    protocol: resolvedProtocol,
    providerLabel: asString(input.providerLabel, ''),
    baseUrl,
    modelId,
    credentialRef,
    apiVersion,
    authScheme,
    maxOutputTokens: clampInteger(input.maxOutputTokens, 1, 1_000_000, defaults.maxOutputTokens),
    maxTokensParam: input.maxTokensParam === 'max_completion_tokens' ? 'max_completion_tokens' : 'max_tokens',
    reasoningEffort,
    thinkingBudget: clampInteger(input.thinkingBudget, 0, 1_000_000, 0) || null,
    temperature: asNullableNumber(input.temperature),
    timeoutMs: clampInteger(input.timeoutMs, 5_000, 900_000, defaults.timeoutMs),
    retries: clampInteger(input.retries, 0, 5, 1),
    allowedTasks: normalizeStringList(input.allowedTasks),
    pricing,
    warnings,
  }
}

/**
 * Normalize the whole plugin configuration.
 * @param {unknown} raw the Loader row's `config`.
 * @returns {{ slots: Record<string, object>, defaults: object, security: object, warnings: string[] }}
 */
export function normalizeConfig(raw) {
  const input = isPlainObject(raw) ? raw : {}
  const warnings = []

  const rawSlots = isPlainObject(input.slots) ? input.slots : {}
  const slots = {}
  for (const slotId of SLOT_IDS) {
    slots[slotId] = normalizeSlot(slotId, rawSlots[slotId])
    warnings.push(...slots[slotId].warnings)
  }

  const rawDefaults = isPlainObject(input.defaults) ? input.defaults : {}
  const singleSlotRaw = asString(rawDefaults.singleSlot, DEFAULT_DEFAULTS.singleSlot).toUpperCase()
  const singleSlot = SLOT_IDS.includes(singleSlotRaw) ? singleSlotRaw : DEFAULT_DEFAULTS.singleSlot
  if (singleSlotRaw !== singleSlot) warnings.push(`defaults.singleSlot: unknown slot "${rawDefaults.singleSlot}" replaced with ${singleSlot}`)

  const defaults = {
    singleSlot,
    allowCouncil: asBoolean(rawDefaults.allowCouncil, true),
    maxCostUsdPerCall: asNullableNumber(rawDefaults.maxCostUsdPerCall),
  }

  const rawSecurity = isPlainObject(input.security) ? input.security : {}
  const security = {
    allowedHosts: normalizeStringList(rawSecurity.allowedHosts).map((host) => host.toLowerCase()),
    trustedLocalEndpoints: normalizeStringList(rawSecurity.trustedLocalEndpoints).map((host) => host.toLowerCase()),
    maxPayloadBytes: clampInteger(rawSecurity.maxPayloadBytes, 1024, 5_000_000, DEFAULT_SECURITY.maxPayloadBytes),
    redactSecrets: asBoolean(rawSecurity.redactSecrets, true),
    allowRepoScope: asBoolean(rawSecurity.allowRepoScope, false),
    requireDataApproval: asBoolean(rawSecurity.requireDataApproval, false),
  }

  return { slots, defaults, security, warnings }
}

/**
 * Project one slot into the public shape the settings page receives.
 * The credential value never appears here; only whether one is configured.
 */
export function publicSlot(slot, credentialConfigured) {
  return {
    slot: slot.slot,
    enabled: slot.enabled,
    displayName: slot.displayName,
    protocol: slot.protocol,
    providerLabel: slot.providerLabel,
    baseUrl: slot.baseUrl,
    modelId: slot.modelId,
    credentialRef: slot.credentialRef,
    credentialConfigured: credentialConfigured === true,
    apiVersion: slot.apiVersion,
    authScheme: slot.authScheme,
    maxOutputTokens: slot.maxOutputTokens,
    maxTokensParam: slot.maxTokensParam,
    reasoningEffort: slot.reasoningEffort,
    thinkingBudget: slot.thinkingBudget,
    temperature: slot.temperature,
    timeoutMs: slot.timeoutMs,
    retries: slot.retries,
    configured: slot.configured,
    warnings: slot.warnings,
  }
}

/** Fields the settings page may write for one slot. */
export const WRITABLE_SLOT_FIELDS = Object.freeze([
  'enabled',
  'displayName',
  'protocol',
  'providerLabel',
  'baseUrl',
  'modelId',
  'credentialRef',
  'apiVersion',
  'authScheme',
  'maxOutputTokens',
  'maxTokensParam',
  'reasoningEffort',
  'thinkingBudget',
  'temperature',
  'timeoutMs',
  'retries',
])

/**
 * Whitelist a settings-page patch so a compromised client cannot inject
 * arbitrary keys into the persisted profile config.
 */
export function sanitizeSlotPatch(patch) {
  const input = isPlainObject(patch) ? patch : {}
  const out = {}
  for (const field of WRITABLE_SLOT_FIELDS) {
    if (!(field in input)) continue
    const value = input[field]
    if (value === null) {
      out[field] = null
      continue
    }
    switch (field) {
      case 'enabled':
        if (typeof value === 'boolean') out[field] = value
        break
      case 'maxOutputTokens':
      case 'timeoutMs':
      case 'retries':
        if (typeof value === 'number' && Number.isFinite(value)) out[field] = value
        break
      case 'temperature':
        if (typeof value === 'number' && Number.isFinite(value)) out[field] = value
        break
      case 'protocol':
        if (PROTOCOLS.includes(value)) out[field] = value
        break
      case 'authScheme':
        if (value === 'bearer' || value === 'x-api-key') out[field] = value
        break
      case 'maxTokensParam':
        if (value === 'max_tokens' || value === 'max_completion_tokens') out[field] = value
        break
      case 'reasoningEffort':
        if (REASONING_EFFORTS.includes(value)) out[field] = value
        break
      case 'thinkingBudget':
        if (typeof value === 'number' && Number.isFinite(value)) out[field] = value
        break
      default:
        if (typeof value === 'string') out[field] = value.slice(0, 2048)
    }
  }
  return out
}

/** Fields the settings page may write for the endpoint policy. */
export const WRITABLE_SECURITY_FIELDS = Object.freeze([
  'allowedHosts',
  'trustedLocalEndpoints',
  'maxPayloadBytes',
  'redactSecrets',
  'allowRepoScope',
])

/**
 * Whitelist an endpoint-policy patch.
 *
 * `allowRepoScope` is included on purpose: widening what may leave the machine
 * is a deliberate user decision, and it must be reachable from the same surface
 * that explains its consequence, rather than only by hand-editing YAML.
 */
export function sanitizeSecurityPatch(patch) {
  const input = isPlainObject(patch) ? patch : {}
  const out = {}
  for (const field of WRITABLE_SECURITY_FIELDS) {
    if (!(field in input)) continue
    const value = input[field]
    switch (field) {
      case 'allowedHosts':
      case 'trustedLocalEndpoints':
        if (Array.isArray(value)) out[field] = normalizeStringList(value).map((host) => host.toLowerCase())
        break
      case 'maxPayloadBytes':
        if (typeof value === 'number' && Number.isFinite(value)) out[field] = clampInteger(value, 1024, 5_000_000, DEFAULT_SECURITY.maxPayloadBytes)
        break
      case 'redactSecrets':
      case 'allowRepoScope':
        if (typeof value === 'boolean') out[field] = value
        break
      default:
        break
    }
  }
  return out
}

/** A slot is usable when it is enabled, complete and has a resolvable credential. */
export function slotReadiness(slot, credentialConfigured) {
  if (!slot.enabled) return { ok: false, category: CATEGORY.SLOT_DISABLED, reason: `slot ${slot.slot} is disabled` }
  if (slot.baseUrl === '' || slot.modelId === '') {
    return { ok: false, category: CATEGORY.SLOT_UNCONFIGURED, reason: `slot ${slot.slot} is missing baseUrl or modelId` }
  }
  if (credentialConfigured !== true) {
    return {
      ok: false,
      category: CATEGORY.CREDENTIAL_MISSING,
      reason: `credential "${slot.credentialRef}" for slot ${slot.slot} resolves to no value`,
    }
  }
  return { ok: true }
}
