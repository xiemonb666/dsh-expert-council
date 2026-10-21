// Base URL normalization and endpoint assembly (contract §2: no `/v1/v1`,
// trailing-slash equivalence, INVALID_ENDPOINT for malformed input).

import assert from 'node:assert/strict'
import { test, describe } from 'node:test'

import * as openai from '../../plugin/src/host/protocols/openai-chat-completions.js'
import * as anthropic from '../../plugin/src/host/protocols/anthropic-messages.js'
import { buildEndpointUrl } from '../../plugin/src/host/protocols/shared.js'
import { makeSlot, makeBrief, startMockServer, sendJson, callAdapter } from './helpers.js'

describe('normalizeBaseUrl', () => {
  test('strips trailing slashes without touching the path', () => {
    assert.equal(openai.normalizeBaseUrl('https://api.example.com/v1/'), 'https://api.example.com/v1')
    assert.equal(openai.normalizeBaseUrl('https://api.example.com/'), 'https://api.example.com')
    assert.equal(openai.normalizeBaseUrl('https://api.example.com///'), 'https://api.example.com')
    assert.equal(anthropic.normalizeBaseUrl('  https://api.anthropic.com/v1//  '), 'https://api.anthropic.com/v1')
  })

  test('https://x and https://x/ are equivalent', () => {
    assert.equal(
      openai.normalizeBaseUrl('https://x'),
      openai.normalizeBaseUrl('https://x/'),
    )
    assert.equal(
      buildEndpointUrl('https://x', 'openai_chat_completions'),
      buildEndpointUrl('https://x/', 'openai_chat_completions'),
    )
    assert.equal(buildEndpointUrl('https://x/', 'openai_chat_completions'), 'https://x/v1/chat/completions')
  })

  test('a base URL that already ends with /v1 never becomes /v1/v1', () => {
    assert.equal(buildEndpointUrl('https://api.example.com/v1', 'openai_chat_completions'), 'https://api.example.com/v1/chat/completions')
    assert.equal(buildEndpointUrl('https://api.example.com/v1/', 'openai_chat_completions'), 'https://api.example.com/v1/chat/completions')
    assert.equal(buildEndpointUrl('https://api.anthropic.com/v1', 'anthropic_messages'), 'https://api.anthropic.com/v1/messages')
    assert.equal(buildEndpointUrl('https://api.anthropic.com', 'anthropic_messages'), 'https://api.anthropic.com/v1/messages')
    for (const url of [
      buildEndpointUrl('https://x/v1', 'openai_chat_completions'),
      buildEndpointUrl('https://x/v1/', 'openai_chat_completions'),
      buildEndpointUrl('https://x', 'openai_chat_completions'),
    ]) {
      assert.ok(!url.includes('/v1/v1'), `unexpected duplicated version: ${url}`)
    }
  })

  test('keeps custom gateway prefixes', () => {
    assert.equal(buildEndpointUrl('https://gw.example.com/openai/v1', 'openai_chat_completions'), 'https://gw.example.com/openai/v1/chat/completions')
    assert.equal(buildEndpointUrl('https://gw.example.com/relay', 'anthropic_messages'), 'https://gw.example.com/relay/v1/messages')
  })

  test('preserves an explicit non-default port', () => {
    assert.equal(buildEndpointUrl('http://127.0.0.1:8080/v1', 'openai_chat_completions'), 'http://127.0.0.1:8080/v1/chat/completions')
  })

  test('a base URL that already contains the protocol path is used verbatim', () => {
    assert.equal(buildEndpointUrl('https://x/v1/chat/completions', 'openai_chat_completions'), 'https://x/v1/chat/completions')
    assert.equal(buildEndpointUrl('https://x/v1/messages', 'anthropic_messages'), 'https://x/v1/messages')
  })

  test('invalid URLs raise ProtocolError with code INVALID_ENDPOINT', () => {
    const cases = [
      '',
      '   ',
      'not a url',
      'api.example.com/v1',
      'ftp://api.example.com',
      'https://user:pass@api.example.com',
      'https://api.example.com?x=1',
      'https://api.example.com#frag',
      'https://',
      null,
      undefined,
      42,
    ]
    for (const bad of cases) {
      for (const adapter of [openai, anthropic]) {
        assert.throws(
          () => adapter.normalizeBaseUrl(bad),
          (error) => {
            assert.equal(error.name, 'ProtocolError')
            assert.equal(error.code, 'INVALID_ENDPOINT')
            assert.equal(typeof error.message, 'string')
            assert.ok(error.message.length > 0)
            return true
          },
          `expected INVALID_ENDPOINT for ${String(bad)}`,
        )
      }
    }
  })

  test('unknown protocol id is rejected by the shared validator', () => {
    assert.throws(
      () => openai.normalizeBaseUrl('https://x', 'bogus_protocol'),
      (error) => error.reason === 'UNKNOWN_PROTOCOL' && error.code === 'CAPABILITY_UNSUPPORTED',
    )
  })
})

describe('buildRequest endpoint assembly over real HTTP', () => {
  test('[OI] base URL with a trailing slash reaches /v1/chat/completions', async (t) => {
    const server = await startMockServer((req, res) => {
      sendJson(res, 200, {
        id: 'chatcmpl-1',
        object: 'chat.completion',
        model: 'mock-model-1',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      })
    })
    t.after(() => server.close())
    const slot = makeSlot({ baseUrl: `${server.baseUrl}/` })
    const { result } = await callAdapter({ adapter: openai, slot, brief: makeBrief() })
    assert.equal(result.ok, true)
    assert.equal(server.requests.length, 1)
    assert.equal(server.requests[0].url, '/v1/chat/completions')
  })

  test('[OI] base URL ending in /v1 does not duplicate the version', async (t) => {
    const server = await startMockServer((req, res) => {
      sendJson(res, 200, {
        id: 'chatcmpl-2',
        model: 'mock-model-1',
        choices: [{ index: 0, message: { content: 'ok' }, finish_reason: 'stop' }],
      })
    })
    t.after(() => server.close())
    const slot = makeSlot({ baseUrl: `${server.baseUrl}/v1` })
    const { result } = await callAdapter({ adapter: openai, slot, brief: makeBrief() })
    assert.equal(result.ok, true)
    assert.equal(server.requests[0].url, '/v1/chat/completions')
  })

  test('Anthropic base URL with and without /v1 both reach /v1/messages', async (t) => {
    const server = await startMockServer((req, res) => {
      sendJson(res, 200, {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'mock-anthropic',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 3, output_tokens: 1 },
      })
    })
    t.after(() => server.close())

    for (const suffix of ['', '/', '/v1', '/v1/']) {
      server.requests.length = 0
      const slot = makeSlot({
        protocol: 'anthropic_messages',
        authScheme: 'x-api-key',
        baseUrl: `${server.baseUrl}${suffix}`,
      })
      const { result } = await callAdapter({ adapter: anthropic, slot, brief: makeBrief() })
      assert.equal(result.ok, true, `suffix ${JSON.stringify(suffix)} failed`)
      assert.equal(server.requests[0].url, '/v1/messages', `suffix ${JSON.stringify(suffix)}`)
    }
  })

  test('a malformed base URL fails at buildRequest, before any socket is opened', () => {
    const slot = makeSlot({ baseUrl: 'nope' })
    assert.throws(
      () => openai.buildRequest({ slot, brief: makeBrief() }),
      (error) => error.code === 'INVALID_ENDPOINT',
    )
  })
})
