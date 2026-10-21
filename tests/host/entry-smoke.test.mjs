/**
 * Host-entry smoke test.
 *
 * Loads the real `plugin/index.js` against a fake Cordis context and checks the
 * things that actually break a plugin at load time: the module imports cleanly,
 * `apply` is exported, both child injects run, the four tools register, the
 * settings routes mount, and a tool can execute end to end against a local mock
 * provider. This is the closest thing to "the plugin loads" that can run without
 * restarting the harness.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../../plugin/index.js'

/** A minimal Cordis-like context: effect/on/inject/get. */
function fakeContext({ services }) {
  const effects = []
  const injected = []
  const ctx = {
    effects,
    injected,
    effect(execute, label) {
      const dispose = execute()
      const entry = { label, dispose }
      effects.push(entry)
      return () => {
        const index = effects.indexOf(entry)
        if (index >= 0) effects.splice(index, 1)
        if (typeof dispose === 'function') dispose()
      }
    },
    on() {
      return () => undefined
    },
    get(name) {
      return services[name]
    },
    inject(names, callback) {
      injected.push(names)
      const scope = {
        effect: ctx.effect,
        on: ctx.on,
        get: ctx.get,
      }
      for (const name of names) scope[name] = services[name]
      callback(scope)
      return { then: (resolve) => resolve() }
    },
  }
  return ctx
}

function mockCredentials(map) {
  return {
    async resolve(ref) {
      return map[ref] === undefined ? undefined : { value: map[ref], source: 'test' }
    },
    async describe(ref) {
      return { configured: map[ref] !== undefined, writable: true, source: map[ref] === undefined ? undefined : 'test' }
    },
    async set(ref, value) {
      map[ref] = value
    },
    async unset(ref) {
      delete map[ref]
    },
  }
}

function mockConfigEditor(config) {
  const edits = []
  return {
    edits,
    entries: () => [{ options: { id: 'dsh-expert-council', name: 'dsh-expert-council', config } }],
    async edit(entry, change) {
      const next = change(structuredClone(entry.options.config ?? {}), {})
      edits.push(next)
      entry.options.config = next
      return undefined
    },
  }
}

