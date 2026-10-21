// Protocol registry (plugin/src/host/protocols/index.js): exports, dispatch by
// slot.protocol, capability table and the no-bare-import rule.

import assert from 'node:assert/strict'
import { test, describe } from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as registry from '../../plugin/src/host/protocols/index.js'
import * as openai from '../../plugin/src/host/protocols/openai-chat-completions.js'
import * as anthropic from '../../plugin/src/host/protocols/anthropic-messages.js'
import { makeSlot, makeBrief } from './helpers.js'

const PROTOCOL_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'plugin',
  'src',
  'host',
  'protocols',
)

describe('registry surface', () => {
  test('exposes both protocols with their ids and labels', () => {
    assert.deepEqual(registry.listProtocolIds().sort(), ['anthropic_messages', 'openai_chat_completions'])
    assert.equal(registry.getProtocol('openai_chat_completions').id, 'openai_chat_completions')
    assert.equal(registry.getProtocol('anthropic_messages').id, 'anthropic_messages')
    assert.equal(openai.id, 'openai_chat_completions')
    assert.equal(anthropic.id, 'anthropic_messages')
    assert.equal(typeof openai.label, 'string')
    assert.ok(openai.label.length > 0)
    assert.equal(typeof anthropic.label, 'string')
    assert.ok(anthropic.label.length > 0)
  })

  test('every adapter exports the contract §2 surface', () => {
    for (const adapter of [openai, anthropic]) {
      assert.equal(typeof adapter.normalizeBaseUrl, 'function')
      assert.equal(typeof adapter.buildRequest, 'function')
      assert.equal(typeof adapter.parseResponse, 'function')
      assert.equal(typeof adapter.parseError, 'function')
      assert.equal(typeof adapter.isRetryable, 'function')
      assert.equal(typeof adapter.capabilities, 'object')
    }
  })

  test('capabilities are honest about the non-streaming first release', () => {
    for (const adapter of [openai, anthropic]) {
      assert.deepEqual({ ...adapter.capabilities }, {
        nonStream: true,
        streaming: false,
        systemPrompt: true,
        usage: 'optional',
        tools: false,
        reasoning: 'optional',
      })
      assert.equal(adapter.capabilities.nonStream, true)
      assert.equal(adapter.capabilities.streaming, false)
      assert.equal(adapter.capabilities.tools, false)
    }
    assert.deepEqual(registry.listProtocols(), [
      { id: 'openai_chat_completions', label: openai.label, capabilities: { ...openai.capabilities } },
      { id: 'anthropic_messages', label: anthropic.label, capabilities: { ...anthropic.capabilities } },
    ])
  })

  test('capabilitiesOf returns a copy and null for unknown ids', () => {
    const caps = registry.capabilitiesOf('anthropic_messages')
    assert.deepEqual(caps, { ...anthropic.capabilities })
    caps.nonStream = false
    assert.equal(anthropic.capabilities.nonStream, true, 'capabilities must be immutable from outside')
    assert.equal(registry.capabilitiesOf('nope'), null)
  })

  test('an unknown protocol id is rejected with an ErrorCategory-safe error', () => {
    assert.equal(registry.hasProtocol('nope'), false)
    assert.equal(registry.hasProtocol(undefined), false)
    assert.throws(() => registry.getProtocol('nope'), (error) => {
      assert.equal(error.name, 'ProtocolError')
      assert.equal(error.reason, 'UNKNOWN_PROTOCOL')
      assert.equal(error.code, 'CAPABILITY_UNSUPPORTED')
      return true
    })
  })
})

