/**
 * Consultation brief: the normalized question every slot in one call sees.
 *
 * A council only means something if the three models answer the same question,
 * so the brief is built once, frozen, hashed, and handed to each adapter. The
 * adapters are free to serialize it differently (that is protocol adaptation),
 * but they may not paraphrase it.
 */
import { createHash } from 'node:crypto'

export const MODES = Object.freeze([
  'math_review',
  'physics_review',
  'debug',
  'architecture',
  'research',
  'alternative_approach',
  'general',
])

const OUTPUT_SPEC = [
  'Answer in this structure:',
  '1. Direct answer / verdict on the central question.',
  '2. Key reasoning or derivation, with assumptions stated explicitly.',
  '3. Points you are uncertain about, and what evidence would settle them.',
  '4. Concrete checks the caller can run to verify your answer.',
  'State assumptions rather than silently guessing. If the question is underspecified, say what is missing.',
].join('\n')

const MATH_OUTPUT_SPEC = [
  'Answer in this structure:',
  '1. Direct verdict on the formula / derivation / numerical result.',
  '2. Dimensional analysis: units of every quantity, and whether both sides agree.',
  '3. Variable definitions, sign conventions, and assumed boundary conditions.',
  '4. Step-by-step derivation or the exact line where the argument breaks.',
  '5. Range of validity and known failure modes.',
  '6. A falsifiable test (a closed-form limit, a manufactured solution, or a numerical check) with expected outcome.',
].join('\n')

/**
 * Build the user-facing body the adapters render into their native request.
 * @param {object} input validated tool arguments.
 * @returns {{ system: string, question: string, context: string, evidence: string, requestedOutput: string, mode: string, normalized: string }}
 */
export function buildBrief(input) {
  const mode = MODES.includes(input.mode) ? input.mode : 'general'
  const isMath = mode === 'math_review' || mode === 'physics_review'

  const system = [
    'You are an external expert consultant. The caller is an autonomous engineering agent that keeps all execution authority: you cannot run commands, read files, or change the project.',
    'Your output is advisory evidence, not an authoritative conclusion. Be precise about what you know versus what you infer.',
    'Never claim to have executed code, accessed the repository, or verified anything empirically. If you cannot know something, say so.',
  ].join(' ')

  const sections = []
  sections.push(`## Central question\n${input.question.trim()}`)
  if (typeof input.context === 'string' && input.context.trim() !== '') {
    sections.push(`## Context and constraints\n${input.context.trim()}`)
  }
  if (typeof input.evidence === 'string' && input.evidence.trim() !== '') {
    sections.push(`## Evidence: formulas, logs, reproductions\n${input.evidence.trim()}`)
  }
  if (typeof input.requestedOutput === 'string' && input.requestedOutput.trim() !== '') {
    sections.push(`## What the caller wants from you\n${input.requestedOutput.trim()}`)
  }
  sections.push(`## Response format\n${isMath ? MATH_OUTPUT_SPEC : OUTPUT_SPEC}`)

  const normalized = sections.join('\n\n')

  return {
    system,
    question: input.question.trim(),
    context: typeof input.context === 'string' ? input.context.trim() : '',
    evidence: typeof input.evidence === 'string' ? input.evidence.trim() : '',
    requestedOutput: typeof input.requestedOutput === 'string' ? input.requestedOutput.trim() : '',
    mode,
    normalized,
  }
}

/**
 * Stable hash of the semantic brief, used to prove every slot in one council
 * answered the same frozen snapshot.
 */
export function briefHash(brief) {
  return createHash('sha256').update(brief.normalized, 'utf8').digest('hex')
}

/**
 * Default routing when the caller omits a slot: risk and complexity decide,
 * cost decides the tie. This is a heuristic, and the Skill is allowed to
 * override it by naming a slot explicitly.
 * @param {{ risk?: string, complexity?: string, mode?: string }} input
 * @param {{ singleSlot: string }} defaults
 * @returns {{ slot: string, policy: string }}
 */
export function routeSingle(input, defaults) {
  const risk = input.risk === 'high' || input.risk === 'medium' || input.risk === 'low' ? input.risk : 'medium'
  const complexity = input.complexity === 'high' || input.complexity === 'medium' || input.complexity === 'low' ? input.complexity : 'medium'
  const mode = input.mode

  if (mode === 'math_review' || mode === 'physics_review') {
    if (risk === 'high' || complexity === 'high') return { slot: 'L1', policy: 'math/physics review with high risk or complexity → L1' }
    return { slot: 'L2', policy: 'math/physics review at moderate risk → L2' }
  }
  if (risk === 'high' && complexity === 'high') return { slot: 'L1', policy: 'high risk + high complexity → L1' }
  if (complexity === 'high' || risk === 'high') return { slot: 'L2', policy: 'high complexity or high risk → L2' }
  if (complexity === 'low' && risk === 'low') return { slot: 'L3', policy: 'low risk + low complexity → L3' }
  return { slot: defaults.singleSlot ?? 'L2', policy: `default single slot (${defaults.singleSlot ?? 'L2'})` }
}
