// [OI] Chat Completions response parsing, end-to-end through a real loopback
// HTTP server (no network access, no third-party mock libraries).

import assert from 'node:assert/strict'
import { test, describe } from 'node:test'

import * as openai from '../../plugin/src/host/protocols/openai-chat-completions.js'
import { makeSlot, makeBrief, startMockServer, sendJson, sendRaw, callAdapter } from './helpers.js'

async function serve(t, payload, { status = 200, headers = {} } = {}) {
  const server = await startMockServer((req, res) => sendJson(res, status, payload, headers))
  t.after(() => server.close())
  const slot = makeSlot({ baseUrl: server.baseUrl })
  const outcome = await callAdapter({ adapter: openai, slot, brief: makeBrief() })
  return { server, outcome }
}

describe('[OI] successful responses', () => {
  test('normal text response maps every contract field', async (t) => {
    const { outcome } = await serve(t, {
      id: 'chatcmpl-abc',
      object: 'chat.completion',
      created: 1700000000,
      model: 'mock-model-1-0613',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: '  The drift comes from step size.  ' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 120, completion_tokens: 42, total_tokens: 162 },
    }, { headers: { 'x-request-id': 'req_oi_1' } })

    const { result, request } = outcome
    assert.equal(result.ok, true)
    assert.equal(result.answer, 'The drift comes from step size.')
    assert.deepEqual(result.blocks, [{ type: 'text', text: '  The drift comes from step size.  ' }])
    assert.equal(result.finishReason, 'stop')
    assert.equal(result.requestId, 'req_oi_1')
    assert.equal(result.modelId, 'mock-model-1-0613')
    assert.equal(typeof result.durationMs, 'number')
    assert.ok(result.durationMs >= 0)
    assert.deepEqual(result.usage, {
      inputTokens: 120,
      outputTokens: 42,
      totalTokens: 162,
      cacheReadTokens: null,
      reasoningTokens: null,
    })
    assert.equal(result.raw.id, 'chatcmpl-abc')
    assert.deepEqual(result.capabilities, { ...openai.capabilities })
    // The adapter sent the normalized endpoint and a bearer header.
    assert.ok(request.url.endsWith('/v1/chat/completions'), `unexpected url: ${request.url}`)
    assert.equal(request.url.includes('/v1/v1'), false)
  })

  test('usage details are mapped when the provider reports them', async (t) => {
    const { outcome } = await serve(t, {
      model: 'mock-model-1',
      choices: [{ index: 0, message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        prompt_tokens_details: { cached_tokens: 8 },
        completion_tokens_details: { reasoning_tokens: 3 },
      },
    })
    assert.deepEqual(outcome.result.usage, {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      cacheReadTokens: 8,
      reasoningTokens: 3,
    })
  })

  test('missing usage yields nulls, never zeros', async (t) => {
    const { outcome } = await serve(t, {
      model: 'mock-model-1',
      choices: [{ index: 0, message: { content: 'ok' }, finish_reason: 'stop' }],
    })
    assert.deepEqual(outcome.result.usage, {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      cacheReadTokens: null,
      reasoningTokens: null,
    })
  })

  test('a partially reported usage keeps unknown fields null', async (t) => {
    const { outcome } = await serve(t, {
      choices: [{ index: 0, message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { completion_tokens: 7 },
    })
    assert.deepEqual(outcome.result.usage, {
      inputTokens: null,
      outputTokens: 7,
      totalTokens: null,
      cacheReadTokens: null,
      reasoningTokens: null,
    })
  })

  test('content parts are concatenated and reasoning is not displayable text', async (t) => {
    const { outcome } = await serve(t, {
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'first' },
            { type: 'text', text: 'second' },
          ],
          reasoning_content: 'hidden chain of thought',
        },
        finish_reason: 'stop',
      }],
    })
    const { result } = outcome
    assert.equal(result.answer, 'first\n\nsecond')
    assert.equal(result.answer.includes('hidden'), false)
    assert.deepEqual(result.blocks, [
      { type: 'text', text: 'first' },
      { type: 'text', text: 'second' },
      { type: 'reasoning-summary', text: 'hidden chain of thought' },
    ])
  })

  test('finish_reason length maps to max_tokens and tool_calls to tool_use', async (t) => {
    const truncated = await serve(t, {
      choices: [{ index: 0, message: { content: 'partial' }, finish_reason: 'length' }],
    })
    assert.equal(truncated.outcome.result.finishReason, 'max_tokens')

    const tools = await serve(t, {
      choices: [{ index: 0, message: { content: 'calling' }, finish_reason: 'tool_calls' }],
    })
    assert.equal(tools.outcome.result.finishReason, 'tool_use')
  })

  test('requestId falls back to the response body id', async (t) => {
    const { outcome } = await serve(t, {
      id: 'chatcmpl-fallback',
      choices: [{ index: 0, message: { content: 'ok' }, finish_reason: 'stop' }],
    })
    assert.equal(outcome.result.requestId, 'chatcmpl-fallback')
  })

  test('parseResponse also accepts an already-parsed body', () => {
    const result = openai.parseResponse({
      slot: makeSlot({ baseUrl: 'https://x' }),
      body: { model: 'm', choices: [{ message: { content: 'from object' }, finish_reason: 'stop' }] },
      startedAt: Date.now(),
    })
    assert.equal(result.ok, true)
    assert.equal(result.answer, 'from object')
  })
})

