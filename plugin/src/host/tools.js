/**
 * Tool definitions for the four Expert Council tools.
 *
 * The definitions are authored as plain objects rather than through
 * `defineTool()` because a profile bundle cannot import `@deepseek-ai/*`
 * (verified: the plugin directory has no resolution path to the harness
 * packages). The raw `parameters` JSON Schema is the same wire contract
 * `defineTool` compiles to, and argument validation is therefore done here.
 */
import { CATEGORY } from './categories.js'
import { MODES } from './brief.js'

const SLOT_ENUM = ['L1', 'L2', 'L3']
const MODE_ENUM = [...MODES]

const BRIEF_PROPERTIES = {
  question: {
    type: 'string',
    description: 'The curated central question. State the decision or claim being examined, not just a topic.',
  },
  mode: {
    type: 'string',
    enum: MODE_ENUM,
    description: 'Consultation type; math_review and physics_review add a dimensional-analysis response contract.',
  },
  reason: {
    type: 'string',
    description: 'Why this consultation is worth the cost (the trigger and the evidence gap). Shown on the card.',
  },
  context: {
    type: 'string',
    description: 'Minimal necessary context and constraints. Do not paste a whole repository.',
  },
  evidence: {
    type: 'string',
    description: 'Formulas, units, boundary conditions, logs, failing tests, reproduction steps, commit ids.',
  },
  requested_output: {
    type: 'string',
    description: 'What the expert should emphasize: a verdict, a derivation check, a counterexample, a discriminating experiment.',
  },
  privacy_scope: {
    type: 'string',
    description: 'Short description of what content is being shared and why it is allowed to leave the machine.',
  },
}

const SINGLE_PROPERTIES = {
  ...BRIEF_PROPERTIES,
  slot: {
    type: 'string',
    enum: SLOT_ENUM,
    description: 'Which expert tier to ask. Omit it to let the plugin route by risk and complexity.',
  },
  risk: {
    type: 'string',
    enum: ['low', 'medium', 'high'],
    description: 'Consequence of getting this wrong; feeds the automatic slot routing.',
  },
  complexity: {
    type: 'string',
    enum: ['low', 'medium', 'high'],
    description: 'How hard the problem is; feeds the automatic slot routing.',
  },
}

const COUNCIL_PROPERTIES = {
  ...BRIEF_PROPERTIES,
  slots: {
    type: 'array',
    items: { type: 'string', enum: SLOT_ENUM },
    description: 'Slots to ask in parallel. Omit to ask every configured and enabled slot.',
  },
}

const FOLLOWUP_PROPERTIES = {
  consultation_id: {
    type: 'string',
    description: 'The consultationId returned by a previous consult_expert or consult_council call.',
  },
  question: {
    type: 'string',
    description: 'The follow-up question, including the new evidence that motivated it.',
  },
  slot: {
    type: 'string',
    enum: SLOT_ENUM,
    description: 'Which slot to follow up with. Defaults to the first successful slot of that consultation.',
  },
  mode: {
    type: 'string',
    enum: MODE_ENUM,
    description: 'Consultation type for the follow-up.',
  },
}

const VERIFY_PROPERTIES = {
  consultation_id: {
    type: 'string',
    description: 'The consultationId whose advice is being judged.',
  },
  verdict: {
    type: 'string',
    enum: ['ADOPTED', 'PARTIAL', 'NEEDS_MORE_EVIDENCE', 'REJECTED'],
    description: 'What the calling agent decided after independently checking the advice.',
  },
  notes: {
    type: 'string',
    description: 'The verification performed and the outcome: tests run, formulas recomputed, evidence found.',
  },
  evidence: {
    type: 'string',
    description: 'Optional pointers: test names, commit ids, file locations, numbers.',
  },
  slot: {
    type: 'string',
    enum: SLOT_ENUM,
    description: 'Judge one slot of a council separately instead of the consultation as a whole.',
  },
}

/** Lossless-JSON snapshot: the registry rejects values that are not plain JSON. */
function lossless(value) {
  return JSON.parse(JSON.stringify(value))
}

function violation(name, expected) {
  const error = new Error(`invalid arguments for ${name}: ${expected}`)
  error.code = 'INVALID_ARGUMENTS'
  return error
}

function requireString(args, field, { optional = false, maxLength = 200_000 } = {}) {
  const value = args[field]
  if (value === undefined || value === null) {
    if (optional) return undefined
    throw violation('this tool', `"${field}" is required`)
  }
  if (typeof value !== 'string') throw violation('this tool', `"${field}" must be a string`)
  if (value.trim() === '') {
    if (optional) return undefined
    throw violation('this tool', `"${field}" must not be empty`)
  }
  if (value.length > maxLength) throw violation('this tool', `"${field}" is longer than ${maxLength} characters; narrow it`)
  return value
}

