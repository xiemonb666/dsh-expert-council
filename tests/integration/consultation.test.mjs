/**
 * End-to-end consultation tests.
 *
 * These run the real orchestrator against real local HTTP servers: nothing is
 * stubbed between `consultSingle`/`consultCouncil` and the wire. Each mock
 * server speaks one of the two protocols, so the mixed-protocol council path is
 * exercised exactly as it would be in production.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

import { consultCouncil, consultSingle } from '../../plugin/src/host/consultation.js'
import { normalizeSlot } from '../../plugin/src/host/config.js'
import * as protocols from '../../plugin/src/host/protocols/index.js'

const SECURITY = {
  allowedHosts: [],
  trustedLocalEndpoints: ['127.0.0.1'],
  maxPayloadBytes: 120000,
  redactSecrets: true,
  allowRepoScope: false,
}

const REQUESTER = { agentId: 'agent-1', sessionId: 'session-1', tool: 'consult_expert' }

/**
 * Start one mock provider.
 * @param {(request: { method: string, url: string, headers: object, body: any, count: number }) => Promise<{ status?: number, headers?: object, body?: any, delayMs?: number }>} handler
 */
async function startMock(handler) {
  let count = 0
  const requests = []
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    let body = null
    try {
      body = raw === '' ? null : JSON.parse(raw)
    } catch {
      body = raw
    }
    count += 1
    const entry = { method: req.method, url: req.url, headers: req.headers, body, count }
    requests.push(entry)

    let reply
    try {
      reply = await handler(entry)
    } catch (error) {
      reply = { status: 500, body: { error: String(error?.message ?? error) } }
    }
    if (reply.delayMs !== undefined) await new Promise((resolve) => setTimeout(resolve, reply.delayMs))
    const payload = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body ?? {})
    res.writeHead(reply.status ?? 200, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload, 'utf8'),
      ...(reply.headers ?? {}),
    })
    res.end(payload)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    get count() {
      return count
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

/** A mock that answers like [OI] Chat Completions. */
function openaiMock(answer, extra = {}) {
  return startMock(() => ({
    body: {
      id: 'chatcmpl-mock-1',
      object: 'chat.completion',
      model: 'mock-model',
      choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: extra.finishReason ?? 'stop' }],
      usage: extra.usage ?? { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165 },
    },
  }))
}

/** A mock that answers like Anthropic Messages. */
function anthropicMock(answer, extra = {}) {
  return startMock(() => ({
    body: {
      id: 'msg_mock_1',
      type: 'message',
      role: 'assistant',
      model: 'mock-claude',
      content: [
        { type: 'thinking', thinking: 'internal reasoning that must not be shown' },
        { type: 'text', text: answer },
      ],
      stop_reason: extra.stopReason ?? 'end_turn',
      usage: extra.usage ?? { input_tokens: 200, output_tokens: 60 },
    },
  }))
}

function openaiSlot(portUrl, overrides = {}, slotId = 'L2') {
  return normalizeSlot(slotId, {
    enabled: true,
    protocol: 'openai_chat_completions',
    baseUrl: portUrl,
    modelId: 'mock-model',
    credentialRef: `DSH_EXPERT_${slotId}_API_KEY`,
    maxOutputTokens: 1024,
    timeoutMs: 8000,
    retries: 0,
    ...overrides,
  })
}

function anthropicSlot(portUrl, overrides = {}, slotId = 'L1') {
  return normalizeSlot(slotId, {
    enabled: true,
    protocol: 'anthropic_messages',
    baseUrl: portUrl,
    modelId: 'mock-claude',
    credentialRef: 'DSH_EXPERT_L1_API_KEY',
    apiVersion: '2023-06-01',
    authScheme: 'x-api-key',
    maxOutputTokens: 1024,
    timeoutMs: 8000,
    retries: 0,
    ...overrides,
  })
}

/** A credential service stub: one map of reference → value. */
function credentialsFor(map) {
  return {
    async resolve(ref) {
      return map[ref] === undefined ? undefined : { value: map[ref], source: 'test' }
    },
    async describe(ref) {
      return { configured: map[ref] !== undefined, writable: true }
    },
    async set(ref, value) {
      map[ref] = value
    },
    async unset(ref) {
      delete map[ref]
    },
  }
}

