// Error classification: HTTP status mapping, retry policy, retry-after and
// non-standard (non-JSON) error bodies. Nothing here may throw.

import assert from 'node:assert/strict'
import { test, describe } from 'node:test'

import * as openai from '../../plugin/src/host/protocols/openai-chat-completions.js'
import * as anthropic from '../../plugin/src/host/protocols/anthropic-messages.js'
import { isRetryable } from '../../plugin/src/host/protocols/index.js'
import { makeSlot, makeBrief, startMockServer, sendJson, sendRaw, callAdapter } from './helpers.js'

const slot = makeSlot({ baseUrl: 'https://api.example.com/v1' })

function classify(status, text, headers = {}) {
  return openai.parseError({ slot, status, text, headers })
}

describe('HTTP status classification', () => {
  test('429 is RATE_LIMITED and retryable, with retry-after parsed', () => {
    const result = classify(429, JSON.stringify({ error: { message: 'Rate limit reached', type: 'rate_limit_error' } }), { 'retry-after': '2' })
    assert.equal(result.category, 'RATE_LIMITED')
    assert.equal(result.httpStatus, 429)
    assert.equal(result.retryable, true)
    assert.equal(result.retryAfterMs, 2000)
  })

  test('retry-after may be an HTTP-date', () => {
    const at = new Date(Date.now() + 5000).toUTCString()
    const result = classify(429, '', { 'retry-after': at })
    assert.equal(result.category, 'RATE_LIMITED')
    assert.ok(result.retryAfterMs >= 3000 && result.retryAfterMs <= 6000, `retryAfterMs=${result.retryAfterMs}`)
  })

  test('a missing or unparsable retry-after yields null, not 0', () => {
    assert.equal(classify(429, '').retryAfterMs, null)
    assert.equal(classify(429, '', { 'retry-after': 'soon' }).retryAfterMs, null)
  })

  test('401 and 403 are AUTH_INVALID and terminal', () => {
    for (const status of [401, 403]) {
      const result = classify(status, JSON.stringify({ error: { message: 'invalid api key' } }))
      assert.equal(result.category, 'AUTH_INVALID')
      assert.equal(result.retryable, false)
      assert.equal(result.httpStatus, status)
    }
  })

  test('404 is MODEL_UNAVAILABLE', () => {
    const result = classify(404, JSON.stringify({ error: { message: 'model not found', code: 'model_not_found' } }))
    assert.equal(result.category, 'MODEL_UNAVAILABLE')
    assert.equal(result.providerCode, 'model_not_found')
    assert.equal(result.retryable, false)
  })

  test('400 with a model-not-found message is MODEL_UNAVAILABLE', () => {
    const result = classify(400, JSON.stringify({
      error: { message: 'The model `gpt-4-legacy` does not exist', type: 'invalid_request_error', code: 'model_not_found' },
    }))
    assert.equal(result.category, 'MODEL_UNAVAILABLE')
  })

  test('5xx is PROVIDER_UNAVAILABLE and retryable, except terminal 501/505', () => {
    for (const status of [500, 502, 503, 504, 529]) {
      const result = classify(status, '')
      assert.equal(result.category, 'PROVIDER_UNAVAILABLE', `status ${status}`)
      assert.equal(result.retryable, true, `status ${status}`)
    }
    for (const status of [501, 505]) {
      const result = classify(status, '')
      assert.equal(result.category, 'PROVIDER_UNAVAILABLE')
      assert.equal(result.retryable, false, `status ${status}`)
    }
  })

  test('413 and context-length 400 are PAYLOAD_TOO_LARGE', () => {
    assert.equal(classify(413, '').category, 'PAYLOAD_TOO_LARGE')
    assert.equal(
      classify(400, JSON.stringify({ error: { message: 'This model\'s maximum context length is 8192 tokens', code: 'context_length_exceeded' } })).category,
      'PAYLOAD_TOO_LARGE',
    )
  })

  test('an unsupported parameter is CAPABILITY_UNSUPPORTED', () => {
    const result = classify(400, JSON.stringify({ error: { message: 'Unsupported parameter: temperature is not supported with this model' } }))
    assert.equal(result.category, 'CAPABILITY_UNSUPPORTED')
  })

  test('a generic 4xx is PROVIDER_ERROR', () => {
    const result = classify(400, JSON.stringify({ error: { message: 'bad request' } }))
    assert.equal(result.category, 'PROVIDER_ERROR')
    assert.equal(result.retryable, false)
  })

  test('408 is TIMEOUT and retryable', () => {
    const result = classify(408, '')
    assert.equal(result.category, 'TIMEOUT')
    assert.equal(result.retryable, true)
  })
})