function optionalEnum(args, field, allowed) {
  const value = args[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw violation('this tool', `"${field}" must be one of ${allowed.join(', ')}`)
  }
  return value
}

function normalizeBriefArgs(args) {
  return {
    question: requireString(args, 'question'),
    mode: optionalEnum(args, 'mode', MODE_ENUM),
    reason: requireString(args, 'reason', { optional: true, maxLength: 4000 }),
    context: requireString(args, 'context', { optional: true }),
    evidence: requireString(args, 'evidence', { optional: true }),
    requestedOutput: requireString(args, 'requested_output', { optional: true, maxLength: 8000 }),
    privacyScope: requireString(args, 'privacy_scope', { optional: true, maxLength: 2000 }),
  }
}

/** Render the model-facing summary for a single consultation. */
function renderSingle(meta) {
  const slot = meta.slots?.[0]
  const lines = []
  lines.push(`Expert consultation ${meta.consultationId} — ${meta.status}`)
  if (slot === undefined) {
    lines.push('No expert was asked.')
    if (meta.diagnostics?.notes?.length > 0) lines.push(...meta.diagnostics.notes.map((note) => `- ${note}`))
    return lines.join('\n')
  }
  lines.push(`Slot: ${slot.slot} (${slot.displayName}) · ${slot.protocol} · ${slot.providerLabel || 'unlabeled provider'} · model ${slot.modelId || '(unset)'}`)
  lines.push(`Status: ${slot.status} · ${slot.durationMs} ms · attempts ${slot.attempts}`)
  if (slot.error !== undefined && slot.error !== null) {
    lines.push(`Error: ${slot.error.category} — ${slot.error.message}`)
  }
  if (slot.status === 'SUCCESS') {
    lines.push('')
    lines.push('--- expert answer (verbatim) ---')
    lines.push(slot.answer ?? '')
    lines.push('--- end of answer ---')
    lines.push('')
    lines.push('This is advisory expert input, not a verified conclusion. Check it independently (recompute, test, cite) before relying on it, then record the outcome with verify_consultation.')
  }
  if (slot.usage?.totalTokens === null && slot.status === 'SUCCESS') {
    lines.push('Token usage: unknown (the provider did not report it).')
  }
  return lines.join('\n')
}

/** Render the model-facing summary for a council consultation. */
function renderCouncil(meta) {
  const lines = []
  const synthesis = meta.synthesis
  lines.push(`Expert council ${meta.consultationId} — ${meta.status} (${synthesis?.counts?.success ?? 0}/${synthesis?.counts?.requested ?? 0} returned)`)
  if (synthesis !== undefined && synthesis !== null) {
    if (synthesis.absent?.length > 0) lines.push(`Not consulted: ${synthesis.absent.join(', ')}`)
    if (synthesis.failed?.length > 0) lines.push(`Failed: ${synthesis.failed.join(', ')}`)
  }
  if (meta.diagnostics?.notes?.length > 0) lines.push(...meta.diagnostics.notes.map((note) => `- ${note}`))

  for (const slot of meta.slots ?? []) {
    lines.push('')
    lines.push(`=== ${slot.slot} · ${slot.displayName} · ${slot.protocol} · model ${slot.modelId || '(unset)'} ===`)
    lines.push(`Status: ${slot.status} · ${slot.durationMs} ms · attempts ${slot.attempts}`)
    if (slot.error !== undefined && slot.error !== null) {
      lines.push(`Error: ${slot.error.category} — ${slot.error.message}`)
      continue
    }
    if (slot.status === 'SUCCESS') lines.push(slot.answer ?? '')
  }

  if (synthesis !== undefined && synthesis !== null) {
    lines.push('')
    lines.push('--- mechanical cross-answer overlap (lexical, not semantic) ---')
    lines.push(synthesis.note)
    if (synthesis.overlap?.length > 0) {
      lines.push(`Tokens found in more than one answer: ${synthesis.overlap.slice(0, 25).map((entry) => `${entry.token} [${entry.slots.join('+')}]`).join(', ')}`)
    } else {
      lines.push('No shared technical tokens were detected across answers.')
    }
    for (const entry of synthesis.uniqueBySlot ?? []) {
      if (entry.items.length > 0) lines.push(`Only in ${entry.slot}: ${entry.items.slice(0, 15).join(', ')}`)
    }
  }

  lines.push('')
  lines.push('You own the synthesis. Compare the answers, name the disagreements, and verify every load-bearing claim independently before adopting any of it. Majority agreement is not evidence of correctness. Record your conclusion with verify_consultation.')
  return lines.join('\n')
}

