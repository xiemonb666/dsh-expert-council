// Test helpers for the provider adapters: a real loopback HTTP mock server,
// a minimal HTTP client and contract-shaped slot/brief factories.
//
// Nothing here is imported by production code.

import http from 'node:http'
import https from 'node:https'

import { getProtocol } from '../../plugin/src/host/protocols/index.js'

export const TEST_API_KEY = 'sk-test-SECRET-abcdef123456'

/**
 * Slot shaped exactly like `normalizeSlot()` in plugin/src/host/config.js, with
 * the resolved `apiKey` injected by the caller (the credential service) on top.
 */
export function makeSlot(overrides = {}) {
  return {
    slot: 'L2',
    enabled: true,
    configured: true,
    displayName: 'Test Slot',
    protocol: 'openai_chat_completions',
    providerLabel: 'Mock Provider',
    baseUrl: '',
    modelId: 'mock-model-1',
    credentialRef: 'DSH_EXPERT_L2_API_KEY',
    apiKey: TEST_API_KEY,
    apiVersion: '2023-06-01',
    authScheme: 'bearer',
    maxOutputTokens: 1024,
    maxTokensParam: 'max_tokens',
    temperature: null,
    timeoutMs: 30000,
    retries: 1,
    allowedTasks: [],
    pricing: { inputPerMTokUsd: null, outputPerMTokUsd: null },
    warnings: [],
    ...overrides,
  }
}

export function makeBrief(overrides = {}) {
  return {
    system: 'You are a careful reviewer. Answer precisely.',
    question: 'Why does the energy estimate drift by 3%?',
    context: 'A 1D harmonic oscillator integrated with RK4 at dt=1e-3.',
    evidence: 'E(0)=0.5, E(1s)=0.515',
    requestedOutput: 'List the top three causes, then one check.',
    mode: 'physics_review',
    ...overrides,
  }
}

/**
 * Start a loopback mock server. `handler(req, res, record)` may be async.
 * `requests` records every request's method, url, lowercased headers, raw body
 * and JSON body.
 */
export async function startMockServer(handler) {
  const requests = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', async () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      let json = null
      try {
        json = raw === '' ? null : JSON.parse(raw)
      } catch {
        json = null
      }
      const record = { method: req.method, url: req.url, headers: req.headers, raw, json }
      requests.push(record)
      try {
        await handler(req, res, record)
      } catch (error) {
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'text/plain' })
          res.end(`mock handler failed: ${error && error.message}`)
        } else if (!res.writableEnded) {
          res.end()
        }
      }
    })
  })
  server.keepAliveTimeout = 1000
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close() {
      server.closeAllConnections?.()
      return new Promise((resolve) => server.close(() => resolve()))
    },
  }
}

/** Reply with a JSON body (optionally non-200). */
export function sendJson(res, status, value, headers = {}) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(text)
}

/** Reply with a raw body and explicit content type. */
export function sendRaw(res, status, text, contentType = 'text/plain', headers = {}) {
  res.writeHead(status, { 'content-type': contentType, ...headers })
  res.end(text)
}

/**
 * Minimal HTTP client. Always resolves to `{ status, headers, text, error }` so
 * a transport failure never surfaces as an unhandled rejection.
 */
export function httpRequest({
  url,
  method = 'POST',
  headers = {},
  body = null,
  signal = null,
}) {
  return new Promise((resolve) => {
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    let target
    try {
      target = new URL(url)
    } catch (error) {
      done({ status: null, headers: null, text: '', error })
      return
    }
    const lib = target.protocol === 'https:' ? https : http
    const payload = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body))
    let req
    try {
      req = lib.request(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port,
          path: `${target.pathname}${target.search}`,
          method,
          headers: { connection: 'close', ...headers },
          agent: false,
          signal: signal || undefined,
        },
        (res) => {
          const chunks = []
          res.on('data', (chunk) => chunks.push(chunk))
          res.on('end', () => {
            done({
              status: res.statusCode,
              headers: res.headers,
              text: Buffer.concat(chunks).toString('utf8'),
              error: null,
            })
          })
          res.on('error', (error) => done({ status: null, headers: null, text: '', error }))
        },
      )
    } catch (error) {
      done({ status: null, headers: null, text: '', error })
      return
    }
    req.on('error', (error) => done({ status: null, headers: null, text: '', error }))
    if (payload != null) req.write(payload)
    req.end()
  })
}

/**
 * Stand-in for the host HTTP layer (owned by the Lead): build -> send -> parse.
 * Mirrors the agreed error contract: timeouts pass `timedOut: true`, caller
 * cancellations pass the aborting signal with `timedOut: false`.
 */
export async function callAdapter({ adapter, slot, brief, signal = null, timedOut = false }) {
  const startedAt = Date.now()
  let request
  try {
    request = adapter.buildRequest({ slot, brief, signal })
  } catch (error) {
    return {
      request: null,
      response: null,
      result: {
        ok: false,
        error: {
          category: typeof error.code === 'string' ? error.code : 'UNKNOWN',
          message: error.message,
          httpStatus: null,
          providerCode: null,
          requestId: null,
          retryable: false,
        },
      },
      buildError: error,
    }
  }
  const response = await httpRequest({
    url: request.url,
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal,
  })
  if (response.error) {
    return {
      request,
      response,
      result: {
        ok: false,
        error: adapter.parseError({ slot, error: response.error, signal, timedOut }),
      },
    }
  }
  const result = adapter.parseResponse({ slot, response, text: response.text, startedAt })
  return { request, response, result }
}

/** Convenience: adapter namespace by protocol id. */
export function adapterFor(protocol) {
  return getProtocol(protocol)
}

/** Assert helper: every string leaf of a value, for secret-leak scans. */
export function collectStrings(value, out = [], seen = new Set()) {
  if (typeof value === 'string') {
    out.push(value)
    return out
  }
  if (value === null || typeof value !== 'object') return out
  if (seen.has(value)) return out
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out, seen)
    return out
  }
  for (const key of Object.keys(value)) {
    out.push(key)
    collectStrings(value[key], out, seen)
  }
  return out
}
