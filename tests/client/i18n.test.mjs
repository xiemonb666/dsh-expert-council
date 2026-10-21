// Localization acceptance test for plugin/client.js.
//
// The Expert Council UI must be bilingual through the host's own locale service
// (`ctx.locale`), not through hardcoded Chinese. This test proves that from four
// angles, none of which trusts the implementer's own report:
//
//   1. STRUCTURE — the file exposes both dictionaries and registers both locales.
//   2. COVERAGE  — every `t('...')` key used in the source exists in both
//                  dictionaries, and neither dictionary has orphan keys.
//   3. QUALITY   — key sets match, `{placeholder}` sets match, the English
//                  dictionary holds no CJK, the Chinese one actually is Chinese.
//   4. BEHAVIOUR — rendering the same card with an English and a Chinese locale
//                  produces different, correctly-localized text.
//
// It loads client.js exactly like the browser does (fake `window.__ModuleLoader__`
// plus a fake `require('react')`), so it needs no DOM, bundler or Harness runtime.
//
// Run with: node --test tests/client/i18n.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT_PATH = resolve(HERE, '../../plugin/client.js')
const SOURCE = readFileSync(CLIENT_PATH, 'utf8')

const NAMESPACE = 'dsh-expert-council'

// ---------------------------------------------------------------------------
// Fake React: enough surface to walk a rendered element tree.
// ---------------------------------------------------------------------------

const FRAGMENT = Symbol.for('react.fragment')

function createElement(type, config, ...children) {
  const props = Object.assign({}, config === null || config === undefined ? {} : config)
  if (children.length === 1) props.children = children[0]
  else if (children.length > 1) props.children = children
  return { type, props }
}

function makeReact() {
  return {
    createElement,
    Fragment: FRAGMENT,
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
    useCallback(fn) {
      return fn
    },
    memo(component) {
      return component
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      return getSnapshot()
    },
  }
}

// ---------------------------------------------------------------------------
// Fake locale service: mimics the real lookup (namespace → fallback → common → key).
// ---------------------------------------------------------------------------

function makeLocaleService() {
  const dictionaries = new Map() // `${ns}\u0000${locale}` -> dict
  const listeners = new Set()
  let active = 'en'
  let revision = 0

  function lookup(ns, locale, key, params) {
    const chain = locale === 'zh' ? ['zh', 'en'] : ['en']
    for (const candidate of chain) {
      const dict = dictionaries.get(`${ns}\u0000${candidate}`)
      if (dict !== undefined && typeof dict[key] === 'string') return interpolate(dict[key], params)
    }
    const common = dictionaries.get(`common\u0000${locale}`)
    if (common !== undefined && typeof common[key] === 'string') return interpolate(common[key], params)
    return key
  }

  function interpolate(template, params) {
    if (params === null || params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
  }

  const service = {
    dictionaries,
    get active() {
      return active
    },
    get revision() {
      return revision
    },
    setLocale(id) {
      active = id
      revision += 1
      for (const listener of [...listeners]) listener()
    },
    getLocale() {
      return { active, locales: [{ id: 'en', label: 'English' }, { id: 'zh', label: '中文' }], revision }
    },
    getSnapshot() {
      return service.getLocale()
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    addLanguage(input) {
      return () => undefined
    },
    register(ns, locale, dict) {
      if (arguments.length === 2) {
        // Typed form: register(ns, { zh, en })
        const byLocale = locale
        for (const [id, entries] of Object.entries(byLocale)) dictionaries.set(`${ns}\u0000${id}`, entries)
        revision += 1
        for (const listener of [...listeners]) listener()
        return () => undefined
      }
      const key = `${ns}\u0000${locale}`
      if (dictionaries.has(key)) throw new Error(`duplicate dictionary ${ns}/${locale}`)
      dictionaries.set(key, dict)
      revision += 1
      for (const listener of [...listeners]) listener()
      return () => dictionaries.delete(key)
    },
    bind(ns) {
      return (key, params) => lookup(ns, active, key, params)
    },
    resolveText(text) {
      return typeof text === 'string' ? text : text?.en ?? ''
    },
  }
  return service
}

// ---------------------------------------------------------------------------
// Load the module once; build a fresh plugin instance per locale.
// ---------------------------------------------------------------------------

const loaded = []
const fakeWindow = {
  __ModuleLoader__: {
    load(definition) {
      loaded.push(definition)
    },
  },
}

// The environment is pinned to an English browser for the tests that assert the
// English fallback. Without a locale service the plugin picks its fallback
// dictionary from `navigator`, and Node reports the host machine's locale, which
// would otherwise make the suite depend on whoever runs it. The Chinese
// browser-fallback path is exercised explicitly below by re-pinning it.
const ORIGINAL_NAVIGATOR = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
function pinBrowser(languages) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: { language: languages[0], languages },
  })
}
pinBrowser(['en-US', 'en'])

