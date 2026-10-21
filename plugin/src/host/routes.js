/**
 * Settings-page HTTP routes.
 *
 * The Expert Council settings page runs in the browser and needs to read and
 * write the three slot configurations plus their credentials. It cannot import
 * host services, so it talks to this small JSON API.
 *
 * Security posture:
 * - loopback clients only (the page is served by this same host);
 * - a custom request header is required, so a cross-site form post cannot
 *   reach these routes;
 * - no response ever contains a credential value, only whether one is set.
 */
import { CATEGORY } from './categories.js'
import { PROTOCOLS, publicSlot, sanitizeSecurityPatch, sanitizeSlotPatch, SLOT_IDS } from './config.js'

const HEADER = 'x-dsh-expert-council'
const MAX_BODY_BYTES = 256 * 1024

function isLoopback(address) {
  if (typeof address !== 'string') return false
  return address === '::1' || address === '127.0.0.1' || address.startsWith('127.') || address === '::ffff:127.0.0.1'
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body, 'utf8'),
    'cache-control': 'no-store',
  })
  res.end(body)
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      const error = new Error('request body too large')
      error.code = 'PAYLOAD_TOO_LARGE'
      throw error
    }
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const error = new Error('request body must be a JSON object')
      error.code = 'BAD_REQUEST'
      throw error
    }
    return parsed
  } catch (error) {
    if (error.code === 'BAD_REQUEST') throw error
    const wrapped = new Error('request body is not valid JSON')
    wrapped.code = 'BAD_REQUEST'
    throw wrapped
  }
}

/**
 * Register the settings routes.
 * @param {object} deps
 * @param {object} deps.webServer the webServer service.
 * @param {() => object} deps.getConfig current normalized config.
 * @param {(patch: object) => Promise<void>} deps.writeSlot persist one slot patch.
 * @param {(slotId: string) => Promise<{ configured: boolean, source?: string }>} deps.describeCredential
 * @param {(slotId: string, value: string) => Promise<void>} deps.setCredential
 * @param {(slotId: string) => Promise<void>} deps.clearCredential
 * @param {(slotId: string) => Promise<object>} deps.testSlot
 * @param {() => Promise<object>} deps.storeStats
 * @param {() => Promise<object[]>} deps.listConsultations
 * @param {(id: string) => Promise<object|null>} deps.readConsultation
 * @param {(id: string) => Promise<boolean>} deps.deleteConsultation
 * @returns {Array<() => void>} disposers.
 */
