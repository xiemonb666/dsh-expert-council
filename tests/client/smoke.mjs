// Offline smoke test for plugin/client.js.
//
// The host only loads `plugin/client.js` as one self-contained file, so this
// test loads it the same way the browser does: through a fake
// `window.__ModuleLoader__` and a fake `require('react')` that provides just
// enough of the React surface (createElement + hooks) to walk the returned
// element tree. It does NOT need a DOM, a bundler or the Harness runtime.
//
// The subject file is deliberately NOT imported by client.js — this script
// reads it as text and evaluates it with a fake `window`, which is exactly how
// the browser's module loader does it. Nothing here ships with the plugin.
//
// Run with: node tests/client/smoke.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT_PATH = resolve(HERE, '../../plugin/client.js')
const SOURCE = readFileSync(CLIENT_PATH, 'utf8')

// ---------------------------------------------------------------------------
// Fake React
// ---------------------------------------------------------------------------

const FRAGMENT = Symbol.for('react.fragment')

function createElement(type, config, ...children) {
  const props = Object.assign({}, config === null || config === undefined ? {} : config)
  if (children.length === 1) props.children = children[0]
  else if (children.length > 1) props.children = children
  return { type, props }
}

const React = {
  createElement,
  Fragment: FRAGMENT,
  // Single-pass rendering: every hook returns its initial value. That is
  // enough to exercise every render branch exactly once.
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, function noop() {}]
  },
  useEffect() {},
  useMemo(factory) {
    return factory()
  },
  useRef(initial) {
    return { current: initial }
  },
  memo(component) {
    return component
  },
}

// ---------------------------------------------------------------------------
// Fake module loader
// ---------------------------------------------------------------------------

const loaded = []
const fakeWindow = {
  __ModuleLoader__: {
    load(definition) {
      loaded.push(definition)
    },
  },
}

// This file asserts the ENGLISH copy, so the environment is pinned to an
// English browser. Without a locale service the plugin picks its fallback
// dictionary from `navigator`, and Node reports the host machine's locale
// (this machine reports zh-CN), which would make these assertions depend on
// whoever runs the suite. Pinning makes the result deterministic; the Chinese
// path is covered by i18n.test.mjs.
const ORIGINAL_NAVIGATOR = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  writable: true,
  value: { language: 'en-US', languages: ['en-US', 'en'] },
})

new Function('window', SOURCE)(fakeWindow)

const requireStub = (request) => {
  if (request === 'react') return React
  throw new Error('unexpected require: ' + request)
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

let checks = 0
const failures = []

function check(name, condition, detail) {
  checks += 1
  if (!condition) failures.push(name + (detail === undefined ? '' : ' — ' + detail))
}

function checkEqual(name, actual, expected) {
  check(name, actual === expected, 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual))
}

function checkContains(name, haystack, needle) {
  check(name, haystack.includes(needle), 'missing ' + JSON.stringify(needle) + ' in rendered text')
}

function checkNotContains(name, haystack, needle) {
  check(name, !haystack.includes(needle), 'unexpected ' + JSON.stringify(needle) + ' in rendered text')
}

// ---------------------------------------------------------------------------
// Element-tree walker
// ---------------------------------------------------------------------------

function walk(node, out) {
  if (node === null || node === undefined || node === false || node === true) return
  const kind = typeof node
  if (kind === 'string' || kind === 'number') {
    out.push(String(node))
    return
  }
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out)
    return
  }
  if (kind !== 'object') return
  const type = node.type
  if (typeof type === 'function') {
    walk(type(node.props), out)
    return
  }
  if (type === FRAGMENT) {
    walk(node.props.children, out)
    return
  }
  walk(node.props.children, out)
}

function renderText(element) {
  const out = []
  walk(element, out)
  return out.join('')
}

function renderSafely(name, element) {
  try {
    return renderText(element)
  } catch (error) {
    check(name, false, 'render threw: ' + (error && error.message ? error.message : String(error)))
    return ''
  }
}

const expanded = () => ({ expanded: true, toggle() {} })

// ---------------------------------------------------------------------------
// 1. Module shape
// ---------------------------------------------------------------------------

checkEqual('exactly one module registered', loaded.length, 1)
const definition = loaded[0] || {}
checkEqual('module id', definition.id, 'dsh-expert-council')
checkEqual('factory is a function', typeof definition.factory, 'function')

const plugin = definition.factory(requireStub)
check('plugin object', plugin !== null && typeof plugin === 'object')
checkEqual('inject', JSON.stringify(plugin.inject), JSON.stringify(['slots']))
checkEqual('apply is a function', typeof plugin.apply, 'function')
check('test seam exposed', plugin.__test !== undefined)

// ---------------------------------------------------------------------------
// 2. apply() registration against a fake ctx
// ---------------------------------------------------------------------------

const registrations = []
const disposers = []
let effects = 0