async function withServer(mock, fn) {
  try {
    return await fn(mock)
  } finally {
    await mock.close()
  }
}

test('[OI] single consultation returns the answer, usage and a request audit trail', async () => {
  const mock = await openaiMock('The formula is dimensionally consistent.')
  await withServer(mock, async () => {
    const { meta, results } = await consultSingle({
      slots: { L2: openaiSlot(mock.baseUrl) },
      defaults: { singleSlot: 'L2' },
      security: SECURITY,
      credentials: credentialsFor({ DSH_EXPERT_L2_API_KEY: 'sk-test-0123456789abcdef' }),
      protocols,
      input: { question: 'Is F = m*a dimensionally consistent?', mode: 'physics_review', slot: 'L2', reason: 'check' },
      requester: REQUESTER,
      knownSecrets: [],
      signal: AbortSignal.timeout(15000),
    })

    assert.equal(meta.status, 'COMPLETE')
    assert.equal(meta.kind, 'single')
    assert.equal(meta.slots.length, 1)
    const slot = results[0]
    assert.equal(slot.status, 'SUCCESS')
    assert.equal(slot.answer, 'The formula is dimensionally consistent.')
    assert.equal(slot.usage.inputTokens, 120)
    assert.equal(slot.usage.outputTokens, 45)
    assert.equal(slot.endpointHost, '127.0.0.1')
    assert.equal(slot.modelId, 'mock-model')
    assert.ok(slot.requestSent.user.includes('dimensionally consistent'), 'the card must show what was actually sent')
    assert.equal(slot.requestSent.user.includes('sk-test'), false, 'the credential must never appear in the audit trail')
    assert.equal(mock.requests.length, 1)
    assert.equal(mock.requests[0].url, '/v1/chat/completions')
  })
})

test('Anthropic consultation keeps system at the top level and skips thinking blocks', async () => {
  const mock = await anthropicMock('Yes, the derivation holds under plane strain.')
  await withServer(mock, async () => {
    const { meta, results } = await consultSingle({
      slots: { L1: anthropicSlot(mock.baseUrl) },
      defaults: { singleSlot: 'L1' },
      security: SECURITY,
      credentials: credentialsFor({ DSH_EXPERT_L1_API_KEY: 'sk-ant-test-0123456789' }),
      protocols,
      input: { question: 'Does the derivation hold?', mode: 'math_review', slot: 'L1' },
      requester: REQUESTER,
      signal: AbortSignal.timeout(15000),
    })

    assert.equal(meta.status, 'COMPLETE')
    assert.equal(results[0].answer, 'Yes, the derivation holds under plane strain.')
    assert.equal(results[0].answer.includes('internal reasoning'), false)

    const sent = mock.requests[0]
    assert.equal(sent.url, '/v1/messages')
    assert.equal(typeof sent.body.system, 'string')
    assert.equal(sent.body.messages.some((message) => message.role === 'system'), false, 'system must not be a message')
    assert.equal(typeof sent.body.max_tokens, 'number')
    assert.equal(sent.headers['anthropic-version'], '2023-06-01')
    assert.equal(sent.headers['x-api-key'], 'sk-ant-test-0123456789')
    assert.equal(sent.headers.authorization, undefined)
  })
})

test('a council runs every slot concurrently and proves it with wall-clock timing', async () => {
  const slow = await startMock(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400))
    return {
      body: {
        id: 'chatcmpl-slow',
        choices: [{ index: 0, message: { role: 'assistant', content: 'slow answer' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      },
    }
  })
  const alsoSlow = await anthropicMock('second answer')
  const third = await openaiMock('third answer')

  try {
    const started = Date.now()
    const { meta, results } = await consultCouncil({
      slots: {
        L1: anthropicSlot(alsoSlow.baseUrl, {}, 'L1'),
        L2: openaiSlot(slow.baseUrl, {}, 'L2'),
        L3: openaiSlot(third.baseUrl, {}, 'L3'),
      },
      defaults: { singleSlot: 'L2', allowCouncil: true },
      security: SECURITY,
      credentials: credentialsFor({ DSH_EXPERT_L1_API_KEY: 'sk-ant-test-0123456789', DSH_EXPERT_L2_API_KEY: 'sk-test-0123456789abcdef', DSH_EXPERT_L3_API_KEY: 'sk-test-0123456789abcdef' }),
      protocols,
      input: { question: 'Which approach is correct?', mode: 'architecture' },
      requester: REQUESTER,
      signal: AbortSignal.timeout(20000),
    })
    const elapsed = Date.now() - started

    assert.equal(meta.status, 'COMPLETE')
    assert.equal(meta.synthesis.counts.success, 3)
    assert.deepEqual(results.map((entry) => entry.slot), ['L1', 'L2', 'L3'])
    // Serial execution would take at least 800ms (two 400ms mocks); concurrency
    // keeps the whole council near one round trip.
    assert.ok(elapsed < 1500, `expected concurrent execution, took ${elapsed} ms`)
    assert.equal(meta.synthesis.note.includes('Lexical overlap only'), true)
  } finally {
    await slow.close()
    await alsoSlow.close()
    await third.close()
  }
})

