/**
 * Outbound HTTP for one expert call.
 *
 * Responsibilities kept here rather than in the adapters:
 * - endpoint policy (allow list, private/loopback handling, https requirement)
 * - one deadline per attempt, with user cancellation kept distinct from timeout
 * - bounded retries for genuinely retryable failures, with retry-after honored
 *
 * The adapters own everything protocol-specific.
 */
import { CATEGORY } from './categories.js'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'])

function isPrivateIPv4(host) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (match === null) return false
  const octets = match.slice(1).map(Number)
  if (octets.some((octet) => octet > 255)) return false
  const [a, b] = octets
  if (a === 10) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

function isPrivateIPv6(host) {
  const bare = host.replace(/^\[|\]$/g, '').toLowerCase()
  return bare === '::1' || bare.startsWith('fc') || bare.startsWith('fd') || bare.startsWith('fe80')
}

/**
 * Decide whether this endpoint may receive a credential.
 * @param {string} baseUrl the configured base URL.
 * @param {{ allowedHosts: string[], trustedLocalEndpoints: string[] }} security
 * @returns {{ ok: true, url: URL, host: string } | { ok: false, category: string, reason: string }}
 */
export function checkEndpoint(baseUrl, security) {
  if (typeof baseUrl !== 'string' || baseUrl.trim() === '') {
    return { ok: false, category: CATEGORY.INVALID_ENDPOINT, reason: 'baseUrl is empty' }
  }
  let url
  try {
    url = new URL(baseUrl.trim())
  } catch {
    return { ok: false, category: CATEGORY.INVALID_ENDPOINT, reason: `baseUrl "${baseUrl}" is not a valid URL` }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, category: CATEGORY.INVALID_ENDPOINT, reason: `baseUrl protocol "${url.protocol}" is not http(s)` }
  }
  if (url.username !== '' || url.password !== '') {
    return {
      ok: false,
      category: CATEGORY.ENDPOINT_NOT_ALLOWED,
      reason: 'baseUrl must not embed credentials; configure the credential reference instead',
    }
  }
  if (url.search !== '' || url.hash !== '') {
    return { ok: false, category: CATEGORY.INVALID_ENDPOINT, reason: 'baseUrl must not contain a query string or fragment' }
  }

  const host = url.hostname.toLowerCase()
  const allowedHosts = Array.isArray(security?.allowedHosts) ? security.allowedHosts : []
  const trustedLocal = Array.isArray(security?.trustedLocalEndpoints) ? security.trustedLocalEndpoints : []

  if (allowedHosts.length > 0 && !allowedHosts.some((entry) => host === entry || host.endsWith(`.${entry}`))) {
    return {
      ok: false,
      category: CATEGORY.ENDPOINT_NOT_ALLOWED,
      reason: `host "${host}" is not in security.allowedHosts`,
    }
  }

  const isLocal = LOOPBACK_HOSTS.has(host) || isPrivateIPv4(host) || isPrivateIPv6(host)
  const localTrusted = trustedLocal.some((entry) => host === entry || host.endsWith(`.${entry}`))

  if (url.protocol === 'http:') {
    if (!isLocal && !localTrusted) {
      return {
        ok: false,
        category: CATEGORY.ENDPOINT_NOT_ALLOWED,
        reason: `plain http to "${host}" is refused; use https or list the host in security.trustedLocalEndpoints for a deliberate local proxy`,
      }
    }
  }

  if (isLocal && !localTrusted) {
    return {
      ok: false,
      category: CATEGORY.ENDPOINT_NOT_ALLOWED,
      reason: `"${host}" is a loopback or private address; add it to security.trustedLocalEndpoints to allow a local model proxy`,
    }
  }

  return { ok: true, url, host }
}

