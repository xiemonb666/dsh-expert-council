/**
 * Reasoning-effort and output-budget tests.
 *
 * "Turn the expert models' thinking level all the way up and relax the output
 * limit" is a request about the actual wire request, so these tests assert the
 * request bodies the adapters build — not just that a config field exists.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeSlot, sanitizeSlotPatch, publicSlot, REASONING_EFFORTS } from '../../plugin/src/host/config.js'
import * as protocols from '../../plugin/src/host/protocols/index.js'

const BRIEF = {
  system: 'be precise',
  question: 'Is this consistent?',
  context: '',
  evidence: '',
  requestedOutput: 'verdict',
  mode: 'general',
  normalized: '## Central question\nIs this consistent?',
}

function slot(overrides = {}) {
  return normalizeSlot('L2', {
    enabled: true,
    protocol: 'openai_chat_completions',
    baseUrl: 'https://api.example.com/v1',
    modelId: 'model-x',
    credentialRef: 'K',
    maxOutputTokens: 8192,
    timeoutMs: 120000,
    retries: 0,
    ...overrides,
  })
}

function anthropicSlot(overrides = {}) {
  return normalizeSlot('L1', {
    enabled: true,
    protocol: 'anthropic_messages',
    baseUrl: 'https://api.anthropic.com/v1',
    modelId: 'claude-x',
    credentialRef: 'K',
    apiVersion: '2023-06-01',
    maxOutputTokens: 16384,
    timeoutMs: 120000,
    retries: 0,
    ...overrides,
  })
}

function bodyOf(config, apiKey = 'sk-test-0123456789') {
  const request = protocols.buildRequestForSlot({ slot: { ...config, apiKey }, brief: BRIEF, signal: null })
  return request.body
}

test('every effort level is accepted and normalized', () => {
  for (const effort of REASONING_EFFORTS) {
    const config = slot({ reasoningEffort: effort })
    assert.equal(config.reasoningEffort, effort)
    assert.deepEqual(config.warnings, [])
  }
})

test('an unknown effort is rejected with a warning, not silently stored', () => {
  const config = slot({ reasoningEffort: 'ludicrous' })
  assert.equal(config.reasoningEffort, null)
  assert.ok(config.warnings.some((warning) => warning.includes('reasoningEffort')))
})

test('omitting the effort leaves it null', () => {
  assert.equal(slot().reasoningEffort, null)
})

test('[OI] sends reasoning_effort verbatim when configured', () => {
  assert.equal(bodyOf(slot({ reasoningEffort: 'max' })).reasoning_effort, 'max')
  assert.equal(bodyOf(slot({ reasoningEffort: 'high' })).reasoning_effort, 'high')
})

test('[OI] omits reasoning_effort entirely when unset', () => {
  const body = bodyOf(slot())
  assert.equal('reasoning_effort' in body, false, 'an unset effort must not be sent')
})

test('[OI] keeps the configured output budget and the chosen token parameter', () => {
  const classic = bodyOf(slot({ maxOutputTokens: 65536 }))
  assert.equal(classic.max_tokens, 65536)
  assert.equal('max_completion_tokens' in classic, false)

  const modern = bodyOf(slot({ maxOutputTokens: 65536, maxTokensParam: 'max_completion_tokens' }))
  assert.equal(modern.max_completion_tokens, 65536)
  assert.equal('max_tokens' in modern, false, 'never send both token parameters')
})

test('the output budget clamp allows a very large limit', () => {
  // "Relax the output limit" must not be blocked by an over-tight clamp.
  const config = slot({ maxOutputTokens: 200000 })
  assert.equal(config.maxOutputTokens, 200000)
  assert.equal(bodyOf(config).max_tokens, 200000)
})

test('Anthropic enables extended thinking with a budget below max_tokens', () => {
  for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) {
    const config = anthropicSlot({ reasoningEffort: effort, maxOutputTokens: 16384 })
    const body = bodyOf(config)
    assert.equal(body.thinking.type, 'enabled', `effort ${effort} must enable thinking`)
    assert.ok(Number.isInteger(body.thinking.budget_tokens))
    assert.ok(body.thinking.budget_tokens >= 1024, 'Anthropic requires a minimum budget of 1024')
    assert.ok(body.thinking.budget_tokens < body.max_tokens, 'budget must stay below max_tokens')
  }
})

test('Anthropic effort ordering is monotonic', () => {
  const budget = (effort) => bodyOf(anthropicSlot({ reasoningEffort: effort, maxOutputTokens: 16384 })).thinking.budget_tokens
  assert.ok(budget('low') < budget('medium'))
  assert.ok(budget('medium') < budget('high'))
  assert.ok(budget('high') < budget('max'))
})

test('Anthropic drops temperature when thinking is enabled', () => {
  const body = bodyOf(anthropicSlot({ reasoningEffort: 'max', temperature: 0.2, maxOutputTokens: 16384 }))
  assert.equal(body.thinking.type, 'enabled')
  assert.equal('temperature' in body, false, 'Anthropic rejects temperature alongside thinking')

  const withoutThinking = bodyOf(anthropicSlot({ temperature: 0.2 }))
  assert.equal(withoutThinking.temperature, 0.2)
})

test('Anthropic skips thinking when the output budget is too small to fund it', () => {
  const body = bodyOf(anthropicSlot({ reasoningEffort: 'max', maxOutputTokens: 1024 }))
  assert.equal('thinking' in body, false, 'a budget that cannot fund thinking must not be sent')
})

test('Anthropic never invents a max_tokens and reports the capability gap', () => {
  const config = anthropicSlot({ maxOutputTokens: 1 })
  assert.doesNotThrow(() => bodyOf(config))
  // The adapter refuses a non-positive value; normalizeSlot clamps to >= 1, so
  // build a deliberately broken slot to prove the guard exists.
  const broken = { ...anthropicSlot(), maxOutputTokens: 0 }
  assert.throws(
    () => protocols.buildRequestForSlot({ slot: { ...broken, apiKey: 'k' }, brief: BRIEF, signal: null }),
    /maxOutputTokens/,
  )
})

test('reasoningEffort is writable through the settings API and never leaks a secret', () => {
  const patch = sanitizeSlotPatch({ reasoningEffort: 'max', maxOutputTokens: 65536 })
  assert.deepEqual(patch, { reasoningEffort: 'max', maxOutputTokens: 65536 })

  const rejected = sanitizeSlotPatch({ reasoningEffort: 'turbo' })
  assert.deepEqual(rejected, {}, 'an invalid effort must not reach the profile config')

  const projected = publicSlot(slot({ reasoningEffort: 'max' }), true)
  assert.equal(projected.reasoningEffort, 'max')
  assert.equal(JSON.stringify(projected).includes('sk-'), false)
})

test('the timeout clamp allows a long-running reasoning call', () => {
  const config = slot({ timeoutMs: 900000 })
  assert.equal(config.timeoutMs, 900000)
  assert.equal(slot({ timeoutMs: 9_999_999 }).timeoutMs, 900000, 'still capped at the documented maximum')
})

// --- explicit thinkingBudget ------------------------------------------------
//
// Some gateways (ai-pixel among them) ignore `reasoning_effort` on their
// Anthropic endpoint and only honor `thinking.budget_tokens`. A caller must
// therefore be able to state the budget directly, and that setting must win.

test('an explicit thinkingBudget overrides the effort-derived budget', () => {
  const byEffort = bodyOf(anthropicSlot({ reasoningEffort: 'low', maxOutputTokens: 32768 }))
  const explicit = bodyOf(anthropicSlot({ reasoningEffort: 'low', thinkingBudget: 24000, maxOutputTokens: 32768 }))
  assert.equal(explicit.thinking.budget_tokens, 24000)
  assert.notEqual(explicit.thinking.budget_tokens, byEffort.thinking.budget_tokens)
})

test('an explicit thinkingBudget works even with no effort set', () => {
  const body = bodyOf(anthropicSlot({ thinkingBudget: 16000, maxOutputTokens: 32768 }))
  assert.equal(body.thinking.type, 'enabled')
  assert.equal(body.thinking.budget_tokens, 16000)
})

test('an explicit thinkingBudget is clamped below max_tokens', () => {
  const body = bodyOf(anthropicSlot({ thinkingBudget: 999999, maxOutputTokens: 8192 }))
  assert.equal(body.thinking.budget_tokens, 8191, 'budget must stay strictly below max_tokens')
})

test('a thinkingBudget below the protocol minimum disables thinking instead of sending it', () => {
  const body = bodyOf(anthropicSlot({ thinkingBudget: 500, maxOutputTokens: 32768 }))
  assert.equal('thinking' in body, false, 'Anthropic rejects budgets under 1024')
})

test('thinkingBudget is writable through the settings API and projected to the page', () => {
  assert.deepEqual(sanitizeSlotPatch({ thinkingBudget: 20000 }), { thinkingBudget: 20000 })
  assert.deepEqual(sanitizeSlotPatch({ thinkingBudget: 'lots' }), {})
  assert.equal(publicSlot(anthropicSlot({ thinkingBudget: 20000 }), true).thinkingBudget, 20000)
})

test('thinkingBudget is not sent to the [OI] protocol at all', () => {
  // It is an Anthropic-only control; the OpenAI adapter has no place for it.
  const body = bodyOf(slot({ thinkingBudget: 20000 }))
  assert.equal('thinking' in body, false)
  assert.equal('thinkingBudget' in body, false)
})
