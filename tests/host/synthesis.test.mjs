import test from 'node:test'
import assert from 'node:assert/strict'

import { aggregateCouncil } from '../../plugin/src/host/consultation.js'
import { buildBrief, briefHash, routeSingle, MODES } from '../../plugin/src/host/brief.js'

function slot(slotId, status, answer, extra = {}) {
  return {
    slot: slotId,
    displayName: slotId,
    status,
    answer,
    modelId: `model-${slotId}`,
    protocol: 'openai_chat_completions',
    providerLabel: 'p',
    durationMs: 10,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null, cacheReadTokens: null, reasoningTokens: null },
    ...extra,
  }
}

test('aggregateCouncil counts COMPLETE-style 3/3, PARTIAL-style 2/3 and FAILED-style 0/3', () => {
  const three = aggregateCouncil([slot('L1', 'SUCCESS', 'a'), slot('L2', 'SUCCESS', 'b'), slot('L3', 'SUCCESS', 'c')])
  assert.deepEqual(three.counts, { success: 3, requested: 3 })
  assert.deepEqual(three.succeeded, ['L1', 'L2', 'L3'])

  const two = aggregateCouncil([slot('L1', 'SUCCESS', 'a'), slot('L2', 'SUCCESS', 'b'), slot('L3', 'ERROR', undefined)])
  assert.deepEqual(two.counts, { success: 2, requested: 3 })
  assert.deepEqual(two.failed, ['L3'])

  const none = aggregateCouncil([slot('L1', 'ERROR', undefined), slot('L2', 'TIMEOUT', undefined), slot('L3', 'UNCONFIGURED', undefined)])
  assert.deepEqual(none.counts, { success: 0, requested: 3 })
  assert.deepEqual(none.absent, ['L3'])
})

test('absent slots are reported separately from failed ones', () => {
  const result = aggregateCouncil([
    slot('L1', 'SUCCESS', 'answer'),
    slot('L2', 'UNCONFIGURED', undefined),
    slot('L3', 'DISABLED', undefined),
  ])
  assert.deepEqual(result.absent, ['L2', 'L3'])
  assert.deepEqual(result.failed, [])
})

test('overlap is lexical and only reports tokens seen in more than one answer', () => {
  const result = aggregateCouncil([
    slot('L1', 'SUCCESS', 'The yield stress sigma_y = 250 MPa, and the eigenvalue lambda_1 is 3.14.'),
    slot('L2', 'SUCCESS', 'I get sigma_y = 250 MPa too, with lambda_1 = 3.14 as well.'),
    slot('L3', 'SUCCESS', 'Entirely different: use a phase-field approach with h = 0.02 mm.'),
  ])
  const tokens = result.overlap.map((entry) => entry.token)
  assert.ok(tokens.includes('250'))
  assert.ok(tokens.includes('3.14'))
  assert.ok(tokens.includes('sigma_y'))
  for (const entry of result.overlap) {
    assert.ok(entry.slots.length >= 2)
  }
  // The single-answer-only token must not be claimed as overlap.
  assert.equal(tokens.includes('0.02'), false)
})

test('uniqueBySlot lists what only one answer contains', () => {
  const result = aggregateCouncil([
    slot('L1', 'SUCCESS', 'Consider the J-integral and the cohesive_zone model.'),
    slot('L2', 'SUCCESS', 'Consider the J-integral.'),
    slot('L3', 'SUCCESS', 'Consider the J-integral.'),
  ])
  const l1 = result.uniqueBySlot.find((entry) => entry.slot === 'L1')
  assert.ok(l1.items.some((item) => item.includes('cohesive')))
  const l2 = result.uniqueBySlot.find((entry) => entry.slot === 'L2')
  assert.deepEqual(l2.items, [])
})

test('the aggregate carries the "lexical, not semantic" caveat in every payload', () => {
  const result = aggregateCouncil([slot('L1', 'SUCCESS', 'x'), slot('L2', 'SUCCESS', 'y')])
  assert.match(result.note, /Lexical overlap only/)
  assert.match(result.note, /agreement is not correctness/)
})

test('aggregateCouncil does not crash on a single successful slot or on empty answers', () => {
  assert.doesNotThrow(() => aggregateCouncil([slot('L1', 'SUCCESS', 'only one')]))
  const result = aggregateCouncil([slot('L1', 'SUCCESS', ''), slot('L2', 'SUCCESS', '')])
  assert.deepEqual(result.overlap, [])
  assert.deepEqual(result.answerLengths, [{ slot: 'L1', chars: 0 }, { slot: 'L2', chars: 0 }])
})

test('buildBrief freezes the same normalized question for every slot', () => {
  const brief = buildBrief({ question: '  Is E = mc^2 dimensionally consistent?  ', mode: 'physics_review', context: 'units in SI', evidence: 'E[J], m[kg]', requestedOutput: 'verdict' })
  assert.equal(brief.question, 'Is E = mc^2 dimensionally consistent?')
  assert.ok(brief.normalized.includes('## Central question'))
  assert.ok(brief.normalized.includes('Dimensional analysis'), 'physics mode must ask for dimensional analysis')
  assert.ok(brief.normalized.includes('Falsifiable test') || brief.normalized.includes('falsifiable test'))
  assert.equal(briefHash(brief), briefHash(buildBrief({ question: 'Is E = mc^2 dimensionally consistent?', mode: 'physics_review', context: 'units in SI', evidence: 'E[J], m[kg]', requestedOutput: 'verdict' })))
})

test('an unknown mode falls back to general rather than failing', () => {
  const brief = buildBrief({ question: 'q', mode: 'astrology' })
  assert.equal(brief.mode, 'general')
  assert.equal(MODES.includes(brief.mode), true)
})

test('routeSingle never upgrades everything to L1', () => {
  assert.equal(routeSingle({ risk: 'low', complexity: 'low', mode: 'general' }, { singleSlot: 'L2' }).slot, 'L3')
  assert.equal(routeSingle({ risk: 'high', complexity: 'high', mode: 'debug' }, { singleSlot: 'L2' }).slot, 'L1')
  assert.equal(routeSingle({ risk: 'medium', complexity: 'medium', mode: 'general' }, { singleSlot: 'L2' }).slot, 'L2')
  assert.equal(routeSingle({ mode: 'math_review' }, { singleSlot: 'L2' }).slot, 'L2')
  assert.equal(routeSingle({ mode: 'physics_review', risk: 'high' }, { singleSlot: 'L2' }).slot, 'L1')
})

test('routeSingle falls back to the configured default slot', () => {
  assert.equal(routeSingle({ risk: 'medium', complexity: 'low', mode: 'general' }, { singleSlot: 'L3' }).slot, 'L3')
  assert.equal(routeSingle({}, {}).slot, 'L2')
})

test('routeSingle records the policy that produced the decision', () => {
  const routed = routeSingle({ risk: 'high', complexity: 'high', mode: 'architecture' }, { singleSlot: 'L2' })
  assert.match(routed.policy, /L1/)
  assert.equal(routed.slot, 'L1')
})
