/**
 * Settings API tests.
 *
 * These exercise the real route handlers over real HTTP: the same
 * `registerSettingsRoutes` the plugin mounts, a real `node:http` server as the
 * `webServer` stand-in, and real request/response cycles. The only stubs are the
 * persistence and credential collaborators, which are exactly the seams the
 * routes are supposed to talk to.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

import { registerSettingsRoutes } from '../../plugin/src/host/routes.js'
import { normalizeConfig } from '../../plugin/src/host/config.js'

const HEADER = 'x-dsh-expert-council'

/** A minimal webServer stand-in that dispatches exact and prefix routes. */
async function startServer(deps) {
  const routes = []
  const disposers = registerSettingsRoutes({
    ...deps,
    webServer: {
      register(route) {
        routes.push(route)
        return () => {
          const index = routes.indexOf(route)
          if (index >= 0) routes.splice(index, 1)
        }
      },
    },
  })

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const exact = routes.find((route) => route.kind === 'exact' && route.path === url.pathname)
    if (exact !== undefined) {
      void exact.handler(req, res)
      return
    }
    const prefix = routes.filter((route) => route.kind === 'prefix').find((route) => url.pathname.startsWith(route.path))
    if (prefix !== undefined) {
      void prefix.handler(req, res)
      return
    }
    res.writeHead(404)
    res.end('{}')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    origin: `http://127.0.0.1:${port}`,
    routes,
    disposers,
    close: () =>
      new Promise((resolve) => {
        for (const dispose of disposers) dispose()
        server.close(resolve)
      }),
  }
}