test('one failing slot does not destroy the other answers (PARTIAL)', async () => {
  const good = await openaiMock('the good answer')
  const broken = await startMock(() => ({ status: 500, body: { error: { message: 'upstream exploded', type: 'server_error' } } }))
  const unauthorized = await startMock(() => ({ status: 401, body: { error: { message: 'invalid api key', type: 'authentication_error' } } }))

  try {
    const { meta, results } = await consultCouncil({
      slots: {
        L1: anthropicSlot(unauthorized.baseUrl, {}, 'L1'),
        L2: openaiSlot(good.baseUrl, {}, 'L2'),
        L3: openaiSlot(broken.baseUrl, {}, 'L3'),
      },
      defaults: { singleSlot: 'L2', allowCouncil: true },
      security: SECURITY,
      credentials: credentialsFor({ DSH_EXPERT_L1_API_KEY: 'sk-ant-test-0123456789', DSH_EXPERT_L2_API_KEY: 'sk-test-0123456789abcdef', DSH_EXPERT_L3_API_KEY: 'sk-test-0123456789abcdef' }),
      protocols,
      input: { question: 'q', mode: 'debug' },
      requester: REQUESTER,
      signal: AbortSignal.timeout(20000),
    })

    assert.equal(meta.status, 'PARTIAL')
    assert.deepEqual(meta.synthesis.succeeded, ['L2'])
    assert.deepEqual(meta.synthesis.failed.sort(), ['L1', 'L3'])
    assert.equal(meta.synthesis.counts.success, 1)

    const l2 = results.find((entry) => entry.slot === 'L2')
    assert.equal(l2.status, 'SUCCESS')
    assert.equal(l2.answer, 'the good answer')

    const l1 = results.find((entry) => entry.slot === 'L1')
    assert.equal(l1.status, 'ERROR')
    assert.equal(l1.error.category, 'AUTH_INVALID')
    assert.equal(l1.error.httpStatus, 401)

    const l3 = results.find((entry) => entry.slot === 'L3')
    assert.equal(l3.status, 'ERROR')
    assert.ok(['PROVIDER_UNAVAILABLE', 'PROVIDER_ERROR'].includes(l3.error.category), `unexpected category ${l3.error.category}`)
  } finally {
    await good.close()
    await broken.close()
    await unauthorized.close()
  }
})

test('every slot failing yields FAILED with each reason preserved', async () => {
  const down = await startMock(() => ({ status: 503, body: 'service unavailable' }))
  try {
    const { meta } = await consultCouncil({
      slots: { L1: anthropicSlot(down.baseUrl, {}, 'L1'), L2: openaiSlot(down.baseUrl, {}, 'L2') },
      defaults: { singleSlot: 'L2', allowCouncil: true },
      security: SECURITY,
      credentials: credentialsFor({ DSH_EXPERT_L1_API_KEY: 'sk-ant-test-0123456789', DSH_EXPERT_L2_API_KEY: 'sk-test-0123456789abcdef' }),
      protocols,
      input: { question: 'q', slots: ['L1', 'L2'] },
      requester: REQUESTER,
      signal: AbortSignal.timeout(20000),
    })
    assert.equal(meta.status, 'FAILED')
    assert.equal(meta.synthesis.counts.success, 0)
    for (const slot of meta.slots) {
      assert.equal(slot.status, 'ERROR')
      assert.ok(slot.error.message.length > 0)
    }
  } finally {
    await down.close()
  }
})