new Function('window', SOURCE)(fakeWindow)

const React = makeReact()
const requireStub = (request) => {
  if (request === 'react') return React
  throw new Error('unexpected require: ' + request)
}

function instantiate({ withLocale = true } = {}) {
  assert.equal(loaded.length, 1, 'client.js must call __ModuleLoader__.load exactly once')
  const definition = loaded[0]
  const module = definition.factory(requireStub)
  assert.ok(module && typeof module.apply === 'function', 'factory must return { inject, apply }')

  const locale = makeLocaleService()
  const registrations = []
  const effects = []

  const ctx = {
    effect(fn, label) {
      const dispose = fn()
      effects.push({ label, dispose })
      return dispose
    },
    get(name) {
      if (name === 'locale' && withLocale) return locale
      return undefined
    },
    on() {
      return () => undefined
    },
    slots: {
      inject(slotName, callback) {
        return callback()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => undefined
      },
    },
    locale: withLocale ? locale : undefined,
  }

  module.apply(ctx)

  return { module, locale, registrations, effects, ctx }
}

// ---------------------------------------------------------------------------
// Render an element tree to plain text.
// ---------------------------------------------------------------------------

function collectText(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out)
    return out
  }
  if (typeof node === 'object' && node.props !== undefined) {
    if (typeof node.type === 'function') {
      const rendered = node.type(node.props)
      collectText(rendered, out)
      return out
    }
    if (typeof node.type === 'symbol') {
      collectText(node.props.children, out)
      return out
    }
    collectText(node.props.children, out)
  }
  return out
}

function renderText(component, props) {
  return collectText(component(props)).join('\n')
}

// ---------------------------------------------------------------------------
// The consultation metadata fixture the cards consume.
// ---------------------------------------------------------------------------

function fixtureMeta(kind = 'single') {
  const slot = {    slot: 'L2',
    displayName: 'Advanced Reasoning',
    protocol: 'openai_chat_completions',
    providerLabel: 'Acme',
    endpointHost: 'api.example.com',
    modelId: 'model-x',
    status: 'SUCCESS',
    startedAt: '2026-10-20T16:18:24.000Z',
    durationMs: 1234,
    attempts: 1,
    requestId: 'req-1',
    finishReason: 'stop',
    usage: { inputTokens: 321, outputTokens: 123, totalTokens: 444, cacheReadTokens: null, reasoningTokens: null },
    cost: { estimatedUsd: 0.0123, source: 'estimated' },
    answer: 'The formula is dimensionally consistent.',
    capabilities: { nonStream: true },
    requestSent: { system: 'be precise', user: 'Is it consistent?', hash: 'abc123', bytes: 42 },
    redactionDiff: { originalBytes: 50, sentBytes: 42, rules: ['api-key'] },
  }
  const base = {
    version: 1,
    kind,
    consultationId: 'ec-20261020161824-aa6e68',
    createdAt: '2026-10-20T16:18:24.000Z',
    durationMs: 1234,
    status: 'COMPLETE',
    mode: 'physics_review',
    reason: 'independent check',
    requestedOutput: 'verdict',
    requester: { agentId: 'agent-1', sessionId: 'session-1', tool: 'consult_expert' },
    routing: { requestedSlot: 'L2', autoRouted: false, policy: 'explicit' },
    privacy: { redactions: 1, appliedRules: ['api-key'], externalBytes: 42, truncated: false },
    question: { normalized: 'Is F = m*a consistent?', context: '', evidence: '', hash: 'abc123' },
    slots: [slot],
    diagnostics: { notes: ['HOST-DIAG-NOTE: council consultations are disabled by defaults.allowCouncil'] },
  }
  if (kind === 'council') {
    base.slots = [slot, { ...slot, slot: 'L3', displayName: 'Core Reasoning' }]
    base.synthesis = {
      requested: ['L2', 'L3'],
      succeeded: ['L2', 'L3'],
      failed: [],
      absent: [],
      counts: { success: 2, requested: 2 },
      overlap: [{ token: '444', kind: 'number', slots: ['L2', 'L3'] }],
      uniqueBySlot: [{ slot: 'L2', items: ['dimensionally'] }],
      answerLengths: [{ slot: 'L2', chars: 42 }],
      note: 'Lexical overlap only: these tokens appear in more than one answer.',
    }
  }
  return base
}

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