function baseDeps(overrides = {}) {
  const writes = []
  const credentials = new Map()
  const config = normalizeConfig({
    slots: {
      L1: { enabled: true, protocol: 'anthropic_messages', baseUrl: 'https://api.anthropic.com/v1', modelId: 'claude-x', credentialRef: 'DSH_EXPERT_L1_API_KEY' },
      L2: { enabled: true, protocol: 'openai_chat_completions', baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-x', credentialRef: 'DSH_EXPERT_L2_API_KEY' },
    },
  })
  credentials.set('DSH_EXPERT_L1_API_KEY', 'sk-ant-secret-value-0123456789')

  return {
    writes,
    credentials,
    deps: {
      getConfig: () => config,
      writeSlot: async (slotId, patch) => {
        writes.push({ slotId, patch })
      },
      writeSecurity: async (patch) => {
        writes.push({ security: patch })
      },
      describeCredential: async (slotId) => {
        const slot = config.slots[slotId]
        return { configured: credentials.has(slot.credentialRef), source: credentials.has(slot.credentialRef) ? 'managed' : undefined }
      },
      setCredential: async (slotId, value) => {
        credentials.set(config.slots[slotId].credentialRef, value)
      },
      clearCredential: async (slotId) => {
        credentials.delete(config.slots[slotId].credentialRef)
      },
      testSlot: async (slotId) => ({
        ok: true,
        slot: slotId,
        endpointHost: 'api.example.com',
        protocol: config.slots[slotId].protocol,
        modelId: config.slots[slotId].modelId,
        authOk: true,
        nonStreamOk: true,
        parseOk: true,
        usageAvailable: true,
        latencyMs: 42,
        billable: true,
      }),
      storeStats: async () => ({ path: '/tmp/x', count: 2, bytes: 100, orphans: [] }),
      listConsultations: async () => [{ consultationId: 'ec-1', status: 'COMPLETE' }],
      readConsultation: async (id) => (id === 'ec-1' ? { consultationId: 'ec-1', slots: [] } : null),
      deleteConsultation: async (id) => id === 'ec-1',
      ...overrides,
    },
  }
}

async function call(server, path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${server.origin}${path}`, {
    method,
    headers: { 'content-type': 'application/json', [HEADER]: '1', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  return { status: response.status, json, text, headers: Object.fromEntries(response.headers.entries()) }
}

test('GET /state describes every slot and never leaks a credential value', async () => {
  const { deps } = baseDeps()
  const server = await startServer(deps)
  try {
    const result = await call(server, '/expert-council/state')
    assert.equal(result.status, 200)
    assert.equal(result.json.ok, true)
    assert.equal(result.json.slots.length, 3)
    assert.deepEqual(result.json.protocols, ['openai_chat_completions', 'anthropic_messages'])

    const l1 = result.json.slots.find((slot) => slot.slot === 'L1')
    assert.equal(l1.credentialConfigured, true)
    assert.equal(l1.modelId, 'claude-x')
    assert.equal(l1.protocol, 'anthropic_messages')

    const l2 = result.json.slots.find((slot) => slot.slot === 'L2')
    assert.equal(l2.credentialConfigured, false)

    assert.equal(result.text.includes('sk-ant-secret-value'), false, 'a credential value must never cross this API')
    assert.equal(result.text.includes('apiKey'), false)
    assert.equal(result.json.credentials.DSH_EXPERT_L1_API_KEY.configured, true)
    assert.equal(result.json.store.count, 2)
  } finally {
    await server.close()
  }
})

test('requests without the required header are refused', async () => {
  const { deps } = baseDeps()
  const server = await startServer(deps)
  try {
    const result = await call(server, '/expert-council/state', { headers: { [HEADER]: '' } })
    assert.equal(result.status, 403)
    assert.match(result.json.error, /missing required header/)
  } finally {
    await server.close()
  }
})

test('POST /slot persists a whitelisted patch and answers with the fresh state', async () => {
  const { deps, writes } = baseDeps()
  const server = await startServer(deps)
  try {
    const result = await call(server, '/expert-council/slot', {
      method: 'POST',
      body: { slot: 'L2', patch: { enabled: true, modelId: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1', protocol: 'openai_chat_completions', evil: 'drop me' } },
    })
    assert.equal(result.status, 200)
    assert.equal(writes.length, 1)
    assert.equal(writes[0].slotId, 'L2')
    assert.equal(writes[0].patch.modelId, 'gpt-4o-mini')
    assert.equal('evil' in writes[0].patch, false)
    // The response is the same shape as GET /state.
    assert.equal(result.json.ok, true)
    assert.ok(Array.isArray(result.json.slots))
  } finally {
    await server.close()
  }
})

test('POST /slot rejects an unknown slot, an empty patch and a bad protocol', async () => {
  const { deps, writes } = baseDeps()
  const server = await startServer(deps)
  try {
    const unknown = await call(server, '/expert-council/slot', { method: 'POST', body: { slot: 'L9', patch: { enabled: true } } })
    assert.equal(unknown.status, 400)
    assert.match(unknown.json.error, /must be one of/)

    const empty = await call(server, '/expert-council/slot', { method: 'POST', body: { slot: 'L1', patch: { protocol: 'ftp' } } })
    assert.equal(empty.status, 400)
    assert.match(empty.json.error, /no writable field/)

    assert.equal(writes.length, 0)
  } finally {
    await server.close()
  }
})

test('a persistence failure is reported as a conflict, not a success', async () => {
  const { deps } = baseDeps({
    writeSlot: async () => {
      throw new Error('Configuration for "dsh-expert-council" is overridden by a home patch')
    },
  })
  const server = await startServer(deps)
  try {
    const result = await call(server, '/expert-council/slot', { method: 'POST', body: { slot: 'L1', patch: { modelId: 'x' } } })
    assert.equal(result.status, 409)
    assert.equal(result.json.ok, false)
    assert.match(result.json.error, /overridden/)
  } finally {
    await server.close()
  }
})

test('credentials can be set and cleared, and the value is never echoed', async () => {
  const { deps, credentials } = baseDeps()
  const server = await startServer(deps)
  try {
    const set = await call(server, '/expert-council/credential', { method: 'POST', body: { slot: 'L2', apiKey: 'sk-test-newly-entered-key-123456' } })
    assert.equal(set.status, 200)
    assert.equal(set.json.credential.configured, true)
    assert.equal(set.text.includes('sk-test-newly-entered-key'), false)
    assert.equal(credentials.get('DSH_EXPERT_L2_API_KEY'), 'sk-test-newly-entered-key-123456')

    const clear = await call(server, '/expert-council/credential', { method: 'DELETE', body: { slot: 'L2' } })
    assert.equal(clear.status, 200)
    assert.equal(clear.json.credential.configured, false)
    assert.equal(credentials.has('DSH_EXPERT_L2_API_KEY'), false)
  } finally {
    await server.close()
  }
})

test('a too-short credential is refused', async () => {
  const { deps } = baseDeps()
  const server = await startServer(deps)
  try {
    const result = await call(server, '/expert-council/credential', { method: 'POST', body: { slot: 'L2', apiKey: 'short' } })
    assert.equal(result.status, 400)
    assert.match(result.json.error, /at least 8 characters/)
  } finally {
    await server.close()
  }
})

test('POST /test returns the probe result and marks it billable', async () => {
  const { deps } = baseDeps()
  const server = await startServer(deps)
  try {
    const result = await call(server, '/expert-council/test', { method: 'POST', body: { slot: 'L1' } })
    assert.equal(result.status, 200)
    assert.equal(result.json.result.ok, true)
    assert.equal(result.json.result.billable, true)
    assert.equal(result.json.result.protocol, 'anthropic_messages')
  } finally {
    await server.close()
  }
})

test('a throwing probe is reported as an unsuccessful result, not a 500', async () => {
  const { deps } = baseDeps({
    testSlot: async () => {
      throw new Error('network exploded')
    },
  })
  const server = await startServer(deps)
  try {
    const result = await call(server, '/expert-council/test', { method: 'POST', body: { slot: 'L1' } })
    assert.equal(result.status, 200)
    assert.equal(result.json.result.ok, false)
    assert.match(result.json.result.error.message, /network exploded/)
  } finally {
    await server.close()
  }
})

test('history endpoints list, read and delete consultations', async () => {
  const { deps } = baseDeps()
  const server = await startServer(deps)
  try {
    const list = await call(server, '/expert-council/history?limit=5')
    assert.equal(list.status, 200)
    assert.equal(list.json.consultations.length, 1)

    const one = await call(server, '/expert-council/history/ec-1')
    assert.equal(one.status, 200)
    assert.equal(one.json.consultation.consultationId, 'ec-1')

    const missing = await call(server, '/expert-council/history/ec-404')
    assert.equal(missing.status, 404)

    const removed = await call(server, '/expert-council/history/delete', { method: 'POST', body: { id: 'ec-1' } })
    assert.equal(removed.json.removed, true)
  } finally {
    await server.close()
  }
})

test('a malformed JSON body is a 400, not a crash', async () => {
  const { deps } = baseDeps()
  const server = await startServer(deps)
  try {
    const response = await fetch(`${server.origin}/expert-council/slot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [HEADER]: '1' },
      body: '{not json',
    })
    assert.equal(response.status, 400)
    const json = await response.json()
    assert.match(json.error, /not valid JSON/)
  } finally {
    await server.close()
  }
})

