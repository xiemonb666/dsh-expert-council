// Robustness: the adapters must never throw on hostile/garbage input, and every
// category they emit must exist in the shared CATEGORY enum
// (plugin/src/host/categories.js, docs/contracts.md §1).

import assert from 'node:assert/strict'
import { test, describe } from 'node:test'

import * as openai from '../../plugin/src/host/protocols/openai-chat-completions.js'
import * as anthropic from '../../plugin/src/host/protocols/anthropic-messages.js'
import { CATEGORY } from '../../plugin/src/host/categories.js'
import { makeSlot, makeBrief } from './helpers.js'

const ADAPTERS = [openai, anthropic]
const KNOWN = new Set(Object.values(CATEGORY))

function abortedSignal() {
  const controller = new AbortController()
  controller.abort(new Error('cancelled by test'))
  return controller.signal
}

const GARBAGE = [
  undefined,
  null,
  0,
  42,
  '',
  '   ',
  'null',
  '[]',
  '{}',
  '{"choices":"nope"}',
  '{"content":"nope"}',
  '{"choices":[null]}',
  '{"choices":[{"message":null}]}',
  '{"choices":[{"message":{"content":42}}]}',
  '{"choices":[{"message":{"content":[]}}],"usage":"bad"}',
  '{"content":[null,42,{"type":"text"}]}',
  '{"content":[{"type":"text","text":42}]}',
  '{"error":null}',
  '{"error":[]}',
  '{"error":{"message":null}}',
  '{"type":"error"}',
  '<html><body>oops</body></html>',
  'data: {"choices":[]}',
  '\u0000\u0001binary',
]

describe('parseResponse never throws', () => {
  test('a table of malformed bodies always yields a contract-shaped result', () => {
    for (const adapter of ADAPTERS) {
      for (const text of GARBAGE) {
        let result
        assert.doesNotThrow(() => {
          result = adapter.parseResponse({
            slot: makeSlot({ baseUrl: 'https://x' }),
            response: { status: 200, headers: {} },
            text,
            startedAt: Date.now(),
          })
        }, `threw for ${JSON.stringify(text)}`)
        assert.equal(typeof result, 'object')
        assert.equal(result.ok, false, `expected a failure for ${JSON.stringify(text)}`)
        assert.ok(KNOWN.has(result.error.category), `unknown category ${result.error.category}`)
        assert.equal(typeof result.error.message, 'string')
        assert.ok(result.error.message.length > 0)
        assert.equal(typeof result.error.retryable, 'boolean')
      }
    }
  })

  test('garbage response objects and missing arguments do not throw', () => {
    for (const adapter of ADAPTERS) {
      for (const response of [null, undefined, {}, { status: 'abc' }, { statusCode: 200 }, 42, 'x']) {
        const result = adapter.parseResponse({
          slot: makeSlot({ baseUrl: 'https://x' }),
          response,
          text: '',
        })
        assert.equal(result.ok, false)
        assert.ok(KNOWN.has(result.error.category))
      }
      const noArgs = adapter.parseResponse({})
      assert.equal(noArgs.ok, false)
      assert.ok(KNOWN.has(noArgs.error.category))
    }
  })
})

describe('parseError never throws', () => {
  test('a table of odd status/text/header combinations stays inside the enum', () => {
    const statuses = [undefined, null, 0, -1, 200, 301, 400, 401, 403, 404, 408, 413, 418, 422, 429, 451, 500, 501, 502, 503, 504, 505, 529, 599, 600, '429', NaN, Infinity]
    const texts = [undefined, null, '', 'plain text', '<html>', '{"error":{"message":"x"}}', '{"type":"error","error":{"type":"y"}}', '{}', '[]', '\u0000']
    const headers = [undefined, null, {}, { 'retry-after': '2' }, { 'retry-after': 'garbage' }, { 'x-request-id': 'r1' }, new Map([['retry-after', '1']])]
    for (const adapter of ADAPTERS) {
      for (const status of statuses) {
        for (const text of texts) {
          for (const h of headers) {
            let result
            assert.doesNotThrow(() => {
              result = adapter.parseError({ slot: makeSlot({ baseUrl: 'https://x' }), status, text, headers: h })
            }, `threw for status=${String(status)} text=${String(text)}`)
            assert.ok(KNOWN.has(result.category), `unknown category ${result.category}`)
            assert.equal(typeof result.message, 'string')
            assert.equal(typeof result.retryable, 'boolean')
            assert.equal(result.retryable, adapter.isRetryable(result.category, result.httpStatus))
            if (result.httpStatus !== null) assert.equal(typeof result.httpStatus, 'number')
            if (result.retryAfterMs !== null) assert.equal(typeof result.retryAfterMs, 'number')
          }
        }
      }
    }
  })

  test('a non-Error transport failure does not throw', () => {
    for (const adapter of ADAPTERS) {
      for (const error of [null, undefined, 'boom', { name: 'Error', message: 'x' }, { code: 'ECONNRESET' }]) {
        assert.doesNotThrow(() => adapter.parseError({ slot: makeSlot({ baseUrl: 'https://x' }), error }))
      }
    }
  })
})