export function registerSettingsRoutes(deps) {
  const disposers = []

  async function guard(req, res) {
    if (!isLoopback(req.socket?.remoteAddress)) {
      sendJson(res, 403, { ok: false, error: 'this endpoint is available to loopback clients only' })
      return false
    }
    if (req.headers[HEADER] !== '1') {
      sendJson(res, 403, { ok: false, error: `missing required header ${HEADER}: 1` })
      return false
    }
    return true
  }

  async function handleState(req, res) {
    if (!(await guard(req, res))) return
    const config = deps.getConfig()
    const slots = []
    const credentials = {}
    for (const slotId of SLOT_IDS) {
      const slot = config.slots[slotId]
      let info = { configured: false }
      try {
        info = await deps.describeCredential(slotId)
      } catch {
        info = { configured: false }
      }
      slots.push(publicSlot(slot, info.configured))
      credentials[slot.credentialRef] = { configured: info.configured === true, source: info.source ?? null }
    }
    const storeStats = await deps.storeStats().catch(() => null)
    sendJson(res, 200, {
      ok: true,
      version: 1,
      protocols: PROTOCOLS,
      slots,
      credentials,
      defaults: config.defaults,
      security: {
        allowedHosts: config.security.allowedHosts,
        trustedLocalEndpoints: config.security.trustedLocalEndpoints,
        maxPayloadBytes: config.security.maxPayloadBytes,
        redactSecrets: config.security.redactSecrets,
        allowRepoScope: config.security.allowRepoScope,
      },
      warnings: config.warnings,
      store: storeStats,
    })
  }

  async function handleSecurity(req, res) {
    if (!(await guard(req, res))) return
    let body
    try {
      body = await readJsonBody(req)
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message })
      return
    }
    const patch = sanitizeSecurityPatch(body.patch)
    if (Object.keys(patch).length === 0) {
      sendJson(res, 400, { ok: false, error: 'no writable field was supplied' })
      return
    }
    try {
      await deps.writeSecurity(patch)
    } catch (error) {
      sendJson(res, 409, { ok: false, error: String(error?.message ?? error) })
      return
    }
    await handleState(req, res)
  }

  async function handleSlot(req, res) {
    if (!(await guard(req, res))) return
    let body
    try {
      body = await readJsonBody(req)
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message })
      return
    }
    const slotId = body.slot
    if (!SLOT_IDS.includes(slotId)) {
      sendJson(res, 400, { ok: false, error: `"slot" must be one of ${SLOT_IDS.join(', ')}` })
      return
    }
    const patch = sanitizeSlotPatch(body.patch)
    if (Object.keys(patch).length === 0) {
      sendJson(res, 400, { ok: false, error: 'no writable field was supplied' })
      return
    }
    try {
      await deps.writeSlot(slotId, patch)
    } catch (error) {
      sendJson(res, 409, { ok: false, error: String(error?.message ?? error) })
      return
    }
    // Re-read through the same path the page uses, so the page never has to
    // merge two shapes of the same state.
    await handleState(req, res)
  }

  async function handleCredentialSet(req, res) {
    if (!(await guard(req, res))) return
    let body
    try {
      body = await readJsonBody(req)
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message })
      return
    }
    const slotId = body.slot
    if (!SLOT_IDS.includes(slotId)) {
      sendJson(res, 400, { ok: false, error: `"slot" must be one of ${SLOT_IDS.join(', ')}` })
      return
    }
    const value = body.apiKey
    if (typeof value !== 'string' || value.trim().length < 8) {
      sendJson(res, 400, { ok: false, error: '"apiKey" must be a non-empty string of at least 8 characters' })
      return
    }
    try {
      await deps.setCredential(slotId, value.trim())
    } catch (error) {
      sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
      return
    }
    const info = await deps.describeCredential(slotId).catch(() => ({ configured: false }))
    sendJson(res, 200, { ok: true, credential: { slot: slotId, configured: info.configured === true, source: info.source ?? null } })
  }

  async function handleCredentialClear(req, res) {
    if (!(await guard(req, res))) return
    let body
    try {
      body = await readJsonBody(req)
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message })
      return
    }
    const slotId = body.slot
    if (!SLOT_IDS.includes(slotId)) {
      sendJson(res, 400, { ok: false, error: `"slot" must be one of ${SLOT_IDS.join(', ')}` })
      return
    }
    try {
      await deps.clearCredential(slotId)
    } catch (error) {
      sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
      return
    }
    sendJson(res, 200, { ok: true, credential: { slot: slotId, configured: false } })
  }

  async function handleTest(req, res) {
    if (!(await guard(req, res))) return
    let body
    try {
      body = await readJsonBody(req)
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message })
      return
    }
    const slotId = body.slot
    if (!SLOT_IDS.includes(slotId)) {
      sendJson(res, 400, { ok: false, error: `"slot" must be one of ${SLOT_IDS.join(', ')}` })
      return
    }
    try {
      const result = await deps.testSlot(slotId)
      sendJson(res, 200, { ok: true, result })
    } catch (error) {
      sendJson(res, 200, {
        ok: true,
        result: {
          ok: false,
          slot: slotId,
          billable: true,
          error: { category: CATEGORY.UNKNOWN, message: String(error?.message ?? error) },
        },
      })
    }
  }

  async function handleHistory(req, res, url) {
    if (!(await guard(req, res))) return
    const limit = Number(url.searchParams.get('limit') ?? '20')
    const items = await deps.listConsultations(Number.isFinite(limit) ? limit : 20).catch(() => [])
    sendJson(res, 200, { ok: true, consultations: items })
  }

  async function handleHistoryItem(req, res, url) {
    if (!(await guard(req, res))) return
    // The webServer matches a prefix as `pathname === prefix || pathname.startsWith(prefix + '/')`,
    // so the registered prefix carries no trailing slash and the id is what follows it.
    const id = url.pathname.slice('/expert-council/history/'.length)
    const record = await deps.readConsultation(decodeURIComponent(id)).catch(() => null)
    if (record === null) {
      sendJson(res, 404, { ok: false, error: `no consultation "${id}"` })
      return
    }
    sendJson(res, 200, { ok: true, consultation: record })
  }

  async function handleHistoryDelete(req, res) {
    if (!(await guard(req, res))) return
    let body
    try {
      body = await readJsonBody(req)
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message })
      return
    }
    if (typeof body.id !== 'string' || body.id === '') {
      sendJson(res, 400, { ok: false, error: '"id" is required' })
      return
    }
    const removed = await deps.deleteConsultation(body.id).catch(() => false)
    sendJson(res, 200, { ok: true, removed })
  }

  function route(kind, path, handler) {
    disposers.push(
      deps.webServer.register({
        kind,
        path,
        handler: async (req, res) => {
          try {
            await handler(req, res, new URL(req.url ?? '/', 'http://127.0.0.1'))
          } catch (error) {
            if (!res.headersSent) {
              sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
            } else {
              try {
                res.end()
              } catch {
                // already closed
              }
            }
          }
        },
      }),
    )
  }

  route('exact', '/expert-council/state', handleState)
  route('exact', '/expert-council/slot', handleSlot)
  route('exact', '/expert-council/security', handleSecurity)
  route('exact', '/expert-council/credential', (req, res) => (req.method === 'DELETE' ? handleCredentialClear(req, res) : handleCredentialSet(req, res)))
  route('exact', '/expert-council/test', handleTest)
  route('exact', '/expert-council/history', handleHistory)
  route('exact', '/expert-council/history/delete', handleHistoryDelete)
  route('prefix', '/expert-council/history', handleHistoryItem)

  return disposers
}