describe('non-standard error bodies', () => {
  test('a plain-text body keeps its text', () => {
    const result = classify(400, 'upstream rejected the request')
    assert.equal(result.category, 'PROVIDER_ERROR')
    assert.equal(result.httpStatus, 400)
    assert.match(result.message, /upstream rejected the request/)
    assert.equal(result.retryable, false)
  })

  test('an HTML error page is flattened, never echoed as markup', () => {
    const html = '<!DOCTYPE html><html><head><title>502</title></head><body><h1>Bad Gateway</h1><p>nginx</p></body></html>'
    const result = classify(400, html)
    assert.equal(result.category, 'PROVIDER_ERROR')
    assert.equal(result.message.includes('<'), false, `markup leaked: ${result.message}`)
    assert.match(result.message, /Bad Gateway/)
  })

  test('an HTML body with a 5xx status is PROVIDER_UNAVAILABLE', () => {
    const result = classify(502, '<html><body>Bad Gateway</body></html>')
    assert.equal(result.category, 'PROVIDER_UNAVAILABLE')
    assert.equal(result.message.includes('<'), false)
  })

  test('an empty body produces a status-only message', () => {
    const result = classify(500, '')
    assert.equal(result.category, 'PROVIDER_UNAVAILABLE')
    assert.equal(result.message, 'HTTP 500')
  })

  test('an Anthropic error envelope exposes its type as providerCode', () => {
    const result = anthropic.parseError({
      slot,
      status: 400,
      text: JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens: must be >= 1' } }),
    })
    assert.equal(result.category, 'PROVIDER_ERROR')
    assert.equal(result.providerCode, 'invalid_request_error')
    assert.match(result.message, /max_tokens/)
  })

  test('a provider 200 with a non-JSON body never throws', () => {
    for (const adapter of [openai, anthropic]) {
      const result = adapter.parseResponse({
        slot,
        response: { status: 200, headers: {} },
        text: 'not json at all',
      })
      assert.equal(result.ok, false)
      assert.equal(result.error.category, 'BAD_RESPONSE')
    }
  })
})

describe('errors end-to-end through the mock server', () => {
  test('429 with retry-after reaches the caller as RATE_LIMITED', async (t) => {
    const server = await startMockServer((req, res) => {
      sendJson(res, 429, { error: { message: 'slow down', type: 'rate_limit_error' } }, { 'retry-after': '3' })
    })
    t.after(() => server.close())
    const outcome = await callAdapter({
      adapter: openai,
      slot: makeSlot({ baseUrl: server.baseUrl }),
      brief: makeBrief(),
    })
    assert.equal(outcome.result.ok, false)
    assert.equal(outcome.result.error.category, 'RATE_LIMITED')
    assert.equal(outcome.result.error.httpStatus, 429)
    assert.equal(outcome.result.error.retryable, true)
    assert.equal(outcome.result.error.retryAfterMs, 3000)
  })

  test('401 carries the provider message and is not retryable', async (t) => {
    const server = await startMockServer((req, res) => {
      sendJson(res, 401, { error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } })
    })
    t.after(() => server.close())
    const outcome = await callAdapter({
      adapter: openai,
      slot: makeSlot({ baseUrl: server.baseUrl }),
      brief: makeBrief(),
    })
    assert.equal(outcome.result.error.category, 'AUTH_INVALID')
    assert.equal(outcome.result.error.providerCode, 'invalid_api_key')
    assert.equal(outcome.result.error.retryable, false)
  })

  test('403 is AUTH_INVALID for Anthropic too', async (t) => {
    const server = await startMockServer((req, res) => {
      sendJson(res, 403, { type: 'error', error: { type: 'permission_error', message: 'permission denied' } })
    })
    t.after(() => server.close())
    const outcome = await callAdapter({
      adapter: anthropic,
      slot: makeSlot({ protocol: 'anthropic_messages', authScheme: 'x-api-key', baseUrl: server.baseUrl }),
      brief: makeBrief(),
    })
    assert.equal(outcome.result.error.category, 'AUTH_INVALID')
    assert.equal(outcome.result.error.providerCode, 'permission_error')
  })

  test('404 model not found is MODEL_UNAVAILABLE and not retried', async (t) => {
    const server = await startMockServer((req, res) => {
      sendJson(res, 404, { error: { message: 'The model `nope` does not exist', code: 'model_not_found' } })
    })
    t.after(() => server.close())
    const outcome = await callAdapter({
      adapter: openai,
      slot: makeSlot({ baseUrl: server.baseUrl }),
      brief: makeBrief(),
    })
    assert.equal(outcome.result.error.category, 'MODEL_UNAVAILABLE')
    assert.equal(outcome.result.error.retryable, false)
  })

  test('500 is PROVIDER_UNAVAILABLE and retryable', async (t) => {
    const server = await startMockServer((req, res) => sendRaw(res, 500, 'internal error'))
    t.after(() => server.close())
    const outcome = await callAdapter({
      adapter: openai,
      slot: makeSlot({ baseUrl: server.baseUrl }),
      brief: makeBrief(),
    })
    assert.equal(outcome.result.error.category, 'PROVIDER_UNAVAILABLE')
    assert.equal(outcome.result.error.retryable, true)
    assert.match(outcome.result.error.message, /internal error/)
  })

  test('an HTML 502 page is classified without throwing', async (t) => {
    const server = await startMockServer((req, res) => {
      sendRaw(res, 502, '<html><body><h1>Bad Gateway</h1></body></html>', 'text/html')
    })
    t.after(() => server.close())
    const outcome = await callAdapter({
      adapter: openai,
      slot: makeSlot({ baseUrl: server.baseUrl }),
      brief: makeBrief(),
    })
    assert.equal(outcome.result.error.category, 'PROVIDER_UNAVAILABLE')
    assert.equal(outcome.result.error.message.includes('<'), false)
  })
})