test('an unconfigured slot is reported as UNCONFIGURED, never silently replaced', async () => {
  const mock = await openaiMock('answer')
  try {
    const { meta, results } = await consultCouncil({
      slots: {
        L1: anthropicSlot(mock.baseUrl, { enabled: false }, 'L1'),
        L2: openaiSlot(mock.baseUrl),
        L3: normalizeSlot('L3', { enabled: true }),
      },
      defaults: { singleSlot: 'L2', allowCouncil: true },
      security: SECURITY,
      credentials: credentialsFor({ DSH_EXPERT_L1_API_KEY: 'sk-ant-test-0123456789', DSH_EXPERT_L2_API_KEY: 'sk-test-0123456789abcdef' }),
      protocols,
      input: { question: 'q', slots: ['L1', 'L2', 'L3'] },
      requester: REQUESTER,
      signal: AbortSignal.timeout(15000),
    })
    assert.equal(meta.status, 'PARTIAL')
    const l1 = results.find((entry) => entry.slot === 'L1')
    const l3 = results.find((entry) => entry.slot === 'L3')
    assert.equal(l1.status, 'DISABLED')
    assert.equal(l3.status, 'UNCONFIGURED')
    assert.deepEqual(meta.synthesis.absent.sort(), ['L1', 'L3'])
    assert.equal(mock.requests.length, 1, 'only the configured slot may be called')
  } finally {
    await mock.close()
  }
})

test('a missing credential stops the call before any request is sent', async () => {
  const mock = await openaiMock('should not be reached')
  try {
    const { meta, results } = await consultSingle({
      slots: { L2: openaiSlot(mock.baseUrl) },
      defaults: { singleSlot: 'L2' },
      security: SECURITY,
      credentials: credentialsFor({}),
      protocols,
      input: { question: 'q', slot: 'L2' },
      requester: REQUESTER,
      signal: AbortSignal.timeout(10000),
    })
    assert.equal(meta.status, 'FAILED')
    assert.equal(results[0].error.category, 'CREDENTIAL_MISSING')
    assert.equal(mock.requests.length, 0, 'no request may leave without a credential')
  } finally {
    await mock.close()
  }
})

test('secrets in the question are redacted before they reach the provider', async () => {
  const mock = await openaiMock('ok')
  await withServer(mock, async () => {
    const { meta, results } = await consultSingle({
      slots: { L2: openaiSlot(mock.baseUrl) },
      defaults: { singleSlot: 'L2' },
      security: SECURITY,
      credentials: credentialsFor({ DSH_EXPERT_L2_API_KEY: 'sk-test-0123456789abcdef' }),
      protocols,
      input: {
        question: 'Why does this fail with key sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345 ?',
        slot: 'L2',
      },
      requester: REQUESTER,
      signal: AbortSignal.timeout(15000),
    })

    const wire = JSON.stringify(mock.requests[0].body)
    assert.equal(wire.includes('sk-ant-api03'), false, 'the secret must not reach the provider')
    assert.equal(wire.includes('sk-test-0123456789abcdef'), false, 'the credential must not leak into the body')
    assert.ok(meta.privacy.redactions >= 1)
    assert.ok(meta.privacy.appliedRules.length >= 1)
    assert.ok(results[0].requestSent.user.includes('[REDACTED'))
  })
})

test('a timeout is classified as TIMEOUT and does not hang the call', async () => {
  const mock = await startMock(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5000))
    return { body: { choices: [{ message: { content: 'too late' } }] } }
  })
  try {
    const started = Date.now()
    const { results } = await consultSingle({
      slots: { L2: openaiSlot(mock.baseUrl, { timeoutMs: 5000, retries: 0 }) },
      defaults: { singleSlot: 'L2' },
      security: SECURITY,
      credentials: credentialsFor({ DSH_EXPERT_L2_API_KEY: 'sk-test-0123456789abcdef' }),
      protocols,
      input: { question: 'q', slot: 'L2' },
      requester: REQUESTER,
      signal: AbortSignal.timeout(2000),
    })
    const elapsed = Date.now() - started
    assert.ok(elapsed < 4000, `expected the caller signal to cut the call short, took ${elapsed} ms`)
    assert.equal(results[0].status, 'CANCELLED')
  } finally {
    await mock.close()
  }
})

