// Request rendering: the two protocols must be semantically equivalent while
// keeping their native envelopes (contract §2).

import assert from 'node:assert/strict'
import { test, describe } from 'node:test'

import * as openai from '../../plugin/src/host/protocols/openai-chat-completions.js'
import * as anthropic from '../../plugin/src/host/protocols/anthropic-messages.js'
import { renderUserText } from '../../plugin/src/host/protocols/index.js'
import { makeSlot, makeBrief, TEST_API_KEY } from './helpers.js'

const BASE = 'https://api.example.com/v1'

describe('[OI] chat completions request body', () => {
  test('system goes first as a system message, user text second', () => {
    const slot = makeSlot({ baseUrl: BASE })
    const brief = makeBrief()
    const { url, method, headers, body } = openai.buildRequest({ slot, brief })

    assert.equal(url, `${BASE}/chat/completions`)
    assert.equal(method, 'POST')
    assert.equal(headers['content-type'], 'application/json')
    assert.equal(headers.authorization, `Bearer ${TEST_API_KEY}`)
    assert.equal(headers['x-api-key'], undefined)

    assert.equal(body.model, 'mock-model-1')
    assert.equal(body.stream, false)
    assert.equal(body.messages.length, 2)
    assert.deepEqual(body.messages[0], { role: 'system', content: brief.system })
    assert.equal(body.messages[1].role, 'user')
    assert.equal(body.messages[1].content, renderUserText(brief))
  })

  test('an empty system prompt sends a single user message', () => {
    const slot = makeSlot({ baseUrl: BASE })
    const { body } = openai.buildRequest({ slot, brief: makeBrief({ system: '   ' }) })
    assert.equal(body.messages.length, 1)
    assert.equal(body.messages[0].role, 'user')
  })

  test('max_tokens is sent from maxOutputTokens, and omitted when unusable', () => {
    assert.equal(openai.buildRequest({ slot: makeSlot({ baseUrl: BASE }), brief: makeBrief() }).body.max_tokens, 1024)
    assert.equal(openai.buildRequest({ slot: makeSlot({ baseUrl: BASE, maxOutputTokens: 0 }), brief: makeBrief() }).body.max_tokens, undefined)
    assert.equal(openai.buildRequest({ slot: makeSlot({ baseUrl: BASE, maxOutputTokens: null }), brief: makeBrief() }).body.max_tokens, undefined)
  })

  test('maxTokensParam=max_completion_tokens swaps the parameter, never sends both', () => {
    const slot = makeSlot({ baseUrl: BASE, maxTokensParam: 'max_completion_tokens' })
    const { body } = openai.buildRequest({ slot, brief: makeBrief() })
    assert.equal(body.max_completion_tokens, 1024)
    assert.equal('max_tokens' in body, false)
  })

  test('a missing maxTokensParam behaves like max_tokens', () => {
    const slot = makeSlot({ baseUrl: BASE })
    delete slot.maxTokensParam
    const { body } = openai.buildRequest({ slot, brief: makeBrief() })
    assert.equal(body.max_tokens, 1024)
    assert.equal('max_completion_tokens' in body, false)
  })

  test('temperature is only sent when it is a finite number (0 included)', () => {
    const withNull = openai.buildRequest({ slot: makeSlot({ baseUrl: BASE, temperature: null }), brief: makeBrief() }).body
    assert.equal('temperature' in withNull, false)

    const withZero = openai.buildRequest({ slot: makeSlot({ baseUrl: BASE, temperature: 0 }), brief: makeBrief() }).body
    assert.equal(withZero.temperature, 0)

    const withValue = openai.buildRequest({ slot: makeSlot({ baseUrl: BASE, temperature: 0.2 }), brief: makeBrief() }).body
    assert.equal(withValue.temperature, 0.2)

    const withJunk = openai.buildRequest({ slot: makeSlot({ baseUrl: BASE, temperature: 'hot' }), brief: makeBrief() }).body
    assert.equal('temperature' in withJunk, false)
  })

  test('no unsupported parameters are injected', () => {
    const { body } = openai.buildRequest({ slot: makeSlot({ baseUrl: BASE }), brief: makeBrief() })
    assert.deepEqual(Object.keys(body).sort(), ['max_tokens', 'messages', 'model', 'stream'])
    for (const forbidden of ['tools', 'tool_choice', 'top_p', 'stop', 'n', 'reasoning', 'thinking', 'system', 'max_completion_tokens']) {
      assert.equal(forbidden in body, false, `unexpected parameter: ${forbidden}`)
    }
  })

  test('redactedBody mirrors the body and never contains headers or the key', () => {
    const slot = makeSlot({ baseUrl: BASE })
    const { body, redactedBody } = openai.buildRequest({ slot, brief: makeBrief() })
    assert.deepEqual(redactedBody, body)
    const serialized = JSON.stringify(redactedBody)
    assert.equal(serialized.includes(TEST_API_KEY), false)
    assert.equal(serialized.toLowerCase().includes('authorization'), false)
    assert.equal('headers' in redactedBody, false)
    assert.equal('url' in redactedBody, false)
    assert.notEqual(redactedBody, body, 'redactedBody must be a copy, not the live body')
  })
})