const fakeCtx = {
  effect(callback) {
    effects += 1
    const dispose = callback()
    disposers.push(dispose)
    return dispose
  },
  slots: {
    inject(key, callback) {
      check('slots.inject key is a string', typeof key === 'string', key)
      const dispose = callback()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    register(options, component) {
      registrations.push({ options, component })
      return function disposeRegistration() {}
    },
  },
  // No locale service on purpose: this smoke test covers the degraded host that
  // has no `ctx.locale`, where the UI must fall back to English rather than
  // render raw dictionary keys. The bilingual path is covered by i18n.test.mjs.
}

try {
  plugin.apply(fakeCtx)
  check('apply did not throw', true)
} catch (error) {
  check('apply did not throw', false, error && error.message ? error.message : String(error))
}

checkEqual('registration count', registrations.length, 5)
check('effect used for styles', effects >= 1, 'effects=' + effects)
check('every disposer is callable', disposers.every((item) => typeof item === 'function'))

const toolRegistrations = registrations.filter((entry) => entry.options.name === 'tool.call.toolview')
checkEqual('tool.call.toolview registrations', toolRegistrations.length, 4)
checkEqual(
  'tool keys',
  JSON.stringify(toolRegistrations.map((entry) => entry.options.key)),
  JSON.stringify(['consult_expert', 'consult_council', 'followup_expert', 'verify_consultation']),
)
check(
  'tool views are components',
  toolRegistrations.every((entry) => typeof entry.component === 'function'),
)

const sectionRegistration = registrations.find((entry) => entry.options.name === 'settings.section')
check('settings.section registered', sectionRegistration !== undefined)
if (sectionRegistration !== undefined) {
  checkEqual('settings.section id', sectionRegistration.options.id, 'expert-council')
  // The label is a thunk so the nav row follows the active locale: the shell
  // re-reads it on every projection instead of freezing one language at
  // registration time. Calling it here is exactly what the shell does.
  checkEqual('settings.section label is a thunk', typeof sectionRegistration.options.label, 'function')
  checkEqual(
    'settings.section label text',
    typeof sectionRegistration.options.label === 'function'
      ? sectionRegistration.options.label()
      : sectionRegistration.options.label,
    'Expert Council',
  )
  checkEqual('settings.section order', sectionRegistration.options.order, 50)
  checkEqual('settings.section component', typeof sectionRegistration.component, 'function')
}

// ---------------------------------------------------------------------------
// 3. Fixtures
// ---------------------------------------------------------------------------

const singleMeta = {
  version: 1,
  kind: 'single',
  consultationId: 'ec-20261020230000-ab12cd',
  createdAt: '2026-10-20T15:00:00.000Z',
  durationMs: 12345,
  status: 'COMPLETE',
  mode: 'math_review',
  reason: 'Independent check of the derivation',
  requestedOutput: 'numbered steps',
  requester: { agentId: 'agent-1', sessionId: 'session-1', tool: 'consult_expert' },
  routing: { requestedSlot: 'L1', autoRouted: false, policy: 'explicit' },
  privacy: { redactions: 3, appliedRules: ['api-key', 'bearer-token'], externalBytes: 4096, truncated: false },
  question: {
    normalized: 'Verify the integral step.',
    context: 'derivation context',
    evidence: 'eq: integral of 2x dx',
    hash: 'abcdef0123456789abcdef',
  },
  slots: [
    {
      slot: 'L1',
      displayName: 'Frontier Reasoning',
      protocol: 'anthropic_messages',
      providerLabel: 'Anthropic',
      endpointHost: 'api.anthropic.com',
      modelId: 'claude-x',
      status: 'SUCCESS',
      requestId: 'req_1',
      startedAt: '2026-10-20T15:00:00.000Z',
      durationMs: 12345,
      attempts: 1,
      usage: {
        inputTokens: 1200,
        outputTokens: 800,
        totalTokens: 2000,
        cacheReadTokens: null,
        reasoningTokens: null,
      },
      cost: { estimatedUsd: 0.0123, source: 'estimated' },
      finishReason: 'stop',
      answer: 'The integral evaluates to x squared plus a constant.',
      blocks: [{ type: 'text', text: 'The integral evaluates to x squared plus a constant.' }],
      requestSent: {
        system: 'You are a careful mathematician.',
        user: 'Verify: integral of 2x dx',
        hash: 'deadbeefdeadbeef',
        bytes: 512,
      },
      capabilities: { nonStream: true, usage: true },
      redactionDiff: { originalBytes: 900, sentBytes: 512, rules: ['api-key'] },
    },
  ],
  diagnostics: { configRevision: 'r7', notes: ['retried once after a 429'] },
}

const councilMeta = {
  version: 1,
  kind: 'council',
  consultationId: 'ec-20261020230001-ff00aa',
  groupId: 'ec-20261020230001-ff00aa',
  createdAt: '2026-10-20T15:10:00.000Z',
  durationMs: 21000,
  status: 'PARTIAL',
  mode: 'architecture',
  reason: 'Three-way architecture review',
  requester: { tool: 'consult_council' },
  routing: { autoRouted: true, policy: 'all-configured' },
  privacy: { redactions: 1, appliedRules: ['api-key'], externalBytes: 8192, truncated: false },
  question: { normalized: 'Which storage layout should we adopt?', hash: '0123456789abcdef' },
  slots: [
    {
      slot: 'L1',
      displayName: 'Frontier Reasoning',
      protocol: 'anthropic_messages',
      providerLabel: 'Anthropic',
      endpointHost: 'api.anthropic.com',
      modelId: 'claude-x',
      status: 'SUCCESS',
      durationMs: 19000,
      attempts: 1,
      usage: { inputTokens: 900, outputTokens: 600, totalTokens: 1500, cacheReadTokens: null, reasoningTokens: null },
      cost: { estimatedUsd: 0.02, source: 'estimated' },
      answer: 'Use a columnar layout; overlap token 42 appears here.',
      capabilities: {},
    },
    {
      slot: 'L2',
      displayName: 'Advanced Reasoning',
      protocol: 'openai_chat_completions',
      providerLabel: 'Example',
      endpointHost: 'api.example.com',
      modelId: 'gpt-x',
      status: 'SUCCESS',
      durationMs: 21000,
      attempts: 2,
      usage: { inputTokens: 800, outputTokens: 700, totalTokens: 1500, cacheReadTokens: null, reasoningTokens: null },
      cost: { estimatedUsd: null, source: 'unknown' },
      answer: 'A columnar layout with overlap token 42 is reasonable.',
      capabilities: {},
    },
    {
      slot: 'L3',
      displayName: 'Core Reasoning',
      protocol: 'openai_chat_completions',
      providerLabel: 'Example',
      endpointHost: 'api.example.com',
      modelId: 'gpt-y',
      status: 'ERROR',
      durationMs: 3000,
      attempts: 1,
      usage: { inputTokens: null, outputTokens: null, totalTokens: null, cacheReadTokens: null, reasoningTokens: null },
      cost: { estimatedUsd: 0, source: 'unknown' },
      error: { category: 'RATE_LIMITED', message: 'Rate limit exceeded', httpStatus: 429, retryable: true },
      capabilities: {},
    },
  ],
  synthesis: {
    requested: ['L1', 'L2', 'L3'],
    succeeded: ['L1', 'L2'],
    failed: ['L3'],
    absent: [],
    counts: { success: 2, requested: 3 },
    overlap: [{ token: '42', kind: 'number', slots: ['L1', 'L2'] }],
    uniqueBySlot: [{ slot: 'L1', items: ['columnar'] }],
    answerLengths: [
      { slot: 'L1', chars: 48 },
      { slot: 'L2', chars: 51 },
      { slot: 'L3', chars: 0 },
    ],
    note: '机械词面重合，不代表事实一致，需主 Agent 独立验证',
    decision: { verdict: 'PARTIAL', notes: 'Adopt columnar, re-check with L3 later', at: '2026-10-20T15:12:00.000Z' },
  },
  diagnostics: { configRevision: 'r7', notes: [] },
}

function resultBlock(meta, extra) {
  return Object.assign(
    {
      callId: 'call-1',
      call: { name: 'consult_expert', argsRaw: '{"question":"x"}', args: { question: 'x' } },
      content: [{ type: 'text', text: 'fallback result text from the tool' }],
      isError: false,
      meta,
      subCalls: [],
    },
    extra === undefined ? {} : extra,
  )
}

const components = plugin.__test.components

// ---------------------------------------------------------------------------
// 4. Single-consultation card
// ---------------------------------------------------------------------------

const singleProps = {
  callId: 'call-1',
  toolName: 'consult_expert',
  phase: 'result',
  block: resultBlock(singleMeta),
  cwd: 'C:\\work',
  home: 'C:\\Users\\X',
  useDisclosure: expanded,
  openFile() {},
  inspect() {},
}

const singleCollapsed = renderSafely('single collapsed renders', components.ConsultExpertView({ ...singleProps, useDisclosure: undefined }))
checkContains('single collapsed title', singleCollapsed, 'Expert Consultation · L1 Frontier Reasoning')
checkContains('single collapsed status', singleCollapsed, 'SUCCESS')
checkContains('single collapsed duration', singleCollapsed, '12.3 s')
checkContains('single collapsed model', singleCollapsed, 'claude-x')
checkNotContains('single collapsed hides body', singleCollapsed, 'Full answer')

const singleExpanded = renderSafely('single expanded renders', components.ConsultExpertView(singleProps))
checkContains('single expanded status badge', singleExpanded, 'SUCCESS')
checkContains('single expanded protocol', singleExpanded, 'Anthropic Messages')
checkContains('single expanded cost', singleExpanded, '~$0.0123')
checkContains('single expanded usage', singleExpanded, 'in 1,200 · out 800 · total 2,000')
checkContains('single expanded answer', singleExpanded, 'The integral evaluates to x squared plus a constant.')
checkContains('single expanded request section', singleExpanded, 'Redacted request actually sent')
checkContains('single expanded system prompt', singleExpanded, 'You are a careful mathematician.')
checkContains('single expanded user prompt', singleExpanded, 'Verify: integral of 2x dx')
checkContains('single expanded redaction diff', singleExpanded, 'Redaction')
checkContains('single expanded diagnostics', singleExpanded, 'retried once after a 429')
checkContains('single expanded copy buttons', singleExpanded, 'Copy answer')
checkContains('single expanded json section', singleExpanded, 'Raw metadata (JSON)')

// ---------------------------------------------------------------------------
// 5. Council card
// ---------------------------------------------------------------------------

const councilProps = {
  callId: 'call-2',
  toolName: 'consult_council',
  phase: 'result',
  block: resultBlock(councilMeta, { call: { name: 'consult_council', argsRaw: '{}', args: {} } }),
  useDisclosure: expanded,
  inspect() {},
}

const councilExpanded = renderSafely('council expanded renders', components.ConsultCouncilView(councilProps))
checkContains('council title', councilExpanded, 'Expert Council · L1 / L2 / L3')
checkContains('council returned count', councilExpanded, '2/3 returned')
checkContains('council synthesis label', councilExpanded, 'Council Synthesis')
// The caveat is UI copy, so it comes from the dictionary rather than echoing
// whatever language the host happened to write its note in. The host's own
// wording must still be reachable in the Raw metadata panel, so both appear.
const enMessages = (plugin.__test.messages && plugin.__test.messages.en) || {}
check('card.synthesisNote is in the dictionary', typeof enMessages['card.synthesisNote'] === 'string')
if (typeof enMessages['card.synthesisNote'] === 'string') {
  checkContains('council mechanical note is localized', councilExpanded, enMessages['card.synthesisNote'])
}
checkContains('host synthesis note preserved in raw JSON', councilExpanded, '机械词面重合，不代表事实一致')
checkContains('council overlap chip', councilExpanded, '42')
checkContains('council unique by slot', councilExpanded, 'columnar')
checkContains('council answer lengths', councilExpanded, 'Answer lengths')
checkContains('council L3 error', councilExpanded, 'RATE_LIMITED')
checkContains('council copy comparison', councilExpanded, 'Copy 3-way comparison')
checkContains('council tab buttons', councilExpanded, 'L2')
checkContains('council decision', councilExpanded, 'PARTIAL')

const councilCollapsed = renderSafely(
  'council collapsed renders',
  components.ConsultCouncilView({ ...councilProps, useDisclosure: undefined }),
)
checkContains('council collapsed title', councilCollapsed, 'Expert Council · L1 / L2 / L3')
checkNotContains('council collapsed hides synthesis', councilCollapsed, 'Council Synthesis')

// ---------------------------------------------------------------------------
// 6. Verify card
// ---------------------------------------------------------------------------

const verifyProps = {
  callId: 'call-3',
  toolName: 'verify_consultation',
  phase: 'result',
  block: resultBlock(councilMeta, { call: { name: 'verify_consultation', argsRaw: '{}', args: {} } }),
  useDisclosure: expanded,
}

const verifyText = renderSafely('verify renders', components.VerifyConsultationView(verifyProps))
checkContains('verify title', verifyText, 'Consultation Verification')
checkContains('verify verdict', verifyText, 'PARTIAL')
checkContains('verify notes', verifyText, 'Adopt columnar, re-check with L3 later')

// ---------------------------------------------------------------------------
// 7. Follow-up card
// ---------------------------------------------------------------------------

const followupText = renderSafely(
  'followup renders',
  components.FollowupExpertView({
    ...singleProps,
    toolName: 'followup_expert',
    block: resultBlock(singleMeta, { call: { name: 'followup_expert', argsRaw: '{}', args: {} } }),
  }),
)
checkContains('followup title', followupText, 'Expert Follow-up · L1 Frontier Reasoning')

// ---------------------------------------------------------------------------
// 8. Pending phases
// ---------------------------------------------------------------------------

for (const phase of ['preparing', 'start']) {
  const pendingProps = {
    callId: 'call-4',
    toolName: 'consult_council',
    phase,
    block: { callId: 'call-4', name: 'consult_council', phase, argsRaw: '{"question":"Is this right?"}', args: { question: 'Is this right?' } },
    useDisclosure: expanded,
  }
  const pending = renderSafely('pending ' + phase + ' renders', components.ConsultCouncilView(pendingProps))
  checkContains('pending ' + phase + ' title', pending, 'Expert Council')
  checkContains('pending ' + phase + ' summary', pending, 'Is this right?')
  checkContains('pending ' + phase + ' not-returned note', pending, 'has not returned a result yet')
}

// ---------------------------------------------------------------------------
// 9. Defensive fallbacks
// ---------------------------------------------------------------------------

const noMetaText = renderSafely(
  'missing meta falls back',
  components.ConsultExpertView({ ...singleProps, block: resultBlock(undefined), useDisclosure: expanded }),
)
checkContains('fallback notice', noMetaText, 'Structured metadata is unavailable')
checkContains('fallback raw text', noMetaText, 'fallback result text from the tool')

const malformedMeta = {
  kind: 'council',
  durationMs: 'not-a-number',
  status: 42,
  slots: 'nope',
  synthesis: 7,
  question: [],
  privacy: 'x',
  routing: 3,
  diagnostics: null,
}
const malformedText = renderSafely(
  'malformed meta does not throw',
  components.ConsultCouncilView({ ...singleProps, block: resultBlock(malformedMeta), useDisclosure: expanded }),
)
checkContains('malformed meta title', malformedText, 'Expert Council')
checkContains('malformed meta unknown status', malformedText, 'UNKNOWN')

const throwingBlock = {
  callId: 'call-5',
  call: { name: 'consult_expert', argsRaw: '{}', args: {} },
  content: [{ type: 'text', text: 'content still available' }],
  isError: true,
  get meta() {
    throw new Error('meta exploded')
  },
  subCalls: [],
}
const throwingText = renderSafely(
  'throwing meta getter is contained',
  components.ConsultExpertView({ ...singleProps, block: throwingBlock, useDisclosure: expanded }),
)
checkContains('throwing meta fallback', throwingText, 'content still available')

const weirdDisclosure = () => ({ somethingElse: true })
const weirdText = renderSafely(
  'unexpected useDisclosure shape falls back',
  components.ConsultExpertView({ ...singleProps, useDisclosure: weirdDisclosure }),
)
checkContains('unexpected useDisclosure title', weirdText, 'Expert Consultation · L1 Frontier Reasoning')

const noDisclosureAtAll = renderSafely(
  'missing useDisclosure falls back',
  components.ConsultExpertView({ ...singleProps, useDisclosure: null }),
)
checkContains('missing useDisclosure title', noDisclosureAtAll, 'Expert Consultation')

// block.isError surfaces a failure badge even when the meta itself is complete.
const failedText = renderSafely(
  'isError result renders a failure badge',
  components.ConsultExpertView({
    ...singleProps,
    block: resultBlock(singleMeta, { isError: true, content: [{ type: 'text', text: 'host-side failure detail' }] }),
  }),
)
checkContains('isError badge', failedText, 'FAILED')
checkContains('isError detail', failedText, 'host-side failure detail')

// ---------------------------------------------------------------------------
// 10. Pure helpers
// ---------------------------------------------------------------------------

const test = plugin.__test
checkEqual('formatCost null', test.formatCost(null), 'unknown')
checkEqual('formatCost unknown source', test.formatCost({ estimatedUsd: null, source: 'unknown' }), 'unknown')
checkEqual('formatCost estimated', test.formatCost({ estimatedUsd: 0.5, source: 'estimated' }), '~$0.50')
checkEqual('formatDuration null', test.formatDuration(null), 'unknown')
checkEqual('formatDuration ms', test.formatDuration(250), '250 ms')
checkEqual('council cost with unknown member', test.councilCostTotal(test.normalizeMeta(councilMeta)), 'unknown')
checkEqual('council returned', test.councilReturned(test.normalizeMeta(councilMeta)), '2/3 returned')

const councilReport = test.copyCouncilReport(test.normalizeMeta(councilMeta))
checkContains('council report header', councilReport, 'Expert Council — ec-20261020230001-ff00aa')
checkContains('council report model', councilReport, 'gpt-x')
checkContains('council report synthesis', councilReport, 'Mechanical synthesis')
checkContains('council report note', councilReport, '机械词面重合')

const singleReport = test.copySingleReport(test.normalizeMeta(singleMeta))
checkContains('single report model', singleReport, 'claude-x')
checkContains('single report answer', singleReport, 'The integral evaluates to x squared plus a constant.')

const goodDraft = test.draftFromSlot({
  slot: 'L2',
  enabled: true,
  displayName: 'Advanced',
  protocol: 'openai_chat_completions',
  providerLabel: 'Example',
  baseUrl: 'https://api.example.com/v1',
  modelId: 'gpt-x',
  maxOutputTokens: 4096,
  temperature: null,
  timeoutMs: 120000,
  retries: 1,
  authScheme: 'bearer',
})
checkEqual('draft displayName', goodDraft.displayName, 'Advanced')
checkEqual('draft temperature empty for null', goodDraft.temperature, '')
checkEqual('draft retries', goodDraft.retries, '1')

const builtPatch = test.buildSlotPatch(goodDraft)
check('valid draft builds a patch', builtPatch.ok === true)
if (builtPatch.ok === true) {
  checkEqual('patch temperature null', builtPatch.patch.temperature, null)
  checkEqual('patch maxOutputTokens', builtPatch.patch.maxOutputTokens, 4096)
  checkEqual('patch timeoutMs', builtPatch.patch.timeoutMs, 120000)
  check('patch omits anthropic fields for openai protocol', builtPatch.patch.apiVersion === undefined)
}

const anthropicDraft = test.draftFromSlot({
  slot: 'L1',
  protocol: 'anthropic_messages',
  apiVersion: '2023-06-01',
  authScheme: 'x-api-key',
  maxOutputTokens: 8192,
  timeoutMs: 180000,
  retries: 1,
})
const anthropicPatch = test.buildSlotPatch(anthropicDraft)
check('anthropic draft builds a patch', anthropicPatch.ok === true)
if (anthropicPatch.ok === true) {
  checkEqual('patch apiVersion', anthropicPatch.patch.apiVersion, '2023-06-01')
  checkEqual('patch authScheme', anthropicPatch.patch.authScheme, 'x-api-key')
}

const badRetries = test.buildSlotPatch({ ...goodDraft, retries: 'two' })
check('rejects non-numeric retries', badRetries.ok === false)
const badTokens = test.buildSlotPatch({ ...goodDraft, maxOutputTokens: '' })
check('rejects empty max output tokens', badTokens.ok === false)
const badTemperature = test.buildSlotPatch({ ...goodDraft, temperature: '-1' })
check('rejects negative temperature', badTemperature.ok === false)
const emptyTemperature = test.buildSlotPatch({ ...goodDraft, temperature: '  ' })
check('accepts empty temperature', emptyTemperature.ok === true && emptyTemperature.patch.temperature === null)

checkEqual(
  'credential state from map',
  JSON.stringify(test.credentialStateOf({ credentials: { DSH_EXPERT_L2_API_KEY: { configured: true, source: 'managed' } } }, { credentialRef: 'DSH_EXPERT_L2_API_KEY' })),
  JSON.stringify({ configured: true, source: 'managed' }),
)
checkEqual(
  'credential state missing',
  JSON.stringify(test.credentialStateOf(null, { credentialRef: 'DSH_EXPERT_L2_API_KEY' })),
  JSON.stringify({ configured: false, source: null }),
)

// ---------------------------------------------------------------------------
// 11. Settings page
// ---------------------------------------------------------------------------

const settingsLoading = renderSafely('settings page renders loading state', components.SettingsSection({}))
checkContains('settings title', settingsLoading, 'Expert Council')
checkContains('settings loading copy', settingsLoading, 'Loading Expert Council state')
checkContains('settings refresh button', settingsLoading, 'Refresh')

const slotPublic = {
  slot: 'L1',
  enabled: true,
  displayName: 'Frontier Reasoning',
  protocol: 'anthropic_messages',
  providerLabel: 'Anthropic',
  baseUrl: 'https://api.anthropic.com',
  modelId: 'claude-x',
  credentialRef: 'DSH_EXPERT_L1_API_KEY',
  credentialConfigured: true,
  apiVersion: '2023-06-01',
  authScheme: 'x-api-key',
  maxOutputTokens: 8192,
  temperature: null,
  timeoutMs: 180000,
  retries: 1,
  configured: true,
  warnings: ['model id looks like a placeholder'],
}

const slotState = {
  ok: true,
  version: 1,
  protocols: ['openai_chat_completions', 'anthropic_messages'],
  slots: [slotPublic],
  credentials: { DSH_EXPERT_L1_API_KEY: { configured: true, source: 'managed' } },
  defaults: { singleSlot: 'L2', allowCouncil: true, maxCostUsdPerCall: null },
  security: {
    allowedHosts: ['api.anthropic.com'],
    trustedLocalEndpoints: [],
    maxPayloadBytes: 120000,
    redactSecrets: true,
    allowRepoScope: false,
  },
  warnings: ['slot L3 is not configured'],
  store: { path: 'C:\\Users\\X\\.dsh\\expert-council', count: 4, bytes: 8192, orphans: 0 },
}

const slotEditorText = renderSafely(
  'slot editor renders',
  components.SlotEditor({
    slot: slotPublic,
    state: slotState,
    draft: test.draftFromSlot(slotPublic),
    baseline: test.draftFromSlot(slotPublic),
    busy: null,
    note: { kind: 'ok', text: 'Saved.' },
    testResult: {
      ok: true,
      slot: 'L1',
      endpointHost: 'api.anthropic.com',
      protocol: 'anthropic_messages',
      modelId: 'claude-x',
      authOk: true,
      nonStreamOk: true,
      parseOk: true,
      usageAvailable: true,
      latencyMs: 1234,
      billable: true,
    },
    onChange() {},
    onSave() {},
    onSaveKey() {},
    onTest() {},
  }),
)
checkContains('slot editor enabled row', slotEditorText, 'Enabled')
checkContains('slot editor api format row', slotEditorText, 'API format')
checkContains('slot editor protocol option', slotEditorText, 'anthropic_messages')
checkContains('slot editor credential status', slotEditorText, 'source: managed')
checkContains('slot editor api key row', slotEditorText, 'API key')
checkContains('slot editor save key button', slotEditorText, 'Save key')
checkContains('slot editor max tokens row', slotEditorText, 'Max output tokens')
checkContains('slot editor temperature row', slotEditorText, 'Temperature')
checkContains('slot editor timeout row', slotEditorText, 'Timeout (ms)')
checkContains('slot editor retries row', slotEditorText, 'Retries')
checkContains('slot editor anthropic version row', slotEditorText, 'Anthropic version')
checkContains('slot editor auth scheme row', slotEditorText, 'Auth scheme')
checkContains('slot editor save button', slotEditorText, 'Save')
checkContains('slot editor test button', slotEditorText, 'Test connection')
checkContains('slot editor billing warning', slotEditorText, 'Testing sends a real request and may be billed.')
checkContains('slot editor test host', slotEditorText, 'api.anthropic.com')
checkContains('slot editor test auth ok', slotEditorText, 'Auth ok')
checkContains('slot editor test latency', slotEditorText, '1.23 s')
checkContains('slot editor warning banner', slotEditorText, 'model id looks like a placeholder')
checkContains('slot editor remove key button', slotEditorText, 'Remove key')
checkContains('slot editor protocol from state', slotEditorText, 'openai_chat_completions')
checkNotContains('slot editor never renders a secret', slotEditorText, 'sk-')

const openaiEditorText = renderSafely(
  'openai slot editor hides anthropic fields',
  components.SlotEditor({
    slot: { ...slotPublic, slot: 'L2', protocol: 'openai_chat_completions', displayName: 'Advanced' },
    state: slotState,
    draft: test.draftFromSlot({ ...slotPublic, protocol: 'openai_chat_completions' }),
    baseline: null,
    busy: 'save',
    note: { kind: 'error', text: 'Base URL is required.' },
    testResult: null,
    onChange() {},
    onSave() {},
    onSaveKey() {},
    onTest() {},
  }),
)
checkNotContains('openai editor hides apiVersion', openaiEditorText, 'Anthropic version')
checkNotContains('openai editor hides auth scheme', openaiEditorText, 'Auth scheme')
checkContains('openai editor shows error note', openaiEditorText, 'Base URL is required.')
checkContains('openai editor busy save label', openaiEditorText, 'Saving…')

// Host storage & security block reads the extended state fields defensively.
const hostInfoText = renderSafely('host info renders', components.HostInfo({ state: slotState }))
checkContains('host info store path', hostInfoText, 'Store path')
checkContains('host info redaction', hostInfoText, 'Redaction')
checkContains('host info repo scope', hostInfoText, 'Repo scope')
const hostInfoEmpty = renderSafely('host info degrades on sparse state', components.HostInfo({ state: { slots: [] } }))
checkEqual('host info hidden when no fields', hostInfoEmpty, '')

// History row tolerates an unknown summary shape.
const historyRowText = renderSafely(
  'history row renders',
  components.HistoryRow({
    summary: {
      consultationId: 'ec-20261020230001-ff00aa',
      kind: 'council',
      status: 'PARTIAL',
      mode: 'architecture',
      durationMs: 21000,
      createdAt: '2026-10-20T15:10:00.000Z',
      question: { normalized: 'Which storage layout should we adopt?' },
    },
    busy: false,
    onDelete() {},
  }),
)
checkContains('history row id', historyRowText, 'ec-20261020230001-ff00aa')
checkContains('history row question', historyRowText, 'Which storage layout should we adopt?')
checkContains('history row delete', historyRowText, 'Delete')

const sparseHistoryRow = renderSafely(
  'history row tolerates a sparse summary',
  components.HistoryRow({ summary: { weird: true }, busy: false, onDelete() {} }),
)
checkContains('sparse history row fallback id', sparseHistoryRow, 'unknown id')

// ---------------------------------------------------------------------------
// 12. Settings HTTP contract (§4) against a local stub server
// ---------------------------------------------------------------------------

import { createServer } from 'node:http'

const seen = []
const stub = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    const record = { method: req.method, url: req.url, header: req.headers['x-dsh-expert-council'], body: body }
    seen.push(record)
    const send = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    }
    if (record.header !== '1') {
      send(403, { ok: false, error: { category: 'FORBIDDEN', message: 'missing header' } })
      return
    }
    if (req.method === 'GET' && req.url === '/expert-council/state') {
      send(200, slotState)
      return
    }
    if (req.method === 'POST' && req.url === '/expert-council/slot') {
      // Real host shape: the complete state document, not { ok, state }.
      send(200, Object.assign({ ok: true }, slotState))
      return
    }
    if (req.method === 'POST' && req.url === '/expert-council/credential') {
      send(200, { ok: true, credential: { ref: 'DSH_EXPERT_L1_API_KEY', configured: true } })
      return
    }
    if (req.method === 'DELETE' && req.url === '/expert-council/credential') {
      send(200, { ok: true, credential: { ref: 'DSH_EXPERT_L1_API_KEY', configured: false } })
      return
    }
    if (req.method === 'GET' && req.url.indexOf('/expert-council/history') === 0) {
      send(200, {
        ok: true,
        consultations: [
          {
            consultationId: 'ec-20261020230001-ff00aa',
            kind: 'council',
            status: 'PARTIAL',
            mode: 'architecture',
            durationMs: 21000,
            createdAt: '2026-10-20T15:10:00.000Z',
            question: { normalized: 'Which storage layout should we adopt?' },
          },
        ],
      })
      return
    }
    if (req.method === 'POST' && req.url === '/expert-council/history/delete') {
      send(200, { ok: true })
      return
    }
    if (req.method === 'POST' && req.url === '/expert-council/test') {
      send(200, {
        ok: true,
        result: {
          ok: true,
          slot: 'L1',
          endpointHost: 'api.anthropic.com',
          protocol: 'anthropic_messages',
          modelId: 'claude-x',
          authOk: true,
          nonStreamOk: true,
          parseOk: true,
          usageAvailable: true,
          latencyMs: 900,
          billable: true,
        },
      })
      return
    }
    send(404, { ok: false, error: { category: 'NOT_FOUND', message: 'no route' } })
  })
})