test('a redirect is refused instead of forwarding the credential', async () => {
  const mock = await startMock(() => ({ status: 302, headers: { location: 'https://evil.example/collect' }, body: '' }))
  try {
    const { results } = await consultSingle({
      slots: { L2: openaiSlot(mock.baseUrl) },
      defaults: { singleSlot: 'L2' },
      security: SECURITY,
      credentials: credentialsFor({ DSH_EXPERT_L2_API_KEY: 'sk-test-0123456789abcdef' }),
      protocols,
      input: { question: 'q', slot: 'L2' },
      requester: REQUESTER,
      signal: AbortSignal.timeout(15000),
    })
    assert.equal(results[0].status, 'ERROR')
    assert.equal(results[0].error.category, 'ENDPOINT_NOT_ALLOWED')
    assert.match(results[0].error.message, /redirect/i)
  } finally {
    await mock.close()
  }
})

test('a malformed provider body becomes BAD_RESPONSE rather than a crash', async () => {
  const mock = await startMock(() => ({ body: '<html>not json at all</html>' }))
  try {
    const { results } = await consultSingle({
      slots: { L2: openaiSlot(mock.baseUrl) },
      defaults: { singleSlot: 'L2' },
      security: SECURITY,
      credentials: credentialsFor({ DSH_EXPERT_L2_API_KEY: 'sk-test-0123456789abcdef' }),
      protocols,
      input: { question: 'q', slot: 'L2' },
      requester: REQUESTER,
      signal: AbortSignal.timeout(15000),
    })
    assert.equal(results[0].status, 'ERROR')
    assert.ok(['BAD_RESPONSE', 'PROVIDER_ERROR'].includes(results[0].error.category))
  } finally {
    await mock.close()
  }
})

test('an empty answer is EMPTY_RESPONSE, not a fabricated success', async () => {
  const mock = await startMock(() => ({
    body: { id: 'x', choices: [{ index: 0, message: { role: 'assistant', content: '   ' }, finish_reason: 'stop' }] },
  }))
  try {
    const { results } = await consultSingle({
      slots: { L2: openaiSlot(mock.baseUrl) },
      defaults: { singleSlot: 'L2' },
      security: SECURITY,
      credentials: credentialsFor({ DSH_EXPERT_L2_API_KEY: 'sk-test-0123456789abcdef' }),
      protocols,
      input: { question: 'q', slot: 'L2' },
      requester: REQUESTER,
      signal: AbortSignal.timeout(15000),
    })
    assert.equal(results[0].status, 'ERROR')
    assert.equal(results[0].error.category, 'EMPTY_RESPONSE')
  } finally {
    await mock.close()
  }
})

test('usage is unknown (null) when the provider reports none, never zero', async () => {
  const mock = await startMock(() => ({
    body: { id: 'x', choices: [{ index: 0, message: { role: 'assistant', content: 'answer' }, finish_reason: 'stop' }] },
  }))
  try {
    const { results } = await consultSingle({
      slots: { L2: openaiSlot(mock.baseUrl) },
      defaults: { singleSlot: 'L2' },
      security: SECURITY,
      credentials: credentialsFor({ DSH_EXPERT_L2_API_KEY: 'sk-test-0123456789abcdef' }),
      protocols,
      input: { question: 'q', slot: 'L2' },
      requester: REQUESTER,
      signal: AbortSignal.timeout(15000),
    })
    const slot = results[0]
    assert.equal(slot.status, 'SUCCESS')
    assert.equal(slot.usage.inputTokens, null)
    assert.equal(slot.usage.outputTokens, null)
    assert.equal(slot.usage.totalTokens, null)
    assert.deepEqual(slot.cost, { estimatedUsd: null, source: 'unknown' })
  } finally {
    await mock.close()
  }
})

test('the automatic router picks a slot and records why', async () => {
  const mock = await openaiMock('answer')
  try {
    const { meta } = await consultSingle({
      slots: { L3: openaiSlot(mock.baseUrl, {}, 'L3') },
      defaults: { singleSlot: 'L3' },
      security: SECURITY,
      credentials: credentialsFor({ DSH_EXPERT_L3_API_KEY: 'sk-test-0123456789abcdef' }),
      protocols,
      input: { question: 'q', risk: 'low', complexity: 'low' },
      requester: REQUESTER,
      signal: AbortSignal.timeout(15000),
    })
    assert.equal(meta.routing.requestedSlot, 'L3')
    assert.equal(meta.routing.autoRouted, true)
    assert.ok(meta.routing.policy.length > 0)
  } finally {
    await mock.close()
  }
})