function hasCjk(value) {
  return CJK.test(value)
}

// ---------------------------------------------------------------------------
// 1. Structure
// ---------------------------------------------------------------------------

test('client.js exposes both dictionaries through the test seam', () => {
  const { module } = instantiate()
  const messages = module.__test?.messages
  assert.ok(messages, 'expected __test.messages so localization can be verified')
  assert.equal(typeof messages.en, 'object')
  assert.equal(typeof messages.zh, 'object')
  assert.equal(messages.namespace, NAMESPACE)
  assert.ok(Object.keys(messages.en).length > 100, `expected a substantial English dictionary, got ${Object.keys(messages.en).length} keys`)
})

test('apply() registers both locales for the plugin namespace', () => {
  const { locale } = instantiate()
  const en = locale.dictionaries.get(`${NAMESPACE}\u0000en`)
  const zh = locale.dictionaries.get(`${NAMESPACE}\u0000zh`)
  assert.ok(en, 'the English dictionary must be registered with ctx.locale.register')
  assert.ok(zh, 'the Chinese dictionary must be registered with ctx.locale.register')
  assert.ok(Object.keys(en).length > 100)
  assert.ok(Object.keys(zh).length > 100)
})

test('the settings section label is a thunk so it follows the active locale', () => {
  const { registrations, locale } = instantiate()
  const section = registrations.find((entry) => entry.options?.name === 'settings.section')
  assert.ok(section, 'the settings.section entry must be registered')
  assert.equal(typeof section.options.label, 'function', 'label must be a thunk, not a frozen string')

  locale.setLocale('en')
  const englishLabel = section.options.label()
  locale.setLocale('zh')
  const chineseLabel = section.options.label()
  assert.notEqual(englishLabel, chineseLabel, 'the nav label must change with the locale')
  assert.equal(hasCjk(chineseLabel), true, 'the Chinese nav label must contain Chinese')
})

// ---------------------------------------------------------------------------
// 2. Coverage
// ---------------------------------------------------------------------------

test('every t(...) key used in the source exists in both dictionaries', () => {
  const { module } = instantiate()
  const { en, zh } = module.__test.messages

  const used = new Set()
  const re = /\bt\(\s*'([^']+)'/g
  let match
  while ((match = re.exec(SOURCE)) !== null) used.add(match[1])
  // Also catch double-quoted call sites.
  const reDouble = /\bt\(\s*"([^"]+)"/g
  while ((match = reDouble.exec(SOURCE)) !== null) used.add(match[1])

  assert.ok(used.size > 100, `expected the source to use a substantial key set, found ${used.size}`)

  const missingEn = [...used].filter((key) => typeof en[key] !== 'string')
  const missingZh = [...used].filter((key) => typeof zh[key] !== 'string')
  assert.deepEqual(missingEn, [], `keys missing from the English dictionary: ${missingEn.join(', ')}`)
  assert.deepEqual(missingZh, [], `keys missing from the Chinese dictionary: ${missingZh.join(', ')}`)
})

test('neither dictionary has orphan keys the source never uses', () => {
  const { module } = instantiate()
  const { en, zh } = module.__test.messages

  const used = new Set()
  for (const pattern of [/\bt\(\s*'([^']+)'/g, /\bt\(\s*"([^"]+)"/g]) {
    let match
    while ((match = pattern.exec(SOURCE)) !== null) used.add(match[1])
  }

  const orphanEn = Object.keys(en).filter((key) => !used.has(key))
  const orphanZh = Object.keys(zh).filter((key) => !used.has(key))
  assert.deepEqual(orphanEn, [], `unused English keys: ${orphanEn.join(', ')}`)
  assert.deepEqual(orphanZh, [], `unused Chinese keys: ${orphanZh.join(', ')}`)
})

// ---------------------------------------------------------------------------
// 3. Quality
// ---------------------------------------------------------------------------

test('both dictionaries declare exactly the same key set', () => {
  const { module } = instantiate()
  const { en, zh } = module.__test.messages
  const enKeys = Object.keys(en).sort()
  const zhKeys = Object.keys(zh).sort()
  assert.deepEqual(enKeys, zhKeys)
})