describe('transport failures', () => {
  test('a refused connection is NETWORK_ERROR and retryable', async (t) => {
    const server = await startMockServer((req, res) => sendJson(res, 200, {}))
    const { baseUrl } = server
    await server.close()
    const outcome = await callAdapter({
      adapter: openai,
      slot: makeSlot({ baseUrl }),
      brief: makeBrief(),
    })
    assert.equal(outcome.result.ok, false)
    assert.equal(outcome.result.error.category, 'NETWORK_ERROR')
    assert.equal(outcome.result.error.httpStatus, null)
    assert.equal(outcome.result.error.retryable, true)
    t.diagnostic(`network error message: ${outcome.result.error.message}`)
  })

  test('no status and no error is UNKNOWN rather than a crash', () => {
    const result = openai.parseError({ slot })
    assert.equal(result.category, 'UNKNOWN')
    assert.equal(result.retryable, false)
  })
})

describe('retry policy', () => {
  test('isRetryable matches the documented matrix', () => {
    assert.equal(isRetryable('RATE_LIMITED', 429), true)
    assert.equal(isRetryable('RATE_LIMITED', null), true)
    assert.equal(isRetryable('PROVIDER_UNAVAILABLE', 503), true)
    assert.equal(isRetryable('PROVIDER_UNAVAILABLE', 501), false)
    assert.equal(isRetryable('NETWORK_ERROR', null), true)
    assert.equal(isRetryable('TIMEOUT', null), true)
    assert.equal(isRetryable('CANCELLED', null), false)
    assert.equal(isRetryable('AUTH_INVALID', 401), false)
    assert.equal(isRetryable('MODEL_UNAVAILABLE', 404), false)
    assert.equal(isRetryable('BAD_RESPONSE', null), false)
    assert.equal(isRetryable('EMPTY_RESPONSE', null), false)
    assert.equal(isRetryable('PAYLOAD_TOO_LARGE', 413), false)
    assert.equal(isRetryable('PROVIDER_ERROR', 400), false)
    assert.equal(isRetryable('PROVIDER_ERROR', 429), true, 'status wins over category')
    assert.equal(isRetryable(undefined, undefined), false)
  })

  test('the retryable flag on parseError agrees with isRetryable', () => {
    const cases = [[429, true], [401, false], [404, false], [500, true], [400, false], [501, false], [503, true]]
    for (const [status, expected] of cases) {
      const result = openai.parseError({ slot, status, text: '' })
      assert.equal(result.retryable, expected, `status ${status}`)
      assert.equal(result.retryable, isRetryable(result.category, status), `status ${status}`)
    }
  })
})