describe('[OI] malformed responses', () => {
  test('empty content is EMPTY_RESPONSE, not a crash', async (t) => {
    const { outcome } = await serve(t, {
      choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
    })
    assert.equal(outcome.result.ok, false)
    assert.equal(outcome.result.error.category, 'EMPTY_RESPONSE')
    assert.equal(outcome.result.error.retryable, false)
  })

  test('null content with a length finish reason is EMPTY_RESPONSE and explains why', async (t) => {
    const { outcome } = await serve(t, {
      choices: [{ index: 0, message: { content: null }, finish_reason: 'length' }],
    })
    assert.equal(outcome.result.error.category, 'EMPTY_RESPONSE')
    assert.match(outcome.result.error.message, /max_tokens/)
  })

  test('missing choices[] is BAD_RESPONSE', async (t) => {
    const { outcome } = await serve(t, { id: 'x', model: 'm', usage: {} })
    assert.equal(outcome.result.ok, false)
    assert.equal(outcome.result.error.category, 'BAD_RESPONSE')
    assert.match(outcome.result.error.message, /choices/)
  })

  test('an empty choices[] array is BAD_RESPONSE', async (t) => {
    const { outcome } = await serve(t, { choices: [] })
    assert.equal(outcome.result.error.category, 'BAD_RESPONSE')
    assert.match(outcome.result.error.message, /empty choices/)
  })

  test('a JSON array body is BAD_RESPONSE', async (t) => {
    const server = await startMockServer((req, res) => sendJson(res, 200, [1, 2, 3]))
    t.after(() => server.close())
    const outcome = await callAdapter({
      adapter: openai,
      slot: makeSlot({ baseUrl: server.baseUrl }),
      brief: makeBrief(),
    })
    assert.equal(outcome.result.error.category, 'BAD_RESPONSE')
  })

  test('non-JSON 200 body is BAD_RESPONSE', async (t) => {
    const server = await startMockServer((req, res) => sendRaw(res, 200, 'definitely not json'))
    t.after(() => server.close())
    const outcome = await callAdapter({
      adapter: openai,
      slot: makeSlot({ baseUrl: server.baseUrl }),
      brief: makeBrief(),
    })
    assert.equal(outcome.result.error.category, 'BAD_RESPONSE')
    assert.match(outcome.result.error.message, /not valid JSON/)
  })

  test('an empty 200 body is BAD_RESPONSE', async (t) => {
    const server = await startMockServer((req, res) => sendRaw(res, 200, ''))
    t.after(() => server.close())
    const outcome = await callAdapter({
      adapter: openai,
      slot: makeSlot({ baseUrl: server.baseUrl }),
      brief: makeBrief(),
    })
    assert.equal(outcome.result.error.category, 'BAD_RESPONSE')
    assert.match(outcome.result.error.message, /empty/)
  })

  test('an SSE body is rejected instead of silently truncated', async (t) => {
    const server = await startMockServer((req, res) => {
      sendRaw(res, 200, 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n', 'text/event-stream')
    })
    t.after(() => server.close())
    const outcome = await callAdapter({
      adapter: openai,
      slot: makeSlot({ baseUrl: server.baseUrl }),
      brief: makeBrief(),
    })
    assert.equal(outcome.result.ok, false)
    assert.equal(outcome.result.error.category, 'BAD_RESPONSE')
    assert.match(outcome.result.error.message, /streaming/i)
  })

  test('an error-shaped 200 body is PROVIDER_ERROR, not BAD_RESPONSE', async (t) => {
    const { outcome } = await serve(t, { error: { message: 'quota exhausted', code: 'insufficient_quota' } })
    assert.equal(outcome.result.error.category, 'PROVIDER_ERROR')
    assert.equal(outcome.result.error.providerCode, 'insufficient_quota')
    assert.match(outcome.result.error.message, /quota exhausted/)
  })
})