describe('Anthropic messages request body', () => {
  const anthropicSlot = (overrides = {}) => makeSlot({
    protocol: 'anthropic_messages',
    authScheme: 'x-api-key',
    baseUrl: 'https://api.anthropic.com',
    modelId: 'claude-test',
    ...overrides,
  })

  test('system is a top-level field and content is a text block array', () => {
    const brief = makeBrief()
    const { url, method, headers, body } = anthropic.buildRequest({ slot: anthropicSlot(), brief })

    assert.equal(url, 'https://api.anthropic.com/v1/messages')
    assert.equal(method, 'POST')
    assert.equal(headers['anthropic-version'], '2023-06-01')
    assert.equal(headers['x-api-key'], TEST_API_KEY)
    assert.equal(headers.authorization, undefined)

    assert.equal(body.model, 'claude-test')
    assert.equal(body.system, brief.system)
    assert.equal(body.stream, false)
    assert.equal(body.messages.length, 1)
    assert.equal(body.messages[0].role, 'user')
    assert.equal(body.messages[0].content.length, 1)
    assert.equal(body.messages[0].content[0].type, 'text')
    assert.equal(body.messages[0].content[0].text, renderUserText(brief))
    assert.equal(body.messages[0].content[0].text, openai.buildRequest({ slot: makeSlot({ baseUrl: BASE }), brief }).body.messages[1].content)
  })

  test('max_tokens is mandatory and never defaulted', () => {
    assert.equal(anthropic.buildRequest({ slot: anthropicSlot(), brief: makeBrief() }).body.max_tokens, 1024)
    for (const bad of [undefined, null, 0, -5, 'lots', 1.5]) {
      assert.throws(
        () => anthropic.buildRequest({ slot: anthropicSlot({ maxOutputTokens: bad }), brief: makeBrief() }),
        (error) => {
          assert.equal(error.code, 'CAPABILITY_UNSUPPORTED')
          assert.match(error.message, /maxOutputTokens|max_tokens/)
          return true
        },
        `expected CAPABILITY_UNSUPPORTED for maxOutputTokens=${String(bad)}`,
      )
    }
  })

  test('anthropic-version defaults and can be overridden', () => {
    assert.equal(anthropic.buildRequest({ slot: anthropicSlot({ apiVersion: '' }), brief: makeBrief() }).headers['anthropic-version'], '2023-06-01')
    assert.equal(anthropic.buildRequest({ slot: anthropicSlot({ apiVersion: '2024-10-22' }), brief: makeBrief() }).headers['anthropic-version'], '2024-10-22')
  })

  test('authScheme selects x-api-key or bearer, never both', () => {
    const keyed = anthropic.buildRequest({ slot: anthropicSlot({ authScheme: 'x-api-key' }), brief: makeBrief() })
    assert.equal(keyed.headers['x-api-key'], TEST_API_KEY)
    assert.equal(keyed.headers.authorization, undefined)

    const bearer = anthropic.buildRequest({ slot: anthropicSlot({ authScheme: 'bearer' }), brief: makeBrief() })
    assert.equal(bearer.headers.authorization, `Bearer ${TEST_API_KEY}`)
    assert.equal(bearer.headers['x-api-key'], undefined)
  })

  test('an empty system prompt omits the top-level system field', () => {
    const { body } = anthropic.buildRequest({ slot: anthropicSlot(), brief: makeBrief({ system: '' }) })
    assert.equal('system' in body, false)
  })

  test('temperature is optional', () => {
    assert.equal('temperature' in anthropic.buildRequest({ slot: anthropicSlot({ temperature: null }), brief: makeBrief() }).body, false)
    assert.equal(anthropic.buildRequest({ slot: anthropicSlot({ temperature: 1 }), brief: makeBrief() }).body.temperature, 1)
  })

  test('no unsupported parameters are injected', () => {
    const { body } = anthropic.buildRequest({ slot: anthropicSlot(), brief: makeBrief() })
    assert.deepEqual(Object.keys(body).sort(), ['max_tokens', 'messages', 'model', 'stream', 'system'])
  })

  test('redactedBody mirrors the body without headers or key material', () => {
    const { body, redactedBody } = anthropic.buildRequest({ slot: anthropicSlot(), brief: makeBrief() })
    assert.deepEqual(redactedBody, body)
    const serialized = JSON.stringify(redactedBody)
    assert.equal(serialized.includes(TEST_API_KEY), false)
    assert.equal(serialized.includes('x-api-key'), false)
    assert.equal('headers' in redactedBody, false)
  })
})

