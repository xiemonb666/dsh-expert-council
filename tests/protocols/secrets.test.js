// Secret hygiene: the resolved API key must never appear in anything the
// adapter returns (redactedBody, error messages, provider codes, request ids).
// The key is injected by the caller and used for transport only.

import assert from 'node:assert/strict'
import { test, describe } from 'node:test'

import * as openai from '../../plugin/src/host/protocols/openai-chat-completions.js'
import * as anthropic from '../../plugin/src/host/protocols/anthropic-messages.js'
import { makeSlot, makeBrief, TEST_API_KEY, collectStrings, startMockServer, sendJson, callAdapter } from './helpers.js'

const slot = makeSlot({ baseUrl: 'https://api.example.com/v1' })

function assertNoSecret(value, where) {
  const strings = collectStrings(value)
  for (const text of strings) {
    assert.equal(text.includes(TEST_API_KEY), false, `API key leaked into ${where}: ${text}`)
    assert.equal(text.includes('SECRET-abcdef'), false, `API key fragment leaked into ${where}: ${text}`)
  }
  // Belt and braces: the serialized form must not contain the key either.
  const serialized = JSON.stringify(value) ?? ''
  assert.equal(serialized.includes(TEST_API_KEY), false, `API key leaked into ${where} (serialized)`)
}

describe('API key never leaves the transport layer', () => {
  test('redactedBody contains no key or auth material', () => {
    for (const adapter of [openai, anthropic]) {
      const { body, redactedBody } = adapter.buildRequest({
        slot: adapter === anthropic
          ? makeSlot({ protocol: 'anthropic_messages', authScheme: 'x-api-key', baseUrl: 'https://api.anthropic.com' })
          : slot,
        brief: makeBrief(),
      })
      assertNoSecret(body, 'body')
      assertNoSecret(redactedBody, 'redactedBody')
    }
  })

  test('headers do carry the key, but redactedBody has no header keys at all', () => {
    const { headers, redactedBody } = openai.buildRequest({ slot, brief: makeBrief() })
    assert.equal(headers.authorization, `Bearer ${TEST_API_KEY}`)
    const keys = collectStrings(redactedBody).map((text) => text.toLowerCase())
    for (const forbidden of ['authorization', 'x-api-key', 'bearer']) {
      assert.equal(keys.some((text) => text === forbidden), false, `header-like key leaked: ${forbidden}`)
    }
  })

  test('an error body that echoes the key is redacted in message and providerCode', () => {
    for (const adapter of [openai, anthropic]) {
      const result = adapter.parseError({
        slot,
        status: 401,
        text: JSON.stringify({
          error: {
            message: `Incorrect API key provided: ${TEST_API_KEY}. You can find your API key at ...`,
            code: `invalid_key_${TEST_API_KEY}`,
          },
        }),
        headers: { 'x-request-id': `req-${TEST_API_KEY}` },
      })
      assert.equal(result.category, 'AUTH_INVALID')
      assertNoSecret(result, 'parseError result')
      assert.match(result.message, /\[REDACTED\]/)
      assert.equal(result.requestId === null || !result.requestId.includes(TEST_API_KEY), true)
    }
  })

  test('a 200 body echoing the key cannot leak it through requestId or modelId', () => {
    for (const adapter of [openai, anthropic]) {
      const result = adapter.parseResponse({
        slot,
        response: { status: 200, headers: { 'x-request-id': TEST_API_KEY } },
        text: JSON.stringify({
          id: TEST_API_KEY,
          model: 'm',
          choices: [{ index: 0, message: { content: 'ok' }, finish_reason: 'stop' }],
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
        }),
      })
      assert.equal(result.ok, true)
      assertNoSecret({ ...result, raw: null }, 'parseResponse result')
    }
  })

  test('a transport error echoing the key is redacted', () => {
    const error = new Error(`connect failed for key ${TEST_API_KEY}`)
    for (const adapter of [openai, anthropic]) {
      const result = adapter.parseError({ slot, error, signal: null, timedOut: false })
      assertNoSecret(result, 'transport error')
      assert.match(result.message, /\[REDACTED\]/)
    }
  })

  test('an end-to-end 401 over HTTP never returns the key', async (t) => {
    const server = await startMockServer((req, res) => {
      sendJson(res, 401, { error: { message: `bad key ${TEST_API_KEY}` } }, { 'x-request-id': TEST_API_KEY })
    })
    t.after(() => server.close())
    const outcome = await callAdapter({
      adapter: openai,
      slot: makeSlot({ baseUrl: server.baseUrl }),
      brief: makeBrief(),
    })
    assertNoSecret(outcome.result, 'e2e 401 result')
    // The key did travel in the header (that is the point of the credential),
    // but the mock never sees it in the body.
    assert.equal(server.requests[0].headers.authorization, `Bearer ${TEST_API_KEY}`)
    assert.equal(server.requests[0].raw.includes(TEST_API_KEY), false)
  })

  test('a key-shaped token in a provider message is redacted even when it is not the configured key', () => {
    const result = openai.parseError({
      slot,
      status: 400,
      text: JSON.stringify({ error: { message: 'unexpected sk-live-ABCDEFGHIJKLMNOP1234 in payload' } }),
    })
    assert.equal(result.message.includes('sk-live-ABCDEFGHIJKLMNOP1234'), false)
    assert.match(result.message, /\[REDACTED\]/)
  })
})