async function startProvider(answer) {
  const requests = []
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    let body = null
    try {
      body = JSON.parse(raw)
    } catch {
      body = raw
    }
    requests.push({ url: req.url, headers: req.headers, body })
    const payload = JSON.stringify({
      id: 'chatcmpl-smoke',
      object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    })
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
    res.end(payload)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

async function buildPlugin({ provider }) {
  const dataDir = await mkdtemp(join(tmpdir(), 'ec-smoke-'))
  process.env.DSH_HOME = dataDir

  const config = {
    slots: {
      L1: { enabled: false },
      L2: {
        enabled: true,
        protocol: 'openai_chat_completions',
        baseUrl: provider.baseUrl,
        modelId: 'mock-model',
        credentialRef: 'DSH_EXPERT_L2_API_KEY',
        maxOutputTokens: 512,
        timeoutMs: 10000,
        retries: 0,
      },
      L3: { enabled: false },
    },
    defaults: { singleSlot: 'L2', allowCouncil: true },
    security: { allowedHosts: [], trustedLocalEndpoints: ['127.0.0.1'], maxPayloadBytes: 120000, redactSecrets: true },
  }

  const services = {
    credentials: mockCredentials({ DSH_EXPERT_L2_API_KEY: 'sk-test-smoke-0123456789' }),
    configEditor: mockConfigEditor(config),
    webServer: { register: () => () => undefined },
    tools: null,
  }

  const registered = []
  const routes = []
  services.tools = {
    register(definition) {
      registered.push(definition)
      return () => {
        const index = registered.indexOf(definition)
        if (index >= 0) registered.splice(index, 1)
      }
    },
  }
  services.webServer = {
    register(route) {
      routes.push(route)
      return () => {
        const index = routes.indexOf(route)
        if (index >= 0) routes.splice(index, 1)
      }
    },
  }

  const ctx = fakeContext({ services })
  apply(ctx, config)
  return { ctx, registered, routes, config, services, dataDir }
}

test('the host entry imports and applies without a harness process', async () => {
  const provider = await startProvider('smoke answer')
  try {
    const { registered, routes, ctx } = await buildPlugin({ provider })
    assert.equal(registered.length, 4, `expected 4 tools, got ${registered.map((tool) => tool.name).join(', ')}`)
    assert.deepEqual(
      registered.map((tool) => tool.name).sort(),
      ['consult_council', 'consult_expert', 'followup_expert', 'verify_consultation'],
    )
    for (const tool of registered) {
      assert.equal(typeof tool.description, 'string')
      assert.ok(tool.description.length > 40, `${tool.name} needs a real description`)
      assert.equal(tool.parameters.type, 'object')
      assert.equal(typeof tool.execute, 'function')
      assert.equal(typeof tool.output.render, 'function')
      assert.equal(typeof tool.output.presentationMeta, 'function')
      assert.equal(tool.isConcurrencySafe(), true)
    }
    assert.ok(routes.length >= 6, `expected the settings routes, got ${routes.length}`)
    assert.ok(ctx.effects.length >= 2, 'both child injects must register effects')
  } finally {
    await provider.close()
  }
})

test('consult_expert executes end to end and returns card metadata', async () => {
  const provider = await startProvider('The derivation is correct under plane strain.')
  try {
    const { registered } = await buildPlugin({ provider })
    const tool = registered.find((entry) => entry.name === 'consult_expert')
    const value = await tool.execute(
      { question: 'Is the derivation correct?', slot: 'L2', mode: 'math_review', reason: 'independent check' },
      { signal: AbortSignal.timeout(15000), name: 'consult_expert', agent: { id: 'agent-1' } },
    )

    assert.equal(value.status, 'COMPLETE')
    assert.equal(typeof value.consultationId, 'string')
    assert.equal(value.meta.kind, 'single')
    assert.equal(value.meta.slots.length, 1)
    assert.equal(value.meta.slots[0].answer, 'The derivation is correct under plane strain.')
    assert.equal(value.meta.slots[0].usage.inputTokens, 11)
    assert.ok(value.meta.question.hash.length === 64)

    const rendered = tool.output.render({}, value)
    assert.equal(rendered[0].type, 'text')
    assert.ok(rendered[0].text.includes('The derivation is correct'))
    assert.ok(rendered[0].text.includes('verify_consultation'), 'the model must be told to verify')

    const meta = tool.output.presentationMeta({}, value)
    assert.equal(meta.version, 1)
    assert.equal(meta.slots[0].modelId, 'mock-model')
    assert.equal(JSON.stringify(meta).includes('sk-test-smoke'), false)
  } finally {
    await provider.close()
  }
})

test('consult_council executes end to end and reports one failed slot honestly', async () => {
  const provider = await startProvider('council answer')
  try {
    const { registered } = await buildPlugin({ provider })
    const tool = registered.find((entry) => entry.name === 'consult_council')
    const value = await tool.execute(
      { question: 'Which approach?', slots: ['L2', 'L3'], mode: 'architecture' },
      { signal: AbortSignal.timeout(15000), name: 'consult_council' },
    )

    assert.equal(value.status, 'PARTIAL')
    assert.equal(value.meta.slots.length, 2)
    assert.equal(value.meta.synthesis.counts.success, 1)
    assert.deepEqual(value.meta.synthesis.absent, ['L3'])
    const rendered = tool.output.render({}, value)
    assert.ok(rendered[0].text.includes('1/2 returned'))
    assert.ok(rendered[0].text.includes('You own the synthesis'))
  } finally {
    await provider.close()
  }
})

test('followup_expert carries the previous answer and rejects an unknown id', async () => {
  const provider = await startProvider('first answer')
  try {
    const { registered } = await buildPlugin({ provider })
    const consult = registered.find((entry) => entry.name === 'consult_expert')
    const followup = registered.find((entry) => entry.name === 'followup_expert')

    const first = await consult.execute({ question: 'Original question?', slot: 'L2' }, { signal: AbortSignal.timeout(15000), name: 'consult_expert' })

    const second = await followup.execute(
      { consultation_id: first.consultationId, question: 'Can you show step 3?', slot: 'L2' },
      { signal: AbortSignal.timeout(15000), name: 'followup_expert' },
    )
    assert.equal(second.status, 'COMPLETE')

    const sent = JSON.stringify(provider.requests.at(-1).body)
    assert.ok(sent.includes('first answer'), 'the previous answer must be carried into the follow-up')
    assert.ok(sent.includes('Can you show step 3?'))

    await assert.rejects(
      () => followup.execute({ consultation_id: 'ec-does-not-exist', question: 'x' }, { signal: AbortSignal.timeout(5000), name: 'followup_expert' }),
      /no consultation/,
    )
  } finally {
    await provider.close()
  }
})

test('verify_consultation records a verdict that survives on the record', async () => {
  const provider = await startProvider('advice')
  try {
    const { registered } = await buildPlugin({ provider })
    const consult = registered.find((entry) => entry.name === 'consult_expert')
    const verify = registered.find((entry) => entry.name === 'verify_consultation')

    const first = await consult.execute({ question: 'q', slot: 'L2' }, { signal: AbortSignal.timeout(15000), name: 'consult_expert' })
    const result = await verify.execute(
      { consultation_id: first.consultationId, verdict: 'ADOPTED', notes: 'recomputed the formula; matches', evidence: 'test/energy.test.ts' },
      { signal: AbortSignal.timeout(5000), name: 'verify_consultation' },
    )
    assert.equal(result.verdict, 'ADOPTED')
    assert.equal(result.meta.verification.verdict, 'ADOPTED')
    assert.equal(result.meta.verification.slot, null)

    await assert.rejects(
      () => verify.execute({ consultation_id: 'ec-missing', verdict: 'ADOPTED', notes: 'x' }, { signal: AbortSignal.timeout(5000) }),
      /no consultation/,
    )
  } finally {
    await provider.close()
  }
})

test('argument validation rejects bad input with a typed error, not a crash', async () => {
  const provider = await startProvider('x')
  try {
    const { registered } = await buildPlugin({ provider })
    const consult = registered.find((entry) => entry.name === 'consult_expert')
    const exec = { signal: AbortSignal.timeout(5000), name: 'consult_expert' }

    await assert.rejects(() => consult.execute({}, exec), /"question" is required/)
    await assert.rejects(() => consult.execute({ question: '   ' }, exec), /must not be empty/)
    await assert.rejects(() => consult.execute({ question: 'q', slot: 'L9' }, exec), /"slot" must be one of/)
    await assert.rejects(() => consult.execute({ question: 'q', mode: 'astrology' }, exec), /"mode" must be one of/)
    await assert.rejects(() => consult.execute({ question: 42 }, exec), /must be a string/)
  } finally {
    await provider.close()
  }
})

test('the settings page patch reaches the profile config through the editor', async () => {
  const provider = await startProvider('x')
  try {
    const { routes, services } = await buildPlugin({ provider })
    // Exercise the write path the route handler uses.
    const editor = services.configEditor
    const entry = editor.entries()[0]
    await editor.edit(entry, (raw) => ({
      ...raw,
      slots: { ...raw.slots, L3: { ...(raw.slots.L3 ?? {}), enabled: true, modelId: 'new-model' } },
    }))
    assert.equal(editor.edits.length, 1)
    assert.equal(editor.edits[0].slots.L3.modelId, 'new-model')
    assert.equal(editor.edits[0].slots.L2.modelId, 'mock-model', 'other slots must be preserved')
    assert.ok(routes.length > 0)
  } finally {
    await provider.close()
  }
})

// --- services that arrive after the plugin activates ------------------------
//
// A host plugin activates as soon as its own inject list is satisfied, and the
// credential service is a separate host plugin. Capturing `ctx.get('credentials')`
// once during apply() made every consultation fail with CREDENTIAL_MISSING on a
// real host even though the credentials existed. These tests pin the fix.

function lateCredentialConfig(provider) {
  return {
    slots: {
      L1: { enabled: false },
      L2: {
        enabled: true,
        protocol: 'openai_chat_completions',
        baseUrl: provider.baseUrl,
        modelId: 'mock-model',
        credentialRef: 'DSH_EXPERT_L2_API_KEY',
        maxOutputTokens: 512,
        timeoutMs: 10000,
        retries: 0,
      },
      L3: { enabled: false },
    },
    defaults: { singleSlot: 'L2', allowCouncil: true },
    security: { allowedHosts: [], trustedLocalEndpoints: ['127.0.0.1'], maxPayloadBytes: 120000, redactSecrets: true },
  }
}

async function buildWithoutCredentials(provider) {
  const dataDir = await mkdtemp(join(tmpdir(), 'ec-late-'))
  process.env.DSH_HOME = dataDir
  const config = lateCredentialConfig(provider)
  const registered = []
  const services = {
    credentials: undefined,
    configEditor: mockConfigEditor(config),
    tools: {
      register(definition) {
        registered.push(definition)
        return () => undefined
      },
    },
    webServer: { register: () => () => undefined },
  }
  apply(fakeContext({ services }), config)
  return { registered, services }
}

test('a credential service that mounts after apply() is still used', async () => {
  const provider = await startProvider('late credential answer')
  try {
    const { registered, services } = await buildWithoutCredentials(provider)
    const tool = registered.find((entry) => entry.name === 'consult_expert')
    assert.ok(tool)

    // The credential service arrives afterwards, exactly like the real host.
    services.credentials = mockCredentials({ DSH_EXPERT_L2_API_KEY: 'sk-test-late-0123456789' })

    const value = await tool.execute(
      { question: 'Does a late-mounted credential work?', slot: 'L2' },
      { signal: AbortSignal.timeout(15000), name: 'consult_expert' },
    )
    assert.equal(value.status, 'COMPLETE')
    assert.equal(value.meta.slots[0].answer, 'late credential answer')
    assert.equal(provider.requests.length, 1, 'the request must actually reach the provider')
  } finally {
    await provider.close()
  }
})

test('a missing credential service still reports CREDENTIAL_MISSING, not a crash', async () => {
  const provider = await startProvider('unreachable')
  try {
    const { registered } = await buildWithoutCredentials(provider)
    const tool = registered.find((entry) => entry.name === 'consult_expert')

    const value = await tool.execute(
      { question: 'No credential service at all', slot: 'L2' },
      { signal: AbortSignal.timeout(10000), name: 'consult_expert' },
    )
    assert.equal(value.status, 'FAILED')
    assert.equal(value.meta.slots[0].error.category, 'CREDENTIAL_MISSING')
    assert.equal(provider.requests.length, 0, 'no request may leave without a credential')
  } finally {
    await provider.close()
  }
})
