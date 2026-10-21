import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeConfig, normalizeSlot, sanitizeSlotPatch, slotReadiness, publicSlot, SLOT_IDS } from '../../plugin/src/host/config.js'

test('normalizeConfig fills every slot with defined types', () => {
  const config = normalizeConfig(undefined)
  for (const slotId of SLOT_IDS) {
    const slot = config.slots[slotId]
    assert.equal(slot.slot, slotId)
    assert.equal(typeof slot.enabled, 'boolean')
    assert.equal(typeof slot.protocol, 'string')
    assert.equal(typeof slot.baseUrl, 'string')
    assert.equal(typeof slot.modelId, 'string')
    assert.equal(typeof slot.credentialRef, 'string')
    assert.equal(typeof slot.maxOutputTokens, 'number')
    assert.equal(typeof slot.timeoutMs, 'number')
    assert.equal(typeof slot.retries, 'number')
    assert.equal(slot.temperature, null)
    assert.equal(slot.configured, false)
  }
})

test('normalizeConfig defaults are sane', () => {
  const config = normalizeConfig({})
  assert.equal(config.defaults.singleSlot, 'L2')
  assert.equal(config.defaults.allowCouncil, true)
  assert.equal(config.defaults.maxCostUsdPerCall, null)
  assert.equal(config.security.redactSecrets, true)
  assert.equal(config.security.allowRepoScope, false)
  assert.equal(config.security.maxPayloadBytes, 120000)
})

test('normalizeConfig never throws on hostile input', () => {
  for (const hostile of [null, 42, 'text', [], { slots: 'nope' }, { slots: { L1: [] } }, { defaults: 3 }, { security: 'x' }]) {
    const config = normalizeConfig(hostile)
    assert.ok(config.slots.L1)
    assert.ok(config.security)
  }
})

test('an unknown protocol is replaced and reported', () => {
  const slot = normalizeSlot('L1', { protocol: 'grpc_whatever', baseUrl: 'https://api.example.com', modelId: 'm', enabled: true })
  assert.equal(slot.protocol, 'anthropic_messages')
  assert.ok(slot.warnings.some((warning) => warning.includes('unknown protocol')))
})

test('enabled but incomplete slot is not configured and says what is missing', () => {
  const slot = normalizeSlot('L2', { enabled: true, baseUrl: 'https://api.example.com' })
  assert.equal(slot.configured, false)
  assert.ok(slot.warnings.some((warning) => warning.includes('modelId')))
})

test('numeric clamping keeps hostile values inside the accepted range', () => {
  const slot = normalizeSlot('L3', { maxOutputTokens: -5, timeoutMs: 1, retries: 99 })
  assert.ok(slot.maxOutputTokens >= 1)
  assert.ok(slot.timeoutMs >= 5000)
  assert.equal(slot.retries, 5)
})

test('maxTokensParam defaults to max_tokens and accepts max_completion_tokens', () => {
  assert.equal(normalizeSlot('L1', {}).maxTokensParam, 'max_tokens')
  assert.equal(normalizeSlot('L1', { maxTokensParam: 'max_completion_tokens' }).maxTokensParam, 'max_completion_tokens')
  assert.equal(normalizeSlot('L1', { maxTokensParam: 'nonsense' }).maxTokensParam, 'max_tokens')
})

test('slotReadiness distinguishes disabled, unconfigured and missing credential', () => {
  assert.equal(slotReadiness(normalizeSlot('L1', {}), false).category, 'SLOT_DISABLED')

  const incomplete = normalizeSlot('L1', { enabled: true, modelId: 'm' })
  assert.equal(slotReadiness(incomplete, true).category, 'SLOT_UNCONFIGURED')

  const complete = normalizeSlot('L1', { enabled: true, baseUrl: 'https://x.example', modelId: 'm', credentialRef: 'K' })
  assert.equal(slotReadiness(complete, false).category, 'CREDENTIAL_MISSING')
  assert.deepEqual(slotReadiness(complete, true), { ok: true })
})

test('sanitizeSlotPatch drops unknown and wrongly typed fields', () => {
  const patch = sanitizeSlotPatch({
    enabled: true,
    protocol: 'anthropic_messages',
    baseUrl: 'https://api.example.com',
    modelId: 'claude-x',
    maxOutputTokens: 4096,
    temperature: 0.2,
    retries: 2,
    authScheme: 'x-api-key',
    evilField: 'drop me',
    protocolInjection: { nested: true },
    displayName: 42,
    timeoutMs: 'soon',
  })
  assert.deepEqual(patch, {
    enabled: true,
    protocol: 'anthropic_messages',
    baseUrl: 'https://api.example.com',
    modelId: 'claude-x',
    maxOutputTokens: 4096,
    temperature: 0.2,
    retries: 2,
    authScheme: 'x-api-key',
  })
  assert.equal('evilField' in patch, false)
  assert.equal('displayName' in patch, false)
  assert.equal('timeoutMs' in patch, false)
})

test('sanitizeSlotPatch rejects an invalid protocol rather than storing it', () => {
  const patch = sanitizeSlotPatch({ protocol: 'ftp' })
  assert.deepEqual(patch, {})
})

test('publicSlot never exposes a credential value', () => {
  const slot = normalizeSlot('L1', { enabled: true, baseUrl: 'https://x.example', modelId: 'm', credentialRef: 'DSH_EXPERT_L1_API_KEY' })
  const projected = publicSlot(slot, true)
  assert.equal(projected.credentialConfigured, true)
  assert.equal(JSON.stringify(projected).includes('sk-'), false)
  assert.equal('apiKey' in projected, false)
})

test('a long baseUrl with credentials is preserved verbatim for the endpoint policy to reject', () => {
  const slot = normalizeSlot('L2', { baseUrl: 'https://user:pass@api.example.com/v1' })
  assert.equal(slot.baseUrl, 'https://user:pass@api.example.com/v1')
})
