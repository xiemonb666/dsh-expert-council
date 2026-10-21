/**
 * dsh-expert-council — host half.
 *
 * A model-agnostic expert consultation gateway: the main agent can ask one
 * user-configured external expert (L1/L2/L3) or all configured tiers in
 * parallel, and every exchange is recorded so the Web UI can show exactly what
 * was sent, what came back, and what the agent decided to do with it.
 *
 * This module is the plugin entry. It wires:
 *   - normalized configuration + credential resolution;
 *   - the protocol registry (OpenAI Chat Completions / Anthropic Messages);
 *   - the consultation orchestrator;
 *   - the durable consultation index;
 *   - the four tools the model calls;
 *   - the JSON API the Expert Council settings page talks to.
 */
import { join } from 'node:path'
import { homedir } from 'node:os'

import { normalizeConfig, SLOT_IDS } from './src/host/config.js'
import { CATEGORY } from './src/host/categories.js'
import { ConsultationStore } from './src/host/records.js'
import { consultCouncil, consultSingle } from './src/host/consultation.js'
import { buildBrief } from './src/host/brief.js'
import { createToolDefinitions } from './src/host/tools.js'
import { registerSettingsRoutes } from './src/host/routes.js'
import * as protocols from './src/host/protocols/index.js'

export const name = 'dsh-expert-council'

const PLUGIN_ENTRY_ID = 'dsh-expert-council'

/** Data directory: `$DSH_HOME/expert-council`, falling back to `~/.dsh`. */
function dataDirectory() {
  const home = process.env.DSH_HOME
  if (typeof home === 'string' && home.trim() !== '') return join(home, 'expert-council')
  return join(homedir(), '.dsh', 'expert-council')
}