test('interpolation placeholders match between English and Chinese', () => {
  const { module } = instantiate()
  const { en, zh } = module.__test.messages
  const placeholder = /\{(\w+)\}/g
  const mismatches = []
  for (const key of Object.keys(en)) {
    const enSet = new Set([...String(en[key]).matchAll(placeholder)].map((m) => m[1]))
    const zhSet = new Set([...String(zh[key]).matchAll(placeholder)].map((m) => m[1]))
    const onlyEn = [...enSet].filter((name) => !zhSet.has(name))
    const onlyZh = [...zhSet].filter((name) => !enSet.has(name))
    if (onlyEn.length > 0 || onlyZh.length > 0) mismatches.push(`${key} (en-only: ${onlyEn.join(',') || '-'}; zh-only: ${onlyZh.join(',') || '-'})`)
  }
  assert.deepEqual(mismatches, [])
})

test('the English dictionary contains no Chinese characters', () => {
  const { module } = instantiate()
  const { en } = module.__test.messages
  const offenders = Object.entries(en).filter(([, value]) => hasCjk(String(value))).map(([key]) => key)
  assert.deepEqual(offenders, [], `English entries containing CJK: ${offenders.join(', ')}`)
})

test('the Chinese dictionary is actually translated, not copied English', () => {
  const { module } = instantiate()
  const { en, zh } = module.__test.messages
  // Values that are legitimately identical: pure technical tokens, ids, symbols.
  const TECHNICAL = /^(?:[A-Za-z0-9_.:/{}\s·—-]*|L[123]|OK|API|URL|ID|JSON|HTTP|Anthropic Messages|\[OI\] Chat Completions)$/
  const untranslated = []
  for (const key of Object.keys(en)) {
    const enValue = String(en[key])
    const zhValue = String(zh[key])
    if (enValue === zhValue && !TECHNICAL.test(enValue)) untranslated.push(`${key}: "${enValue}"`)
  }
  assert.deepEqual(untranslated, [], `Chinese entries identical to English: ${untranslated.join(' | ')}`)

  const chineseCount = Object.values(zh).filter((value) => hasCjk(String(value))).length
  const ratio = chineseCount / Object.keys(zh).length
  assert.ok(ratio > 0.75, `expected most Chinese entries to contain Chinese, got ${(ratio * 100).toFixed(1)}%`)
})

test('no dictionary value is empty or a bare key', () => {
  const { module } = instantiate()
  const { en, zh } = module.__test.messages
  for (const [name, dict] of [['en', en], ['zh', zh]]) {
    const bad = Object.entries(dict)
      .filter(([key, value]) => typeof value !== 'string' || value.trim() === '' || value === key)
      .map(([key]) => key)
    assert.deepEqual(bad, [], `${name} entries that are empty or equal their key: ${bad.join(', ')}`)
  }
})

test('no Chinese text is hardcoded outside the Chinese dictionary', () => {
  // Everything the user reads must come from a dictionary entry, so any CJK
  // literal in the source outside the `zh` dictionary is a localization leak:
  // it would show Chinese to an English user, and it cannot be translated.
  const { module } = instantiate()
  const zhValues = new Set(Object.values(module.__test.messages.zh).map((value) => String(value)))

  // Find the span of the Chinese dictionary so its own literals are exempt.
  const start = SOURCE.indexOf('const MESSAGES_ZH')
  assert.ok(start >= 0, 'expected a MESSAGES_ZH dictionary declaration')
  // The dictionary ends at the first top-level closing brace after it; scan
  // forward to the matching brace by counting.
  let depth = 0
  let end = -1
  let opened = false
  for (let index = SOURCE.indexOf('{', start); index < SOURCE.length; index += 1) {
    const char = SOURCE[index]
    if (char === '{') {
      depth += 1
      opened = true
    } else if (char === '}') {
      depth -= 1
      if (opened && depth === 0) {
        end = index
        break
      }
    }
  }
  assert.ok(end > start, 'could not delimit the MESSAGES_ZH dictionary')

  const outside = SOURCE.slice(0, start) + SOURCE.slice(end + 1)
  const leaks = []
  const re = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g
  let match
  while ((match = re.exec(outside)) !== null) {
    const run = match[0]
    const line = outside.slice(0, match.index).split('\n').length
    leaks.push(`line ${line}: "${run}"`)
  }
  assert.deepEqual(leaks, [], `hardcoded Chinese found outside the zh dictionary: ${leaks.join(' | ')}`)

  // Sanity: the exemption really did cover the dictionary's own literals.
  assert.ok(zhValues.size > 100)
})