/** Sleep that a caller's abort signal can interrupt. */
function delay(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve()
      return
    }
    const timer = setTimeout(finish, ms)
    const onAbort = () => finish()
    function finish() {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

/**
 * Perform one request with deadline, retries and cancellation.
 *
 * @param {object} request
 * @param {string} request.url absolute URL.
 * @param {string} request.method
 * @param {Record<string,string>} request.headers
 * @param {unknown} request.body JSON-serializable body.
 * @param {number} request.timeoutMs per-attempt deadline.
 * @param {number} request.retries additional attempts after the first.
 * @param {AbortSignal} [request.signal] caller cancellation.
 * @param {(ctx: object) => object} request.parseError adapter error classifier.
 * @param {(category: string, status?: number) => boolean} request.isRetryable
 * @returns {Promise<{ ok: true, status: number, text: string, headers: Record<string,string>, attempts: number, durationMs: number }
 *   | { ok: false, status: number|null, text: string, headers: Record<string,string>, attempts: number, durationMs: number,
 *       error: { category: string, message: string, httpStatus: number|null, providerCode?: string|null, requestId?: string|null, retryable?: boolean, retryAfterMs?: number|null } }>}
 */
export async function performRequest(request) {
  const { url, method = 'POST', headers, body, timeoutMs, retries, signal, parseError, isRetryable } = request
  const maxAttempts = Math.max(1, Math.min(6, (Number.isFinite(retries) ? retries : 0) + 1))
  const startedAt = Date.now()
  let last = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (signal?.aborted === true) {
      return {
        ok: false,
        status: null,
        text: '',
        headers: {},
        attempts: attempt - 1,
        durationMs: Date.now() - startedAt,
        error: {
          category: CATEGORY.CANCELLED,
          message: 'cancelled by the caller before the request was sent',
          httpStatus: null,
          retryable: false,
        },
      }
    }

    const timeoutController = AbortSignal.timeout(Math.max(1000, timeoutMs))
    const composite = signal === undefined ? timeoutController : AbortSignal.any([signal, timeoutController])

    let response = null
    let text = ''
    let transportError = null

    try {
      const init = {
        method,
        headers,
        signal: composite,
        redirect: 'manual',
      }
      if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body)
      response = await fetch(url, init)
      text = await response.text()
    } catch (error) {
      transportError = error
    }

    const durationMs = Date.now() - startedAt

    // A redirect is refused rather than followed: forwarding an Authorization
    // header to a host the user never authorized is exactly the leak the
    // endpoint policy exists to prevent.
    if (response !== null && response.status >= 300 && response.status < 400) {
      last = {
        ok: false,
        status: response.status,
        text,
        headers: Object.fromEntries(response.headers.entries()),
        attempts: attempt,
        durationMs,
        error: {
          category: CATEGORY.ENDPOINT_NOT_ALLOWED,
          message: `provider redirected (${response.status}) to "${response.headers.get('location') ?? 'unknown'}"; redirects are not followed so the credential is never forwarded`,
          httpStatus: response.status,
          retryable: false,
        },
      }
      return last
    }

    if (transportError !== null) {
      // Caller cancellation wins over any timeout-looking transport detail: the
      // caller's own `AbortSignal.timeout()` also surfaces as a TimeoutError, so
      // the adapter cannot tell them apart without this precedence.
      const userCancelled = signal?.aborted === true
      const timedOut = !userCancelled && (timeoutController.aborted === true || transportError?.name === 'TimeoutError' || transportError?.cause?.name === 'TimeoutError')
      const classified = parseError({
        status: null,
        text: '',
        headers: {},
        error: transportError,
        signal,
        timedOut,
        userCancelled,
      })
      if (userCancelled) {
        classified.category = CATEGORY.CANCELLED
        if (typeof classified.message !== 'string' || !/cancel/i.test(classified.message)) {
          classified.message = 'cancelled by the caller'
        }
        classified.retryable = false
      }
      last = {
        ok: false,
        status: null,
        text: '',
        headers: {},
        attempts: attempt,
        durationMs,
        error: { ...classified, httpStatus: null },
      }
      if (userCancelled || timedOut || !isRetryable(classified.category, null)) return last
    } else if (response.ok === true) {
      return {
        ok: true,
        status: response.status,
        text,
        headers: Object.fromEntries(response.headers.entries()),
        attempts: attempt,
        durationMs,
      }
    } else {
      const responseHeaders = Object.fromEntries(response.headers.entries())
      const classified = parseError({ status: response.status, text, headers: responseHeaders })
      last = {
        ok: false,
        status: response.status,
        text,
        headers: responseHeaders,
        attempts: attempt,
        durationMs,
        error: { ...classified, httpStatus: response.status },
      }
      if (!isRetryable(classified.category, response.status)) return last
    }

    if (attempt < maxAttempts) {
      const retryAfterMs = typeof last.error?.retryAfterMs === 'number' ? last.error.retryAfterMs : null
      const backoff = retryAfterMs !== null ? Math.min(retryAfterMs, 30_000) : Math.min(500 * 2 ** (attempt - 1), 8_000)
      await delay(backoff, signal)
      if (signal?.aborted === true) {
        return {
          ok: false,
          status: null,
          text: '',
          headers: {},
          attempts: attempt,
          durationMs: Date.now() - startedAt,
          error: {
            category: CATEGORY.CANCELLED,
            message: 'cancelled by the caller while waiting to retry',
            httpStatus: null,
            retryable: false,
          },
        }
      }
    }
  }

  return last
}