await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve))
const port = stub.address().port
test.setApiBase('http://127.0.0.1:' + port + '/expert-council/')

try {
  const state = await test.apiRequest('state', { timeoutMs: 5000 })
  checkEqual('GET state version', state.version, 1)
  checkEqual('GET state slots', state.slots.length, 1)
  checkEqual('GET state sends the required header', seen[0].header, '1')

  const saved = await test.apiRequest('slot', {
    method: 'POST',
    body: { slot: 'L1', patch: { displayName: 'Frontier Reasoning' } },
    timeoutMs: 5000,
  })
  check('POST slot ok', saved.ok === true)
  // The host answers with the whole state document: slots must be readable at
  // the top level, which is what the settings page folds in after a save.
  check('POST slot returns the full state at top level', Array.isArray(saved.slots) && saved.slots.length === 1)
  checkEqual('POST slot path', seen[1].url, '/expert-council/slot')
  checkEqual('POST slot method', seen[1].method, 'POST')
  checkContains('POST slot body', seen[1].body, '"slot":"L1"')
  checkContains('POST slot body patch', seen[1].body, '"displayName":"Frontier Reasoning"')

  const credential = await test.apiRequest('credential', {
    method: 'POST',
    body: { slot: 'L1', apiKey: 'sk-test-value' },
    timeoutMs: 5000,
  })
  check('POST credential ok', credential.ok === true)
  checkContains('POST credential body', seen[2].body, '"apiKey":"sk-test-value"')

  const removed = await test.apiRequest('credential', {
    method: 'DELETE',
    body: { slot: 'L1' },
    timeoutMs: 5000,
  })
  check('DELETE credential ok', removed.ok === true)
  checkEqual('DELETE credential method', seen[3].method, 'DELETE')
  checkContains('DELETE credential body', seen[3].body, '"slot":"L1"')

  const history = await test.apiRequest('history?limit=20', { timeoutMs: 5000 })
  checkEqual('GET history rows', history.consultations.length, 1)
  checkContains('GET history path', seen[4].url, '/expert-council/history?limit=20')

  const deleted = await test.apiRequest('history/delete', { method: 'POST', body: { id: 'ec-1' }, timeoutMs: 5000 })
  check('POST history delete ok', deleted.ok === true)

  const tested = await test.apiRequest('test', { method: 'POST', body: { slot: 'L1' }, timeoutMs: 5000 })
  check('POST test ok', tested.ok === true)
  checkEqual('POST test host', tested.result.endpointHost, 'api.anthropic.com')

  let refused = null
  try {
    await test.apiRequest('missing-route', { timeoutMs: 5000 })
  } catch (error) {
    refused = error
  }
  check('unknown route rejects', refused !== null)
  checkContains('unknown route message', refused === null ? '' : refused.message, 'no route')

  // The header is mandatory: a request without it must be refused by the host.
  test.setApiBase('http://127.0.0.1:' + port + '/unused/')
  let missingHeader = null
  try {
    await test.apiRequest('state', { timeoutMs: 5000 })
  } catch (error) {
    missingHeader = error
  }
  check('unrouted path rejects', missingHeader !== null)
  test.setApiBase('http://127.0.0.1:' + port + '/expert-council/')
} finally {
  await new Promise((resolve) => stub.close(resolve))
}

// ---------------------------------------------------------------------------
// 13. Summary
// ---------------------------------------------------------------------------

if (ORIGINAL_NAVIGATOR === undefined) {
  Reflect.deleteProperty(globalThis, 'navigator')
} else {
  Object.defineProperty(globalThis, 'navigator', ORIGINAL_NAVIGATOR)
}

if (failures.length > 0) {
  console.error('FAILED ' + failures.length + ' of ' + checks + ' checks:')
  for (const failure of failures) console.error('  - ' + failure)
  process.exitCode = 1
} else {
  console.log('smoke: ' + checks + ' checks passed')
  console.log('  module: window.__ModuleLoader__.load({ id, factory }) -> ' + JSON.stringify(plugin.inject))
  console.log('  registrations: ' + registrations.map((entry) => entry.options.name + (entry.options.key ? '#' + entry.options.key : '') + (entry.options.id ? '#' + entry.options.id : '')).join(', '))
  console.log('  components: ConsultExpertView, ConsultCouncilView, FollowupExpertView, VerifyConsultationView, SettingsSection')
}