// ---------------------------------------------------------------------------
// 4. Behaviour: the same card renders differently per locale
// ---------------------------------------------------------------------------

test('a consultation card renders Chinese under zh and English under en', () => {
  const en = instantiate()
  en.locale.setLocale('en')
  const enView = en.registrations.find((entry) => entry.options?.key === 'consult_expert')
  assert.ok(enView, 'consult_expert card must be registered')
  const enText = renderText(enView.component, { phase: 'result', block: { meta: fixtureMeta('single'), content: [], isError: false } })
  assert.equal(hasCjk(enText), false, 'English rendering must contain no Chinese')

  const zh = instantiate()
  zh.locale.setLocale('zh')
  const zhView = zh.registrations.find((entry) => entry.options?.key === 'consult_expert')
  const zhText = renderText(zhView.component, { phase: 'result', block: { meta: fixtureMeta('single'), content: [], isError: false } })

  assert.equal(hasCjk(zhText), true, 'Chinese rendering must contain Chinese')
  assert.notEqual(enText, zhText)
  // The expert's own answer is data, not UI copy: it must survive verbatim.
  assert.ok(zhText.includes('The formula is dimensionally consistent.'), 'the model answer must not be translated')
})

test('the council card renders Chinese under zh, including the synthesis caveat', () => {
  const zh = instantiate()
  zh.locale.setLocale('zh')
  const view = zh.registrations.find((entry) => entry.options?.key === 'consult_council')
  assert.ok(view, 'consult_council card must be registered')
  const text = renderText(view.component, { phase: 'result', block: { meta: fixtureMeta('council'), content: [], isError: false } })

  assert.equal(hasCjk(text), true)
  assert.ok(text.includes('The formula is dimensionally consistent.'), 'the model answer must not be translated')

  // The caveat is UI copy: the card must render the localized wording. The
  // host's own English sentence may still appear as verbatim diagnostic data
  // (it is an audit record, not a label), but it must never be the only
  // wording a Chinese user gets.
  const zhMessages = zh.module.__test.messages.zh
  assert.ok(text.includes(zhMessages['card.synthesisNote']), 'the localized caveat must be rendered under zh')

  const hostNote = 'Lexical overlap only: these tokens appear in more than one answer.'
  if (text.includes(hostNote)) {
    assert.ok(
      text.includes(zhMessages['card.synthesisNote']),
      'when the verbatim host note is shown, the localized caveat must accompany it',
    )
  }
})

test('an expanded card keeps the host synthesis note verbatim for audit', () => {
  // Collapsed cards render no body, so an audit reader must be able to expand
  // and still find exactly what the host recorded. This guards against
  // localization quietly dropping the host's own wording.
  const { registrations, locale } = instantiate()
  locale.setLocale('zh')
  const view = registrations.find((entry) => entry.options?.key === 'consult_council')
  const hostNote = 'Lexical overlap only: these tokens appear in more than one answer.'
  const text = renderText(view.component, {
    callId: 'call-1',
    toolName: 'consult_council',
    phase: 'result',
    block: { meta: fixtureMeta('council'), content: [], isError: false },
    useDisclosure: () => ({ expanded: true, toggle() {} }),
  })
  assert.ok(text.includes(hostNote), 'the verbatim host note must survive in the expanded card')
  assert.ok(text.includes('HOST-DIAG-NOTE'), 'host diagnostics must survive verbatim')
})

test('the settings page renders Chinese under zh', () => {
  const zh = instantiate()
  zh.locale.setLocale('zh')
  const section = zh.registrations.find((entry) => entry.options?.name === 'settings.section')
  assert.ok(section)
  const text = renderText(section.component, { close() {} })
  assert.equal(hasCjk(text), true, 'the settings page must render Chinese copy under zh')
})

test('the settings page still renders under en without Chinese leaking in', () => {
  const en = instantiate()
  en.locale.setLocale('en')
  const section = en.registrations.find((entry) => entry.options?.name === 'settings.section')
  const text = renderText(section.component, { close() {} })
  assert.equal(hasCjk(text), false, 'English rendering of the settings page must contain no Chinese')
})