test('POST /security persists the endpoint policy and answers with the fresh state', async () => {
  const { deps, writes } = baseDeps()
  const server = await startServer(deps)
  try {
    const result = await call(server, '/expert-council/security', {
      method: 'POST',
      body: { patch: { allowedHosts: ['API.Example.com', 'api.anthropic.com'], trustedLocalEndpoints: ['127.0.0.1'], maxPayloadBytes: 50000, redactSecrets: false, allowRepoScope: true, junk: 'drop' } },
    })
    assert.equal(result.status, 200)
    assert.equal(writes.length, 1)
    assert.deepEqual(writes[0].security, {
      allowedHosts: ['api.example.com', 'api.anthropic.com'],
      trustedLocalEndpoints: ['127.0.0.1'],
      maxPayloadBytes: 50000,
      redactSecrets: false,
      allowRepoScope: true,
    })
    assert.equal(result.json.ok, true)
    assert.ok(Array.isArray(result.json.slots))
  } finally {
    await server.close()
  }
})

test('POST /security rejects an empty or wrongly typed patch', async () => {
  const { deps, writes } = baseDeps()
  const server = await startServer(deps)
  try {
    const empty = await call(server, '/expert-council/security', { method: 'POST', body: { patch: { junk: 1 } } })
    assert.equal(empty.status, 400)
    assert.match(empty.json.error, /no writable field/)

    const wrong = await call(server, '/expert-council/security', { method: 'POST', body: { patch: { allowedHosts: 'not-an-array', allowRepoScope: 'yes' } } })
    assert.equal(wrong.status, 400)
    assert.equal(writes.length, 0)
  } finally {
    await server.close()
  }
})

test('every registered route is removed by its disposer', async () => {
  const { deps } = baseDeps()
  const server = await startServer(deps)
  assert.ok(server.routes.length >= 6)
  const before = server.routes.length
  await server.close()
  assert.equal(server.routes.length, before - before)
})
