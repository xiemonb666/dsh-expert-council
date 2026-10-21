/**
 * Error categories shared by the adapters, the orchestrator and the UI.
 * Frozen so a typo in one module fails loudly instead of inventing a category
 * the card renderer cannot localize.
 */
export const CATEGORY = Object.freeze({
  SLOT_UNCONFIGURED: 'SLOT_UNCONFIGURED',
  SLOT_DISABLED: 'SLOT_DISABLED',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTH_INVALID: 'AUTH_INVALID',
  CREDENTIAL_MISSING: 'CREDENTIAL_MISSING',
  ENDPOINT_NOT_ALLOWED: 'ENDPOINT_NOT_ALLOWED',
  INVALID_ENDPOINT: 'INVALID_ENDPOINT',
  MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
  CAPABILITY_UNSUPPORTED: 'CAPABILITY_UNSUPPORTED',
  RATE_LIMITED: 'RATE_LIMITED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  BAD_RESPONSE: 'BAD_RESPONSE',
  EMPTY_RESPONSE: 'EMPTY_RESPONSE',
  TIMEOUT: 'TIMEOUT',
  CANCELLED: 'CANCELLED',
  DATA_APPROVAL_REQUIRED: 'DATA_APPROVAL_REQUIRED',
  COST_APPROVAL_REQUIRED: 'COST_APPROVAL_REQUIRED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  NETWORK_ERROR: 'NETWORK_ERROR',
  UNKNOWN: 'UNKNOWN',
})

/** Human-readable, provider-neutral explanations used in card tooltips. */
export const CATEGORY_HINT = Object.freeze({
  SLOT_UNCONFIGURED: 'This slot has no protocol, base URL, model ID or credential yet.',
  SLOT_DISABLED: 'This slot is disabled in the Expert Council settings.',
  AUTH_REQUIRED: 'The provider requires authentication; no usable credential was found.',
  AUTH_INVALID: 'The provider rejected the credential (401/403).',
  CREDENTIAL_MISSING: 'The configured credential reference resolves to no value.',
  ENDPOINT_NOT_ALLOWED: 'The endpoint is not on the allow list, or is a private/loopback address without a trusted-local grant.',
  INVALID_ENDPOINT: 'The base URL is not a valid http(s) URL.',
  MODEL_UNAVAILABLE: 'The provider does not know this model ID.',
  CAPABILITY_UNSUPPORTED: 'The provider does not support a requested parameter or capability.',
  RATE_LIMITED: 'The provider rate-limited the request (429).',
  PROVIDER_UNAVAILABLE: 'The provider is temporarily unavailable (5xx).',
  PROVIDER_ERROR: 'The provider returned an error payload.',
  BAD_RESPONSE: 'The response could not be parsed with this protocol.',
  EMPTY_RESPONSE: 'The provider returned no displayable text.',
  TIMEOUT: 'The request exceeded the slot timeout.',
  CANCELLED: 'The call was cancelled before it finished.',
  DATA_APPROVAL_REQUIRED: 'Outbound content needs explicit authorization before it may be sent.',
  COST_APPROVAL_REQUIRED: 'The projected cost exceeds the configured per-call budget.',
  PAYLOAD_TOO_LARGE: 'The redacted outbound payload exceeds the configured byte limit.',
  NETWORK_ERROR: 'A network error occurred before a response arrived.',
  UNKNOWN: 'An unexpected failure occurred; see the message for details.',
})

/** Whether a category means "the request never reached the provider". */
export function isPreflightCategory(category) {
  return (
    category === CATEGORY.SLOT_UNCONFIGURED ||
    category === CATEGORY.SLOT_DISABLED ||
    category === CATEGORY.CREDENTIAL_MISSING ||
    category === CATEGORY.AUTH_REQUIRED ||
    category === CATEGORY.ENDPOINT_NOT_ALLOWED ||
    category === CATEGORY.INVALID_ENDPOINT ||
    category === CATEGORY.DATA_APPROVAL_REQUIRED ||
    category === CATEGORY.COST_APPROVAL_REQUIRED ||
    category === CATEGORY.PAYLOAD_TOO_LARGE ||
    category === CATEGORY.CAPABILITY_UNSUPPORTED
  )
}