test('rendering works without a locale service at all (English fallback, never a bare key)', () => {
  const { registrations, module } = instantiate({ withLocale: false })
  const view = registrations.find((entry) => entry.options?.key === 'consult_expert')
  const text = renderText(view.component, { phase: 'result', block: { meta: fixtureMeta('single'), content: [], isError: false } })

  const { en } = module.__test.messages
  const bareKey = Object.keys(en).find((key) => text.includes(key))
  assert.equal(bareKey, undefined, `a raw dictionary key leaked into the UI: ${bareKey}`)
  assert.equal(hasCjk(text), false)
  assert.ok(text.length > 20, 'the card must still render something useful')
})

test('pending and failure phases are localized too', () => {
  const zh = instantiate()
  zh.locale.setLocale('zh')
  const view = zh.registrations.find((entry) => entry.options?.key === 'consult_expert')
  const pendingText = renderText(view.component, { phase: 'preparing', block: { phase: 'preparing', name: 'consult_expert', argsRaw: '{"question":"x"}', callId: 'call-1' } })
  assert.equal(hasCjk(pendingText), true, 'the pending row must be localized')

  const fallbackText = renderText(view.component, { phase: 'result', block: { content: [{ type: 'text', text: 'raw tool text' }], isError: true } })
  assert.equal(hasCjk(fallbackText), true, 'the fallback/failure card must be localized')
  assert.ok(fallbackText.includes('raw tool text'), 'the raw result text must survive verbatim')
})

// ---------------------------------------------------------------------------
// 5. Late locale attachment
//
// A client plugin activates as soon as its own `inject` list is satisfied, and
// the locale service is a separate client plugin that can register AFTERWARDS.
// This is the regression that shipped an English-only UI: the service was read
// once during apply(), got `undefined`, and the fallback was frozen forever.
// ---------------------------------------------------------------------------

/** Build a plugin instance whose locale service only appears after apply(). */
function instantiateWithLateLocale() {
  const definition = loaded[0]
  const module = definition.factory(requireStub)
  const registrations = []
  const effects = []
  const pendingInjects = []
  const locale = makeLocaleService()
  let localeAvailable = false

  const ctx = {
    effect(fn, label) {
      const dispose = fn()
      effects.push({ label, dispose })
      return dispose
    },
    // Before the service exists this must answer undefined, exactly like the
    // real host does for a not-yet-registered service.
    get(name) {
      if (name === 'locale') return localeAvailable ? locale : undefined
      return undefined
    },
    inject(names, callback) {
      // Record the request; the host runs it when the services arrive.
      pendingInjects.push({ names, callback })
      return { then: (resolve) => resolve() }
    },
    on() {
      return () => undefined
    },
    slots: {
      inject(slotName, callback) {
        return callback()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => undefined
      },
    },
  }

  module.apply(ctx)

  return {
    module,
    locale,
    registrations,
    effects,
    pendingInjects,
    // Simulate the locale plugin activating later.
    deliverLocale() {
      localeAvailable = true
      for (const entry of pendingInjects) {
        if (!entry.names.includes('locale')) continue
        entry.callback({ effect: ctx.effect, on: ctx.on, get: ctx.get, locale })
      }
    },
  }
}

test('a locale service that activates after the plugin still localizes the UI', () => {
  const instance = instantiateWithLateLocale()

  // At apply() time the service is absent: the plugin must still register its
  // slots (a missing locale must never take the whole plugin down).
  assert.ok(instance.registrations.length >= 5, 'slots must register even without a locale service')

  const view = instance.registrations.find((entry) => entry.options?.key === 'consult_expert')
  assert.ok(view)

  // The service arrives afterwards.
  instance.deliverLocale()
  instance.locale.setLocale('zh')

  const text = renderText(view.component, { phase: 'result', block: { meta: fixtureMeta('single'), content: [], isError: false } })
  assert.equal(hasCjk(text), true, 'after a late locale attach the card must render Chinese')
  assert.ok(text.includes('The formula is dimensionally consistent.'), 'the model answer must not be translated')
})

test('dictionaries are registered when the locale service arrives late', () => {
  const instance = instantiateWithLateLocale()
  instance.deliverLocale()
  const en = instance.locale.dictionaries.get(`${NAMESPACE}\u0000en`)
  const zh = instance.locale.dictionaries.get(`${NAMESPACE}\u0000zh`)
  assert.ok(en, 'the English dictionary must be registered on late attach')
  assert.ok(zh, 'the Chinese dictionary must be registered on late attach')
  assert.ok(Object.keys(zh).length > 100)
})

