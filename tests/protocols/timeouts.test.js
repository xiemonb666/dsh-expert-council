// Timeout and cancellation behaviour (contract §2: both protocols must honour
// AbortSignal). Timeouts must be distinguishable from user cancellation.

import assert from 'node:assert/strict'
import { test, describe } from 'node:test'

import * as openai from '../../plugin/src/host/protocols/openai-chat-completions.js'
import * as anthropic from '../../plugin/src/host/protocols/anthropic-messages.js'
import { makeSlot, makeBrief, startMockServer, sendJson, callAdapter } from './helpers.js'

/** A server that accepts the request but never answers until the test closes it. */
async function hangingServer(t) {
  const server = await startMockServer(() => {
    // Intentionally never responds; the client must abort.
  })
  t.after(() => server.close())
  return server
}

function slotFor(adapter, baseUrl) {
  return adapter === anthropic
    ? makeSlot({ protocol: 'anthropic_messages', authScheme: 'x-api-key', baseUrl })
    : makeSlot({ baseUrl })
}

describe('timeouts', () => {
  test('[OI] a timed-out request is TIMEOUT, retryable, with no HTTP status', async (t) => {
    const server = await hangingServer(t)
    const slot = slotFor(openai, server.baseUrl)
    const { result } = await callAdapter({
      adapter: openai,
      slot,
      brief: makeBrief(),
      signal: AbortSignal.timeout(60),
      timedOut: true,
    })
    assert.equal(result.ok, false)
    assert.equal(result.error.category, 'TIMEOUT')
    assert.equal(result.error.httpStatus, null)
    assert.equal(result.error.retryable, true)
    assert.match(result.error.message, /timed out/i)
  })

  test('[AN] a timed-out request is TIMEOUT too', async (t) => {
    const server = await hangingServer(t)
    const slot = slotFor(anthropic, server.baseUrl)
    const { result } = await callAdapter({
      adapter: anthropic,
      slot,
      brief: makeBrief(),
      signal: AbortSignal.timeout(60),
      timedOut: true,
    })
    assert.equal(result.error.category, 'TIMEOUT')
    assert.equal(result.error.retryable, true)
  })

  test('AbortSignal.timeout() is recognised as a timeout even without the flag', async (t) => {
    // Node reports the abort as AbortError with `cause = signal.reason`
    // (TimeoutError), so the adapter can tell a timeout from a user cancel on
    // its own. The host layer still passes `timedOut: true`; this is a backstop.
    const server = await hangingServer(t)
    const { result } = await callAdapter({
      adapter: openai,
      slot: slotFor(openai, server.baseUrl),
      brief: makeBrief(),
      signal: AbortSignal.timeout(60),
      timedOut: false,
    })
    assert.equal(result.error.category, 'TIMEOUT')
  })

  test('a TimeoutError-shaped error is TIMEOUT; ETIMEDOUT too', () => {
    const timeoutError = Object.assign(new Error('socket timed out'), { name: 'TimeoutError' })
    assert.equal(openai.parseError({ error: timeoutError }).category, 'TIMEOUT')
    const etimedout = Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' })
    assert.equal(anthropic.parseError({ error: etimedout }).category, 'TIMEOUT')
    assert.equal(openai.parseError({ error: null, timedOut: true }).category, 'TIMEOUT')
  })
})

describe('cancellation', () => {
  test('[OI] a user cancel is CANCELLED and not retryable', async (t) => {
    const server = await hangingServer(t)
    const controller = new AbortController()
    setTimeout(() => controller.abort(new Error('user pressed stop')), 40)
    const { result } = await callAdapter({
      adapter: openai,
      slot: slotFor(openai, server.baseUrl),
      brief: makeBrief(),
      signal: controller.signal,
      timedOut: false,
    })
    assert.equal(result.ok, false)
    assert.equal(result.error.category, 'CANCELLED')
    assert.equal(result.error.retryable, false)
    assert.equal(result.error.httpStatus, null)
    assert.match(result.error.message, /cancelled/i)
  })

  test('[AN] a user cancel is CANCELLED', async (t) => {
    const server = await hangingServer(t)
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 40)
    const { result } = await callAdapter({
      adapter: anthropic,
      slot: slotFor(anthropic, server.baseUrl),
      brief: makeBrief(),
      signal: controller.signal,
    })
    assert.equal(result.error.category, 'CANCELLED')
    assert.equal(result.error.retryable, false)
  })

  test('an abort without a reason is still CANCELLED, not TIMEOUT', () => {
    const controller = new AbortController()
    controller.abort()
    const abortError = Object.assign(new Error('The operation was aborted'), { name: 'AbortError', code: 'ABORT_ERR' })
    const result = openai.parseError({ error: abortError, signal: controller.signal, timedOut: false })
    assert.equal(result.category, 'CANCELLED')
  })

  test('the timedOut flag wins over an AbortError name', () => {
    const abortError = Object.assign(new Error('The operation was aborted'), { name: 'AbortError', code: 'ABORT_ERR' })
    assert.equal(openai.parseError({ error: abortError, timedOut: true }).category, 'TIMEOUT')
  })

  test('a signal aborted before the request is built never opens a socket', async (t) => {
    const server = await startMockServer((req, res) => sendJson(res, 200, { choices: [] }))
    t.after(() => server.close())
    const controller = new AbortController()
    controller.abort(new Error('stop'))
    const outcome = await callAdapter({
      adapter: openai,
      slot: slotFor(openai, server.baseUrl),
      brief: makeBrief(),
      signal: controller.signal,
    })
    assert.equal(outcome.request, null)
    assert.equal(outcome.result.error.category, 'CANCELLED')
    assert.equal(server.requests.length, 0, 'no request may reach the provider')
  })
})
