import test from 'node:test'
import assert from 'node:assert/strict'

import { redactText, redactBrief, checkPrivacyScope } from '../../plugin/src/host/redact.js'

test('API keys of both major families are redacted', () => {
  const text = 'key1=sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345 key2=sk-proj-abcdefghijklmnopqrstuvwxyz'
  const result = redactText(text)
  assert.equal(result.text.includes('sk-ant-api03'), false)
  assert.equal(result.text.includes('sk-proj'), false)
  assert.ok(result.redactions >= 2)
  assert.ok(result.appliedRules.includes('anthropic-key'))
})

test('PEM private key blocks are redacted whole', () => {
  const text = 'before\n-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----\nafter'
  const result = redactText(text)
  assert.equal(result.text.includes('MIIEow'), false)
  assert.ok(result.text.includes('before'))
  assert.ok(result.text.includes('after'))
})

test('bearer tokens, JWTs and URL userinfo are redacted', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
  const text = `Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456\njwt=${jwt}\nurl=https://admin:hunter2@internal.example/path`
  const result = redactText(text)
  assert.equal(result.text.includes('abcdefghijklmnopqrstuvwxyz123456'), false)
  assert.equal(result.text.includes(jwt), false)
  assert.equal(result.text.includes('hunter2'), false)
  assert.ok(result.text.includes('[REDACTED:userinfo]'))
})

test('assignment-style secrets keep the variable name for readability', () => {
  const text = 'OPENAI_API_KEY=supersecretvalue12345\npassword = "hunter2hunter2"\napi_key: abcdefghijklmnop'
  const result = redactText(text)
  assert.equal(result.text.includes('supersecretvalue12345'), false)
  assert.equal(result.text.includes('hunter2hunter2'), false)
  assert.ok(result.text.includes('OPENAI_API_KEY'))
  assert.ok(result.text.includes('password'))
})

test('a known credential literal is scrubbed even when it matches no pattern', () => {
  const secret = 'zzz-custom-credential-format-9999'
  const result = redactText(`here it is: ${secret} and again ${secret}`, { knownSecrets: [secret] })
  assert.equal(result.text.includes(secret), false)
  assert.ok(result.appliedRules.includes('known-credential'))
  assert.equal(result.redactions, 2)
})

test('redaction leaves ordinary technical text intact', () => {
  const text = 'E = mc^2 and sigma = F / A. The mesh has 1024 elements; check the eigenvalue lambda_3.'
  const result = redactText(text)
  assert.equal(result.text, text)
  assert.equal(result.redactions, 0)
  assert.equal(result.changed, false)
})

test('redaction can be disabled by policy, and reports that it did nothing', () => {
  const result = redactText('sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345', { enabled: false })
  assert.ok(result.text.includes('sk-ant-api03'))
  assert.deepEqual(result.appliedRules, [])
})

test('redactBrief reports byte accounting for the audit card', () => {
  const brief = {
    system: 'be precise',
    question: 'Is the formula correct? key sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345',
    context: 'context',
    evidence: '',
    requestedOutput: 'verdict',
  }
  const { brief: redacted, audit } = redactBrief(brief)
  assert.equal(redacted.question.includes('sk-ant'), false)
  assert.equal(redacted.evidence, undefined)
  assert.ok(audit.redactions >= 1)
  assert.ok(audit.originalBytes > audit.sentBytes)
  assert.equal(audit.truncated, false)
  assert.ok(audit.appliedRules.length >= 1)
})

test('privacy scope refuses whole-repository and whole-environment sharing by default', () => {
  for (const scope of ['entire repo', 'the whole workspace', '全部环境变量', 'process.env']) {
    const result = checkPrivacyScope(scope, { allowRepoScope: false })
    assert.equal(result.ok, false, `expected refusal for ${scope}`)
    assert.equal(result.category, 'DATA_APPROVAL_REQUIRED')
  }
})

test('privacy scope accepts a curated description, and the gate can be lifted explicitly', () => {
  assert.deepEqual(checkPrivacyScope('only src/solver.ts and the failing test', { allowRepoScope: false }), { ok: true })
  assert.deepEqual(checkPrivacyScope(undefined, {}), { ok: true })
  assert.deepEqual(checkPrivacyScope('entire repo', { allowRepoScope: true }), { ok: true })
  assert.equal(checkPrivacyScope(42, {}).ok, false)
})