test('a late attach notifies already-mounted components so they re-render', () => {
  const instance = instantiateWithLateLocale()
  const view = instance.registrations.find((entry) => entry.options?.key === 'consult_expert')

  // Render once with no locale service: English fallback.
  const before = renderText(view.component, { phase: 'result', block: { meta: fixtureMeta('single'), content: [], isError: false } })
  assert.equal(hasCjk(before), false)

  // The service attaches and switches to Chinese.
  instance.deliverLocale()
  instance.locale.setLocale('zh')

  const after = renderText(view.component, { phase: 'result', block: { meta: fixtureMeta('single'), content: [], isError: false } })
  assert.equal(hasCjk(after), true, 'the next render must use the newly attached dictionaries')
  assert.notEqual(before, after)
})

test('switching locale after a late attach still re-renders (subscription works)', () => {
  const instance = instantiateWithLateLocale()
  instance.deliverLocale()

  instance.locale.setLocale('zh')
  const view = instance.registrations.find((entry) => entry.options?.key === 'consult_expert')
  const zhText = renderText(view.component, { phase: 'result', block: { meta: fixtureMeta('single'), content: [], isError: false } })
  assert.equal(hasCjk(zhText), true)

  instance.locale.setLocale('en')
  const enText = renderText(view.component, { phase: 'result', block: { meta: fixtureMeta('single'), content: [], isError: false } })
  assert.equal(hasCjk(enText), false, 'switching back to en must drop the Chinese copy')
})

// ---------------------------------------------------------------------------
// 6. Browser-language fallback
//
// When no locale service ever arrives, the plugin must still pick a sensible
// language instead of always showing English to a Chinese user.
// ---------------------------------------------------------------------------

test('without a locale service, a Chinese browser gets the Chinese dictionary', () => {
  pinBrowser(['zh-CN', 'zh', 'en'])
  try {
    const { registrations } = instantiate({ withLocale: false })
    const view = registrations.find((entry) => entry.options?.key === 'consult_expert')
    const text = renderText(view.component, { phase: 'result', block: { meta: fixtureMeta('single'), content: [], isError: false } })
    assert.equal(hasCjk(text), true, 'a Chinese browser must get Chinese copy even without a locale service')
    assert.ok(text.includes('The formula is dimensionally consistent.'), 'the model answer must not be translated')
  } finally {
    pinBrowser(['en-US', 'en'])
  }
})

test('without a locale service, an English browser still gets English', () => {
  pinBrowser(['en-GB', 'en'])
  try {
    const { registrations } = instantiate({ withLocale: false })
    const view = registrations.find((entry) => entry.options?.key === 'consult_expert')
    const text = renderText(view.component, { phase: 'result', block: { meta: fixtureMeta('single'), content: [], isError: false } })
    assert.equal(hasCjk(text), false)
  } finally {
    pinBrowser(['en-US', 'en'])
  }
})

test('a real locale service overrides the browser language', () => {
  // The host preference wins: a Chinese browser with the host set to English
  // must render English.
  pinBrowser(['zh-CN', 'zh'])
  try {
    const instance = instantiate()
    instance.locale.setLocale('en')
    const view = instance.registrations.find((entry) => entry.options?.key === 'consult_expert')
    const text = renderText(view.component, { phase: 'result', block: { meta: fixtureMeta('single'), content: [], isError: false } })
    assert.equal(hasCjk(text), false, 'the host locale service is authoritative over the browser')
  } finally {
    pinBrowser(['en-US', 'en'])
  }
})

// ---------------------------------------------------------------------------
// Regression: localization must not break the single-file packaging rule.
// ---------------------------------------------------------------------------

test('client.js is still a self-contained single file', () => {
  const requires = [...SOURCE.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1])
  const allowed = new Set(['react', 'react/jsx-runtime'])
  const unexpected = requires.filter((name) => !allowed.has(name))
  assert.deepEqual(unexpected, [], `unexpected require() calls: ${unexpected.join(', ')}`)

  assert.equal(/^\s*import\s/m.test(SOURCE), false, 'client.js must not contain ES import statements')
  assert.equal(/^\s*export\s/m.test(SOURCE), false, 'client.js must not contain ES export statements')
  assert.equal(/@deepseek-ai\//.test(SOURCE), false, 'client.js must not reference harness packages')
})
