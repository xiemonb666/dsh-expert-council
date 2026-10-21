// Protocol registry for dsh-expert-council (docs/contracts.md §2).
//
// Both adapters expose the same surface:
//   id, label, capabilities, normalizeBaseUrl, buildRequest, parseResponse,
//   parseError, isRetryable
//
// This registry only wires them together; it contains no protocol logic. It is
// dependency-free and uses relative ESM imports exclusively (no bare imports,
// see docs/contracts.md §0).

import * as anthropicMessages from './anthropic-messages.js'
import * as openaiChatCompletions from './openai-chat-completions.js'
import { ProtocolError, isRetryable as sharedIsRetryable } from './shared.js'

export { ProtocolError }
export { sharedIsRetryable as isRetryableError }
export { normalizeBaseUrl } from './shared.js'
export { renderUserText, emptyUsage } from './shared.js'

/** Every registered adapter, keyed by protocol id. */
export const protocols = Object.freeze({
  [openaiChatCompletions.id]: openaiChatCompletions,
  [anthropicMessages.id]: anthropicMessages,
})

const PROTOCOL_IDS = Object.freeze(Object.keys(protocols))

export function hasProtocol(protocol) {
  return typeof protocol === 'string' && Object.prototype.hasOwnProperty.call(protocols, protocol)
}

/**
 * Look up an adapter by protocol id.
 * @throws {ProtocolError} code `UNKNOWN_PROTOCOL` when the id is not registered.
 */
export function getProtocol(protocol) {
  if (!hasProtocol(protocol)) {
    throw new ProtocolError('UNKNOWN_PROTOCOL', `unknown protocol: ${String(protocol)}`)
  }
  return protocols[protocol]
}

/** Registered protocol ids in declaration order. */
export function listProtocolIds() {
  return [...PROTOCOL_IDS]
}

/** `[{ id, label, capabilities }]`, used by the settings page and diagnostics. */
export function listProtocols() {
  return PROTOCOL_IDS.map((protocolId) => {
    const adapter = protocols[protocolId]
    return {
      id: adapter.id,
      label: adapter.label,
      capabilities: { ...adapter.capabilities },
    }
  })
}

/** Capability table for one protocol; `null` when the id is unknown. */
export function capabilitiesOf(protocol) {
  return hasProtocol(protocol) ? { ...protocols[protocol].capabilities } : null
}

function resolveSlotProtocol(slot) {
  if (!slot || typeof slot !== 'object') {
    throw new ProtocolError('SLOT_UNCONFIGURED', 'slot is required')
  }
  const protocol = typeof slot.protocol === 'string' ? slot.protocol.trim() : ''
  if (protocol === '') {
    throw new ProtocolError('SLOT_UNCONFIGURED', 'slot.protocol is not configured')
  }
  if (!hasProtocol(protocol)) {
    // Unknown protocol is a capability problem at the slot level, so it stays
    // inside the contract §1 ErrorCategory vocabulary.
    throw new ProtocolError('CAPABILITY_UNSUPPORTED', `unsupported protocol: ${protocol}`)
  }
  return protocols[protocol]
}

/**
 * Build the request for a normalized slot, dispatching on `slot.protocol`.
 * @param {{ slot: object, brief: object, signal?: AbortSignal }} args
 */
export function buildRequestForSlot({ slot, brief, signal = null } = {}) {
  return resolveSlotProtocol(slot).buildRequest({ slot, brief, signal })
}

/**
 * Parse a response for a normalized slot, dispatching on `slot.protocol`.
 * @param {{ slot: object, response?: object, text?: string, body?: unknown, startedAt?: number|string }} args
 */
export function parseResponseForSlot({ slot, response = null, text = null, body = undefined, startedAt = null } = {}) {
  return resolveSlotProtocol(slot).parseResponse({ slot, response, text, body, startedAt })
}

/**
 * Classify an HTTP or transport failure for a normalized slot.
 * @param {{ slot: object, status?: number, text?: string, body?: unknown, headers?: unknown,
 *           error?: Error, signal?: AbortSignal, timedOut?: boolean }} args
 */
export function parseErrorForSlot({
  slot,
  status,
  text,
  body,
  headers,
  error = null,
  signal = null,
  timedOut = false,
} = {}) {
  return resolveSlotProtocol(slot).parseError({ slot, status, text, body, headers, error, signal, timedOut })
}

/** Retry policy shared by every protocol (429 / 408 / transient 5xx / network). */
export function isRetryable(category, httpStatus) {
  return sharedIsRetryable(category, httpStatus)
}

export default protocols