describe('category vocabulary', () => {
  test('every category the adapters can produce exists in CATEGORY', () => {
    const observed = new Set()
    for (const adapter of ADAPTERS) {
      for (const status of [400, 401, 403, 404, 408, 413, 422, 429, 500, 501, 503, 529]) {
        observed.add(adapter.parseError({ slot: makeSlot({ baseUrl: 'https://x' }), status, text: '' }).category)
      }
      observed.add(adapter.parseError({ slot: makeSlot({ baseUrl: 'https://x' }) }).category)
      observed.add(adapter.parseError({ slot: makeSlot({ baseUrl: 'https://x' }), timedOut: true }).category)
      observed.add(adapter.parseError({
        slot: makeSlot({ baseUrl: 'https://x' }),
        error: Object.assign(new Error('x'), { name: 'AbortError' }),
      }).category)
      observed.add(adapter.parseResponse({ slot: makeSlot({ baseUrl: 'https://x' }), text: 'nope' }).error.category)
      observed.add(adapter.parseResponse({
        slot: makeSlot({ baseUrl: 'https://x' }),
        text: JSON.stringify({ choices: [{ message: { content: '' } }], content: [] }),
      }).error.category)
      observed.add(adapter.parseResponse({
        slot: makeSlot({ baseUrl: 'https://x' }),
        text: JSON.stringify({ error: { message: 'x' } }),
      }).error.category)
    }
    for (const category of observed) {
      assert.ok(KNOWN.has(category), `adapter emitted ${category}, which is not in CATEGORY`)
    }
  })

  test('buildRequest preflight codes map onto valid ErrorCategory values', () => {
    const cases = [
      () => openai.buildRequest({ brief: makeBrief() }),
      () => openai.buildRequest({ slot: makeSlot({ baseUrl: 'https://x', modelId: '' }), brief: makeBrief() }),
      () => openai.buildRequest({ slot: makeSlot({ baseUrl: 'nope' }), brief: makeBrief() }),
      () => anthropic.buildRequest({ slot: makeSlot({ protocol: 'anthropic_messages', baseUrl: 'https://x', maxOutputTokens: 0 }), brief: makeBrief() }),
      () => openai.buildRequest({ slot: makeSlot({ baseUrl: 'https://x' }), brief: {} }),
      () => openai.buildRequest({ slot: makeSlot({ baseUrl: 'https://x' }), brief: makeBrief(), signal: abortedSignal() }),
    ]
    for (const fn of cases) {
      assert.throws(fn, (error) => {
        assert.equal(error.name, 'ProtocolError')
        assert.equal(typeof error.code, 'string')
        // `category` is what the host layer forwards into SlotResultMeta.error.
        assert.ok(KNOWN.has(error.category), `preflight category ${error.category} (code ${error.code}) is not in CATEGORY`)
        return true
      })
    }
  })

  test('INVALID_BRIEF keeps its precise reason but exposes PROVIDER_ERROR as code', () => {
    try {
      openai.buildRequest({ slot: makeSlot({ baseUrl: 'https://x' }), brief: {} })
      assert.fail('expected a throw')
    } catch (error) {
      assert.equal(error.reason, 'INVALID_BRIEF')
      assert.equal(error.code, 'PROVIDER_ERROR')
      assert.equal(error.category, 'PROVIDER_ERROR')
    }
  })
})