describe('slot dispatch', () => {
  test('buildRequestForSlot dispatches on slot.protocol', () => {
    const oi = registry.buildRequestForSlot({ slot: makeSlot({ baseUrl: 'https://x/v1' }), brief: makeBrief() })
    assert.equal(oi.url, 'https://x/v1/chat/completions')
    assert.equal(oi.headers.authorization.startsWith('Bearer '), true)

    const an = registry.buildRequestForSlot({
      slot: makeSlot({ protocol: 'anthropic_messages', authScheme: 'x-api-key', baseUrl: 'https://api.anthropic.com' }),
      brief: makeBrief(),
    })
    assert.equal(an.url, 'https://api.anthropic.com/v1/messages')
    assert.equal(typeof an.headers['anthropic-version'], 'string')
    assert.equal(an.headers.authorization, undefined)
  })

  test('parseResponseForSlot dispatches on slot.protocol', () => {
    const oi = registry.parseResponseForSlot({
      slot: makeSlot({ baseUrl: 'https://x' }),
      text: JSON.stringify({ choices: [{ message: { content: 'oi answer' }, finish_reason: 'stop' }] }),
    })
    assert.equal(oi.answer, 'oi answer')

    const an = registry.parseResponseForSlot({
      slot: makeSlot({ protocol: 'anthropic_messages', baseUrl: 'https://x' }),
      text: JSON.stringify({ content: [{ type: 'text', text: 'an answer' }], stop_reason: 'end_turn' }),
    })
    assert.equal(an.answer, 'an answer')
  })

  test('parseErrorForSlot dispatches on slot.protocol', () => {
    const oi = registry.parseErrorForSlot({ slot: makeSlot({ baseUrl: 'https://x' }), status: 429, text: '' })
    assert.equal(oi.category, 'RATE_LIMITED')
    const an = registry.parseErrorForSlot({
      slot: makeSlot({ protocol: 'anthropic_messages', baseUrl: 'https://x' }),
      status: 401,
      text: '',
    })
    assert.equal(an.category, 'AUTH_INVALID')
  })

  test('a slot without a protocol is SLOT_UNCONFIGURED', () => {
    assert.throws(
      () => registry.buildRequestForSlot({ slot: makeSlot({ protocol: '' }), brief: makeBrief() }),
      (error) => error.code === 'SLOT_UNCONFIGURED',
    )
  })

  test('a slot with an unregistered protocol is CAPABILITY_UNSUPPORTED', () => {
    assert.throws(
      () => registry.buildRequestForSlot({ slot: makeSlot({ protocol: 'cohere_chat' }), brief: makeBrief() }),
      (error) => error.code === 'CAPABILITY_UNSUPPORTED',
    )
  })

  test('a missing slot is SLOT_UNCONFIGURED', () => {
    assert.throws(() => registry.buildRequestForSlot({ brief: makeBrief() }), (error) => error.code === 'SLOT_UNCONFIGURED')
  })
})

describe('packaging constraints', () => {
  test('protocol sources only import node: built-ins or relative paths', async () => {
    const files = (await readdir(PROTOCOL_DIR)).filter((name) => name.endsWith('.js'))
    assert.ok(files.includes('index.js'))
    const offenders = []
    for (const file of files) {
      const source = await readFile(path.join(PROTOCOL_DIR, file), 'utf8')
      for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)[^;\n]*?from\s+['"]([^'"]+)['"]/g)) {
        const specifier = match[1]
        const allowed = specifier.startsWith('node:') || (specifier.startsWith('./') && specifier.endsWith('.js'))
        if (!allowed) offenders.push(`${file}: ${specifier}`)
      }
      for (const match of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const specifier = match[1]
        const allowed = specifier.startsWith('node:') || (specifier.startsWith('./') && specifier.endsWith('.js'))
        if (!allowed) offenders.push(`${file}: dynamic ${specifier}`)
      }
    }
    assert.deepEqual(offenders, [], `bare imports are forbidden (ERR_MODULE_NOT_FOUND): ${offenders.join(', ')}`)
  })

  test('protocol sources use no require(), no CommonJS and no third-party deps', async () => {
    const files = (await readdir(PROTOCOL_DIR)).filter((name) => name.endsWith('.js'))
    for (const file of files) {
      const source = await readFile(path.join(PROTOCOL_DIR, file), 'utf8')
      assert.equal(/\brequire\s*\(/.test(source), false, `${file} must not use require()`)
      assert.equal(/module\.exports|exports\.\w+\s*=/.test(source), false, `${file} must stay ESM`)
    }
  })

  test('the protocol modules are importable as pure ESM namespaces', () => {
    assert.equal(Object.prototype.toString.call(registry.protocols), '[object Object]')
    assert.equal(Object.isFrozen(registry.protocols), true)
    assert.equal(registry.default, registry.protocols)
  })
})