describe('shared brief rendering', () => {
  test('renders a fixed, deterministic section template', () => {
    const text = renderUserText(makeBrief())
    assert.match(text, /^## Question\nWhy does the energy estimate drift by 3%\?/)
    assert.match(text, /## Context\nA 1D harmonic oscillator/)
    assert.match(text, /## Evidence\nE\(0\)=0\.5/)
    assert.match(text, /## Requested output\nList the top three causes/)
    assert.match(text, /## Mode\nphysics_review/)
  })

  test('omits empty optional sections', () => {
    const text = renderUserText({ question: 'Q only?' })
    assert.equal(text, '## Question\nQ only?')
  })

  test('trims section bodies and ignores non-string values', () => {
    const text = renderUserText({ question: '  spaced  ', context: '   ', evidence: 42 })
    assert.equal(text, '## Question\nspaced')
  })

  test('a missing question is INVALID_BRIEF', () => {
    for (const brief of [{}, { question: '   ' }, { question: 42 }, null]) {
      assert.throws(
        () => openai.buildRequest({ slot: makeSlot({ baseUrl: BASE }), brief }),
        (error) => error.reason === 'INVALID_BRIEF' && error.code === 'PROVIDER_ERROR',
      )
    }
  })

  test('both protocols render byte-identical user text', () => {
    const briefs = [
      makeBrief(),
      makeBrief({ system: '', context: '', evidence: '', requestedOutput: '', mode: '' }),
      makeBrief({ question: 'multi\nline\nquestion', context: 'line1\nline2' }),
    ]
    for (const brief of briefs) {
      const oi = openai.buildRequest({ slot: makeSlot({ baseUrl: BASE }), brief }).body
      const an = anthropic.buildRequest({
        slot: makeSlot({ baseUrl: 'https://api.anthropic.com', protocol: 'anthropic_messages', maxOutputTokens: 512 }),
        brief,
      }).body
      assert.equal(oi.messages[oi.messages.length - 1].content, an.messages[0].content[0].text)
    }
  })
})

describe('buildRequest preflight failures', () => {
  test('a missing modelId is SLOT_UNCONFIGURED', () => {
    for (const adapter of [openai, anthropic]) {
      assert.throws(
        () => adapter.buildRequest({ slot: makeSlot({ baseUrl: BASE, modelId: '  ' }), brief: makeBrief() }),
        (error) => error.code === 'SLOT_UNCONFIGURED',
      )
    }
  })

  test('a missing slot is SLOT_UNCONFIGURED', () => {
    assert.throws(() => openai.buildRequest({ brief: makeBrief() }), (error) => error.code === 'SLOT_UNCONFIGURED')
    assert.throws(() => anthropic.buildRequest({ brief: makeBrief() }), (error) => error.code === 'SLOT_UNCONFIGURED')
  })

  test('an already-aborted signal fails before the request is built', async () => {
    const cancelled = new AbortController()
    cancelled.abort(new Error('user pressed stop'))
    assert.throws(
      () => openai.buildRequest({ slot: makeSlot({ baseUrl: BASE }), brief: makeBrief(), signal: cancelled.signal }),
      (error) => error.code === 'CANCELLED',
    )

    const timedOut = AbortSignal.timeout(1)
    await new Promise((resolve) => setTimeout(resolve, 15))
    assert.throws(
      () => anthropic.buildRequest({ slot: makeSlot({ baseUrl: BASE, protocol: 'anthropic_messages' }), brief: makeBrief(), signal: timedOut }),
      (error) => error.code === 'TIMEOUT',
    )
  })

  test('ProtocolError carries both code and message', () => {
    try {
      openai.buildRequest({ slot: makeSlot({ baseUrl: 'nope' }), brief: makeBrief() })
      assert.fail('expected a throw')
    } catch (error) {
      assert.equal(error.name, 'ProtocolError')
      assert.equal(typeof error.code, 'string')
      assert.equal(typeof error.message, 'string')
      assert.ok(error.message.length > 0)
      assert.ok(error instanceof Error)
    }
  })
})