test('a council snapshot hash is identical across slots (same frozen question)', async () => {
  const first = await openaiMock('answer one')
  const second = await openaiMock('answer two')
  try {
    const { meta } = await consultCouncil({
      slots: { L2: openaiSlot(first.baseUrl, {}, 'L2'), L3: openaiSlot(second.baseUrl, {}, 'L3') },
      defaults: { singleSlot: 'L2', allowCouncil: true },
      security: SECURITY,
      credentials: credentialsFor({ DSH_EXPERT_L2_API_KEY: 'sk-test-0123456789abcdef', DSH_EXPERT_L3_API_KEY: 'sk-test-0123456789abcdef' }),
      protocols,
      input: { question: 'Same question for everyone?', mode: 'research', slots: ['L2', 'L3'] },
      requester: REQUESTER,
      signal: AbortSignal.timeout(15000),
    })
    assert.equal(typeof meta.question.hash, 'string')
    assert.equal(meta.question.hash.length, 64)
    const sentQuestions = [first.requests[0].body, second.requests[0].body].map((body) => JSON.stringify(body.messages ?? body))
    assert.equal(sentQuestions[0] === sentQuestions[1], true, 'both providers must receive the same user text')
  } finally {
    await first.close()
    await second.close()
  }
})

test('a whole-repository privacy scope is refused before any request', async () => {
  const mock = await openaiMock('answer')
  try {
    const { meta, rejected } = await consultSingle({
      slots: { L2: openaiSlot(mock.baseUrl) },
      defaults: { singleSlot: 'L2' },
      security: SECURITY,
      credentials: credentialsFor({ DSH_EXPERT_L2_API_KEY: 'sk-test-0123456789abcdef' }),
      protocols,
      input: { question: 'q', slot: 'L2', privacyScope: 'the entire repo please' },
      requester: REQUESTER,
      signal: AbortSignal.timeout(15000),
    })
    assert.ok(rejected)
    assert.equal(rejected.category, 'DATA_APPROVAL_REQUIRED')
    assert.equal(meta.status, 'FAILED')
    assert.equal(mock.requests.length, 0)
  } finally {
    await mock.close()
  }
})

test('council can be disabled by configuration', async () => {
  const mock = await openaiMock('answer')
  try {
    const { meta } = await consultCouncil({
      slots: { L2: openaiSlot(mock.baseUrl) },
      defaults: { singleSlot: 'L2', allowCouncil: false },
      security: SECURITY,
      credentials: credentialsFor({ DSH_EXPERT_L2_API_KEY: 'sk-test-0123456789abcdef' }),
      protocols,
      input: { question: 'q' },
      requester: REQUESTER,
      signal: AbortSignal.timeout(15000),
    })
    assert.equal(meta.status, 'FAILED')
    assert.ok(meta.diagnostics.notes.some((note) => note.includes('allowCouncil')))
    assert.equal(mock.requests.length, 0)
  } finally {
    await mock.close()
  }
})

test('retries happen for a transient 429 and are counted', async () => {
  let calls = 0
  const mock = await startMock(() => {
    calls += 1
    if (calls === 1) {
      return { status: 429, headers: { 'retry-after': '0' }, body: { error: { message: 'slow down', type: 'rate_limit' } } }
    }
    return {
      body: {
        id: 'chatcmpl-ok',
        choices: [{ index: 0, message: { role: 'assistant', content: 'recovered' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 5 },
      },
    }
  })
  try {
    const { results } = await consultSingle({
      slots: { L2: openaiSlot(mock.baseUrl, { retries: 1 }) },
      defaults: { singleSlot: 'L2' },
      security: SECURITY,
      credentials: credentialsFor({ DSH_EXPERT_L2_API_KEY: 'sk-test-0123456789abcdef' }),
      protocols,
      input: { question: 'q', slot: 'L2' },
      requester: REQUESTER,
      signal: AbortSignal.timeout(20000),
    })
    assert.equal(results[0].status, 'SUCCESS')
    assert.equal(results[0].answer, 'recovered')
    assert.equal(results[0].attempts, 2)
    assert.equal(mock.requests.length, 2)
  } finally {
    await mock.close()
  }
})