/**
 * Build the four tool definitions.
 * @param {object} deps services and config resolved by the plugin entry.
 * @returns {Array<object>} definitions ready for `ctx.tools.register`.
 */
export function createToolDefinitions(deps) {
  const {
    getConfig,
    credentials,
    protocols,
    store,
    buildRequester,
    knownSecrets,
    createRecord,
    updateRecord,
  } = deps

  return [
    {
      name: 'consult_expert',
      description: [
        'Ask one user-configured external expert model (tier L1/L2/L3) a curated question and get its advisory answer.',
        'Use it when an independent expert view is worth a paid external API call: hard math/physics derivations that need checking, a debugging problem that several approaches failed to explain, competing technical designs, or a high-cost decision that deserves challenge.',
        'The expert cannot run code, read files, or change the project. Its answer is evidence to verify, not a conclusion to copy.',
        'Omit `slot` to let risk and complexity choose the tier.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: SINGLE_PROPERTIES,
        required: ['question'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: renderSingle(value.meta) }],
        presentationMeta: (_args, value) => value.meta,
      },
      async execute(args, exec) {
        const config = getConfig()
        const parsed = normalizeBriefArgs(args ?? {})
        const { meta, rejected } = await deps.runSingle({
          input: {
            question: parsed.question,
            mode: parsed.mode,
            reason: parsed.reason,
            context: parsed.context,
            evidence: parsed.evidence,
            requestedOutput: parsed.requestedOutput,
            privacyScope: parsed.privacyScope,
            slot: optionalEnum(args ?? {}, 'slot', SLOT_ENUM),
            risk: optionalEnum(args ?? {}, 'risk', ['low', 'medium', 'high']),
            complexity: optionalEnum(args ?? {}, 'complexity', ['low', 'medium', 'high']),
          },
          config,
          credentials,
          protocols,
          knownSecrets: knownSecrets(),
          requester: buildRequester(exec),
          signal: exec.signal,
        })

        if (rejected !== undefined) {
          const error = new Error(rejected.message)
          error.code = rejected.category
          throw error
        }

        await createRecord(meta)
        return lossless({ meta, consultationId: meta.consultationId, status: meta.status })
      },
      isConcurrencySafe: () => true,
    },
    {
      name: 'consult_council',
      description: [
        'Ask the configured expert tiers (L1/L2/L3) the SAME question in parallel and get every answer back separately.',
        'Use it when independent, non-anchored perspectives matter: a disputed derivation, a blocking problem several approaches failed to explain, an architecture choice with no obvious winner, or when the user explicitly asks for all three tiers.',
        'Each slot is asked independently — no expert sees another answer. One failure never discards the other answers; the result reports COMPLETE, PARTIAL or FAILED.',
        'The plugin only aggregates mechanically. You compare the answers, name disagreements, verify independently, and decide.',
        'This costs one external API call per slot.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: COUNCIL_PROPERTIES,
        required: ['question'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: renderCouncil(value.meta) }],
        presentationMeta: (_args, value) => value.meta,
      },
      async execute(args, exec) {
        const config = getConfig()
        const parsed = normalizeBriefArgs(args ?? {})
        const rawSlots = (args ?? {}).slots
        let slots
        if (rawSlots !== undefined && rawSlots !== null) {
          if (!Array.isArray(rawSlots)) throw violation('consult_council', '"slots" must be an array')
          slots = rawSlots.filter((slot) => SLOT_ENUM.includes(slot))
          if (slots.length === 0) throw violation('consult_council', '"slots" must contain at least one of L1, L2, L3')
        }

        const { meta, rejected } = await deps.runCouncil({
          input: {
            question: parsed.question,
            mode: parsed.mode,
            reason: parsed.reason,
            context: parsed.context,
            evidence: parsed.evidence,
            requestedOutput: parsed.requestedOutput,
            privacyScope: parsed.privacyScope,
            slots,
          },
          config,
          credentials,
          protocols,
          knownSecrets: knownSecrets(),
          requester: buildRequester(exec),
          signal: exec.signal,
        })

        if (rejected !== undefined) {
          const error = new Error(rejected.message)
          error.code = rejected.category
          throw error
        }

        await createRecord(meta)
        return lossless({ meta, consultationId: meta.consultationId, status: meta.status })
      },
      isConcurrencySafe: () => true,
    },
    {
      name: 'followup_expert',
      description: [
        'Ask a follow-up question to one expert from an earlier consultation, carrying that expert\'s own previous answer as context.',
        'Use it to push back, request a derivation for a specific step, or hand the expert new evidence.',
        'Only that slot\'s own visible answer is resent — never another slot\'s answer, never hidden reasoning, never credentials.',
        'This is a new paid call. It is not an independent second opinion: the expert now sees its earlier answer.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: FOLLOWUP_PROPERTIES,
        required: ['consultation_id', 'question'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: renderSingle(value.meta) }],
        presentationMeta: (_args, value) => value.meta,
      },
      async execute(args, exec) {
        const config = getConfig()
        const input = args ?? {}
        const consultationId = requireString(input, 'consultation_id', { maxLength: 200 })
        const question = requireString(input, 'question')
        const slot = optionalEnum(input, 'slot', SLOT_ENUM)
        const mode = optionalEnum(input, 'mode', MODE_ENUM)

        const previous = await store.get(consultationId)
        if (previous === null) {
          throw violation('followup_expert', `no consultation "${consultationId}" is recorded; ids survive restarts only for consultations this profile recorded`)
        }

        const candidates = (previous.slots ?? []).filter((entry) => entry.status === 'SUCCESS')
        const target = slot === undefined ? candidates[0] : candidates.find((entry) => entry.slot === slot)
        if (target === undefined) {
          throw violation(
            'followup_expert',
            slot === undefined
              ? `consultation "${consultationId}" has no successful slot to follow up with`
              : `slot ${slot} of consultation "${consultationId}" did not succeed`,
          )
        }

        const { meta, rejected } = await deps.runSingle({
          input: {
            question,
            mode: mode ?? previous.mode,
            reason: `follow-up to ${consultationId} (${target.slot})`,
            context: [
              `Earlier question in this consultation:\n${previous.question?.normalized ?? ''}`,
              `Your earlier answer to that question:\n${target.answer ?? ''}`,
              'This is a follow-up. Continue from that answer; correct it explicitly if the new evidence changes it.',
            ].join('\n\n'),
            evidence: '',
            requestedOutput: '',
            privacyScope: undefined,
            slot: target.slot,
            risk: undefined,
            complexity: undefined,
          },
          config,
          credentials,
          protocols,
          knownSecrets: knownSecrets(),
          requester: buildRequester(exec),
          signal: exec.signal,
        })

        if (rejected !== undefined) {
          const error = new Error(rejected.message)
          error.code = rejected.category
          throw error
        }

        await createRecord(meta)
        return lossless({ meta, consultationId: meta.consultationId, status: meta.status })
      },
      isConcurrencySafe: () => true,
    },
    {
      name: 'verify_consultation',
      description: [
        'Record what you did with expert advice: ADOPTED, PARTIAL, NEEDS_MORE_EVIDENCE or REJECTED, plus the verification that justified it.',
        'Call it after you independently check a consultation (recompute the formula, run the test, read the source, run the experiment).',
        'The verdict is appended to the consultation record and shown on its card, so the audit trail shows what was actually relied on.',
        'Pass `slot` to judge one council slot separately.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: VERIFY_PROPERTIES,
        required: ['consultation_id', 'verdict', 'notes'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [
          {
            type: 'text',
            text: [
              `Recorded ${value.verdict} for consultation ${value.consultationId}${value.slot === undefined ? '' : ` (slot ${value.slot})`}.`,
              'The decision is now part of the consultation record and appears on its card.',
            ].join('\n'),
          },
        ],
        presentationMeta: (_args, value) => value.meta,
      },
      async execute(args, exec) {
        const input = args ?? {}
        const consultationId = requireString(input, 'consultation_id', { maxLength: 200 })
        const verdict = optionalEnum(input, 'verdict', ['ADOPTED', 'PARTIAL', 'NEEDS_MORE_EVIDENCE', 'REJECTED'])
        if (verdict === undefined) throw violation('verify_consultation', '"verdict" is required')
        const notes = requireString(input, 'notes', { maxLength: 20_000 })
        const evidence = requireString(input, 'evidence', { optional: true, maxLength: 20_000 })
        const slot = optionalEnum(input, 'slot', SLOT_ENUM)

        const decision = { verdict, notes, evidence: evidence ?? null, slot: slot ?? null, at: new Date().toISOString() }
        const updated = await updateRecord(consultationId, decision, slot)
        if (updated === null) {
          throw violation('verify_consultation', `no consultation "${consultationId}" is recorded in this profile`)
        }

        return lossless({
          meta: {
            ...updated,
            verification: decision,
          },
          consultationId,
          verdict,
          slot: slot ?? null,
        })
      },
      isConcurrencySafe: () => true,
    },
  ]
}