export function apply(ctx, config) {
  // Re-normalized on every apply, so a config edit from the settings page (which
  // reloads this plugin through the Loader) takes effect without a restart.
  let current = normalizeConfig(config)
  const store = new ConsultationStore(dataDirectory())

  function getConfig() {
    return current
  }

  function credentialsService() {
    return ctx.get('credentials')
  }

  async function describeCredential(slotId) {
    const slot = current.slots[slotId]
    if (slot === undefined) return { configured: false }
    const credentials = credentialsService()
    if (credentials === undefined || credentials === null) return { configured: false }
    try {
      const info = await credentials.describe(slot.credentialRef)
      return { configured: info?.configured === true, source: info?.source ?? null }
    } catch {
      return { configured: false }
    }
  }

  async function setCredential(slotId, value) {
    const slot = current.slots[slotId]
    if (slot === undefined) throw new Error(`unknown slot "${slotId}"`)
    const credentials = credentialsService()
    if (credentials === undefined || credentials === null) throw new Error('the credential service is not mounted in this profile')
    await credentials.set(slot.credentialRef, value)
  }

  async function clearCredential(slotId) {
    const slot = current.slots[slotId]
    if (slot === undefined) throw new Error(`unknown slot "${slotId}"`)
    const credentials = credentialsService()
    if (credentials === undefined || credentials === null) throw new Error('the credential service is not mounted in this profile')
    await credentials.unset(slot.credentialRef)
  }

  /** Persist one slot patch through the profile patch, using the Loader's own path. */
  async function writeSlot(slotId, patch) {
    const editor = ctx.get('configEditor')
    if (editor === undefined || editor === null) throw new Error('the configuration editor is not mounted in this profile')
    const entry = editor.entries().find((candidate) => candidate?.options?.id === PLUGIN_ENTRY_ID)
    if (entry === undefined) {
      throw new Error(`no profile entry "${PLUGIN_ENTRY_ID}" is editable; add the bundle to this profile first`)
    }
    await editor.edit(entry, (raw) => {
      const base = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
      const slots = base.slots !== null && typeof base.slots === 'object' && !Array.isArray(base.slots) ? base.slots : {}
      const existing = slots[slotId] !== null && typeof slots[slotId] === 'object' && !Array.isArray(slots[slotId]) ? slots[slotId] : {}
      const nextSlot = { ...existing }
      for (const [field, value] of Object.entries(patch)) {
        if (value === null) Reflect.deleteProperty(nextSlot, field)
        else nextSlot[field] = value
      }
      return { ...base, slots: { ...slots, [slotId]: nextSlot } }
    })
  }

  /** Persist one endpoint-policy patch through the same profile path. */
  async function writeSecurity(patch) {
    const editor = ctx.get('configEditor')
    if (editor === undefined || editor === null) throw new Error('the configuration editor is not mounted in this profile')
    const entry = editor.entries().find((candidate) => candidate?.options?.id === PLUGIN_ENTRY_ID)
    if (entry === undefined) {
      throw new Error(`no profile entry "${PLUGIN_ENTRY_ID}" is editable; add the bundle to this profile first`)
    }
    await editor.edit(entry, (raw) => {
      const base = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
      const security = base.security !== null && typeof base.security === 'object' && !Array.isArray(base.security) ? base.security : {}
      return { ...base, security: { ...security, ...patch } }
    })
  }

  /**
   * Probe one slot with a real request.
   *
   * This is deliberately a real provider call: the settings page tells the user
   * it may be billed, and a mock answer here would be exactly the "pretend it
   * works" failure mode this plugin must not have.
   */
  async function testSlot(slotId) {
    const slot = current.slots[slotId]
    if (slot === undefined) throw new Error(`unknown slot "${slotId}"`)
    const startedAt = Date.now()
    const brief = buildBrief({
      question: 'Reply with the single word OK. This is a connectivity test for an expert consultation plugin.',
      mode: 'general',
      context: '',
      evidence: '',
      requestedOutput: 'Exactly one word: OK',
    })
    const probeSlot = { ...slot, maxOutputTokens: Math.max(16, Math.min(slot.maxOutputTokens, 64)) }

    const { results } = await consultSingle({
      slots: { ...current.slots, [slotId]: probeSlot },
      defaults: { singleSlot: slotId },
      security: current.security,
      credentials: credentialsService(),
      protocols,
      input: { question: brief.question, mode: 'general', slot: slotId },
      requester: { agentId: undefined, sessionId: undefined, tool: 'settings-test' },
      knownSecrets: [],
      signal: AbortSignal.timeout(Math.max(10_000, slot.timeoutMs)),
    })

    const result = results[0] ?? {}
    const ok = result.status === 'SUCCESS'
    return {
      ok,
      slot: slotId,
      endpointHost: result.endpointHost ?? '',
      protocol: result.protocol ?? slot.protocol,
      modelId: result.modelId ?? slot.modelId,
      authOk: ok || (result.error?.category !== CATEGORY.AUTH_INVALID && result.error?.category !== CATEGORY.AUTH_REQUIRED && result.error?.category !== CATEGORY.CREDENTIAL_MISSING),
      nonStreamOk: ok,
      parseOk: ok,
      usageAvailable: ok && (result.usage?.inputTokens !== null || result.usage?.outputTokens !== null),
      latencyMs: Date.now() - startedAt,
      billable: true,
      ...(ok ? { sample: typeof result.answer === 'string' ? result.answer.slice(0, 200) : undefined } : {}),
      ...(ok ? {} : { error: result.error ?? { category: CATEGORY.UNKNOWN, message: 'the slot produced no result' } }),
    }
  }

  async function createRecord(meta) {
    await store.put(meta)
    return meta
  }

  async function updateRecord(consultationId, decision, slot) {
    return store.recordDecision(consultationId, decision, slot)
  }

  function buildRequester(exec) {
    return {
      agentId: typeof exec?.agent?.id === 'string' ? exec.agent.id : undefined,
      sessionId: typeof exec?.sessionId === 'string' ? exec.sessionId : undefined,
      tool: typeof exec?.name === 'string' ? exec.name : 'consult_expert',
    }
  }

  const runSingle = async ({ input, config: cfg, knownSecrets, requester, signal }) => {
    const result = await consultSingle({
      slots: cfg.slots,
      defaults: cfg.defaults,
      security: cfg.security,
      // Resolved per call, never captured at load time: a plugin activates as
      // soon as its own inject list is satisfied, and the credential service is
      // a separate host plugin that may register later. Capturing it once here
      // is what made every consultation fail with CREDENTIAL_MISSING.
      credentials: credentialsService(),
      protocols,
      input,
      requester,
      knownSecrets,
      signal,
    })
    return { meta: result.meta, rejected: result.rejected }
  }

  const runCouncil = async ({ input, config: cfg, knownSecrets, requester, signal }) => {
    const result = await consultCouncil({
      slots: cfg.slots,
      defaults: cfg.defaults,
      security: cfg.security,
      // Same reason as runSingle: resolve the service at call time.
      credentials: credentialsService(),
      protocols,
      input,
      requester,
      knownSecrets,
      signal,
    })
    return { meta: result.meta, rejected: result.rejected }
  }

  const definitions = createToolDefinitions({
    getConfig,
    protocols,
    store,
    buildRequester,
    knownSecrets: () => [],
    createRecord,
    updateRecord,
    runSingle,
    runCouncil,
  })

  // Tools: registered in a child context that waits for the tools service, so
  // the plugin stays loadable in a profile that has no agent tool registry.
  ctx.inject(['tools'], (scope) => {
    for (const definition of definitions) {
      scope.effect(() => scope.tools.register(definition), `dsh-expert-council: tool ${definition.name}`)
    }
  })

  // Settings API: same treatment for the web server.
  ctx.inject(['webServer'], (scope) => {
    const disposers = registerSettingsRoutes({
      webServer: scope.webServer,
      getConfig,
      writeSlot,
      writeSecurity,
      describeCredential,
      setCredential,
      clearCredential,
      testSlot,
      storeStats: () => store.stats(),
      listConsultations: (limit) => store.list(limit),
      readConsultation: (id) => store.get(id),
      deleteConsultation: (id) => store.remove(id),
    })
    scope.effect(() => () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          // already removed
        }
      }
    }, 'dsh-expert-council: settings routes')
  })

  // Credentials and the configuration editor may appear after this plugin; the
  // helpers above resolve them per call, so nothing else is needed here.
  void SLOT_IDS
}
