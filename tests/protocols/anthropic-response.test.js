// Anthropic Messages response parsing: content[] aggregation, thinking blocks,
// stop_reason mapping and usage (contract §2).

import assert from 'node:assert/strict'
import { test, describe } from 'node:test'

import * as anthropic from '../../plugin/src/host/protocols/anthropic-messages.js'
import { makeSlot, makeBrief, startMockServer, sendJson, sendRaw, callAdapter } from './helpers.js'

function anthropicSlot(overrides = {}) {
  return makeSlot({
    protocol: 'anthropic_messages',
    authScheme: 'x-api-key',
    baseUrl: 'https://api.anthropic.com',
    modelId: 'claude-test',
    ...overrides,
  })
}

async function serve(t, payload, { status = 200, headers = {} } = {}) {
  const server = await startMockServer((req, res) => sendJson(res, status, payload, headers))
  t.after(() => server.close())
  const outcome = await callAdapter({
    adapter: anthropic,
    slot: anthropicSlot({ baseUrl: server.baseUrl }),
    brief: makeBrief(),
  })
  return { server, outcome }
}

function message(overrides = {}) {
  return {
    id: 'msg_01abc',
    type: 'message',
    role: 'assistant',
    model: 'claude-test-20250101',
    content: [{ type: 'text', text: 'Answer body.' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 210, output_tokens: 64 },
    ...overrides,
  }
}

describe('Anthropic successful responses', () => {
  test('normal response maps every contract field', async (t) => {
    const { outcome } = await serve(t, message(), { headers: { 'request-id': 'req_an_1' } })
    const { result, request } = outcome

    assert.equal(result.ok, true)
    assert.equal(result.answer, 'Answer body.')
    assert.deepEqual(result.blocks, [{ type: 'text', text: 'Answer body.' }])
    assert.equal(result.finishReason, 'stop')
    assert.equal(result.requestId, 'req_an_1')
    assert.equal(result.modelId, 'claude-test-20250101')
    assert.deepEqual(result.usage, {
      inputTokens: 210,
      outputTokens: 64,
      totalTokens: null,
      cacheReadTokens: null,
      reasoningTokens: null,
    })
    assert.equal(typeof result.durationMs, 'number')
    assert.deepEqual(result.capabilities, { ...anthropic.capabilities })
    assert.ok(request.url.endsWith('/v1/messages'), `unexpected url: ${request.url}`)
    assert.equal(request.url.includes('/v1/v1'), false)
  })

  test('multiple content blocks are joined; thinking is skipped from the answer', async (t) => {
    const { outcome } = await serve(t, message({
      content: [
        { type: 'thinking', thinking: 'let me reason about the drift', signature: 'sig' },
        { type: 'text', text: 'Cause one: truncation error.' },
        { type: 'text', text: 'Cause two: floating point accumulation.' },
      ],
    }))
    const { result } = outcome

    assert.equal(result.answer, 'Cause one: truncation error.\n\nCause two: floating point accumulation.')
    assert.equal(result.answer.includes('let me reason'), false, 'thinking must never leak into the answer')
    assert.deepEqual(result.blocks, [
      { type: 'reasoning-summary', text: 'let me reason about the drift' },
      { type: 'text', text: 'Cause one: truncation error.' },
      { type: 'text', text: 'Cause two: floating point accumulation.' },
    ])
  })

  test('redacted_thinking and tool_use blocks are dropped entirely', async (t) => {
    const { outcome } = await serve(t, message({
      content: [
        { type: 'redacted_thinking', data: 'opaque' },
        { type: 'tool_use', id: 'toolu_1', name: 'calc', input: { a: 1 } },
        { type: 'text', text: 'Only this is displayable.' },
      ],
    }))
    assert.equal(outcome.result.answer, 'Only this is displayable.')
    assert.deepEqual(outcome.result.blocks, [{ type: 'text', text: 'Only this is displayable.' }])
  })

  test('stop_reason is mapped onto the shared finish-reason vocabulary', async (t) => {
    const table = [
      ['end_turn', 'stop'],
      ['stop_sequence', 'stop'],
      ['max_tokens', 'max_tokens'],
      ['tool_use', 'tool_use'],
      ['pause_turn', 'pause'],
      ['refusal', 'refusal'],
      [null, null],
      ['some_future_reason', 'some_future_reason'],
    ]
    for (const [wire, expected] of table) {
      const { outcome } = await serve(t, message({ stop_reason: wire }))
      assert.equal(outcome.result.finishReason, expected, `stop_reason=${String(wire)}`)
    }
  })

  test('usage fields map, including cache reads, without inventing a total', async (t) => {
    const { outcome } = await serve(t, message({
      usage: { input_tokens: 900, output_tokens: 120, cache_read_input_tokens: 750, cache_creation_input_tokens: 50 },
    }))
    assert.deepEqual(outcome.result.usage, {
      inputTokens: 900,
      outputTokens: 120,
      totalTokens: null,
      cacheReadTokens: 750,
      reasoningTokens: null,
    })
  })

  test('missing usage yields nulls, never zeros', async (t) => {
    const payload = message()
    delete payload.usage
    const { outcome } = await serve(t, payload)
    assert.deepEqual(outcome.result.usage, {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      cacheReadTokens: null,
      reasoningTokens: null,
    })
  })

  test('requestId falls back to the message id', async (t) => {
    const { outcome } = await serve(t, message({ id: 'msg_fallback' }))
    assert.equal(outcome.result.requestId, 'msg_fallback')
  })

  test('parseResponse also accepts an already-parsed body', () => {
    const result = anthropic.parseResponse({
      slot: anthropicSlot(),
      body: message({ content: [{ type: 'text', text: 'object path' }] }),
    })
    assert.equal(result.ok, true)
    assert.equal(result.answer, 'object path')
  })
})

describe('Anthropic malformed responses', () => {
  test('missing content[] is BAD_RESPONSE', async (t) => {
    const payload = message()
    delete payload.content
    const { outcome } = await serve(t, payload)
    assert.equal(outcome.result.ok, false)
    assert.equal(outcome.result.error.category, 'BAD_RESPONSE')
    assert.match(outcome.result.error.message, /content/)
  })

  test('only thinking blocks is EMPTY_RESPONSE', async (t) => {
    const { outcome } = await serve(t, message({
      content: [{ type: 'thinking', thinking: 'silent' }],
    }))
    assert.equal(outcome.result.error.category, 'EMPTY_RESPONSE')
    assert.equal(outcome.result.error.message.includes('silent'), false)
  })

  test('empty text blocks are EMPTY_RESPONSE', async (t) => {
    const { outcome } = await serve(t, message({ content: [{ type: 'text', text: '   ' }] }))
    assert.equal(outcome.result.error.category, 'EMPTY_RESPONSE')
  })

  test('an error-shaped 200 body is PROVIDER_ERROR with the Anthropic code', async (t) => {
    const { outcome } = await serve(t, {
      type: 'error',
      error: { type: 'overloaded_error', message: 'Overloaded' },
    })
    assert.equal(outcome.result.error.category, 'PROVIDER_ERROR')
    assert.equal(outcome.result.error.providerCode, 'overloaded_error')
    assert.match(outcome.result.error.message, /Overloaded/)
  })

  test('non-JSON 200 body is BAD_RESPONSE', async (t) => {
    const server = await startMockServer((req, res) => sendRaw(res, 200, '<html>gateway</html>', 'text/html'))
    t.after(() => server.close())
    const outcome = await callAdapter({
      adapter: anthropic,
      slot: anthropicSlot({ baseUrl: server.baseUrl }),
      brief: makeBrief(),
    })
    assert.equal(outcome.result.error.category, 'BAD_RESPONSE')
  })

  test('an SSE body is rejected', async (t) => {
    const server = await startMockServer((req, res) => {
      sendRaw(res, 200, 'event: message_start\ndata: {}\n\n', 'text/event-stream')
    })
    t.after(() => server.close())
    const outcome = await callAdapter({
      adapter: anthropic,
      slot: anthropicSlot({ baseUrl: server.baseUrl }),
      brief: makeBrief(),
    })
    assert.equal(outcome.result.error.category, 'BAD_RESPONSE')
    assert.match(outcome.result.error.message, /streaming/i)
  })
})
