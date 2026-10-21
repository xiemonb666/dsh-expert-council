/**
 * Outbound redaction.
 *
 * Every byte that leaves the machine for an external expert passes through
 * here first. The rules are deliberately conservative: a false positive costs
 * one consultation's fidelity, a false negative leaks a credential.
 *
 * The same pass produces the audit record, so the card can show exactly what
 * was removed and how much the payload shrank.
 */

/** Ordered rules; the first match wins for a given span. */
const RULES = [
  {
    id: 'private-key-block',
    // PEM private keys of any flavour.
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: '[REDACTED:private-key]',
  },
  {
    id: 'anthropic-key',
    pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
    replace: '[REDACTED:anthropic-key]',
  },
  {
    id: 'openai-style-key',
    pattern: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g,
    replace: '[REDACTED:api-key]',
  },
  {
    id: 'generic-bearer',
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/gi,
    replace: 'Bearer [REDACTED:token]',
  },
  {
    id: 'aws-access-key',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replace: '[REDACTED:aws-key]',
  },
  {
    id: 'github-token',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
    replace: '[REDACTED:github-token]',
  },
  {
    id: 'google-api-key',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    replace: '[REDACTED:google-key]',
  },
  {
    id: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replace: '[REDACTED:jwt]',
  },
  {
    id: 'assignment-secret',
    // `api_key = "..."`, `TOKEN: '...'`, `password=...`
    pattern: /\b([A-Za-z0-9_]*(?:api[_-]?key|secret|token|passwd|password|credential|access[_-]?key)[A-Za-z0-9_]*)\s*[:=]\s*(["']?)([^\s"'`,;]{8,})\2/gi,
    replace: (_match, name) => `${name}=[REDACTED:secret]`,
  },
  {
    id: 'url-basic-auth',
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi,
    replace: (_match, scheme) => `${scheme}[REDACTED:userinfo]@`,
  },
  {
    id: 'env-var-name-only',
    // `OPENAI_API_KEY=sk-...` handled above; this catches bare uppercase names
    // followed by a long opaque value that the rules above missed.
    pattern: /\b([A-Z][A-Z0-9_]{2,}(?:KEY|TOKEN|SECRET|PASSWORD))\s*=\s*([^\s"'`,;]{16,})/g,
    replace: (_match, name) => `${name}=[REDACTED:secret]`,
  },
]

/** Extra literal secrets supplied by the caller (resolved credentials). */
function literalRule(secrets) {
  const usable = secrets.filter((secret) => typeof secret === 'string' && secret.length >= 8)
  if (usable.length === 0) return null
  // Longest first so a key that contains another key is fully replaced.
  usable.sort((a, b) => b.length - a.length)
  return {
    id: 'known-credential',
    pattern: new RegExp(usable.map((secret) => secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g'),
    replace: '[REDACTED:credential]',
  }
}

/**
 * Redact one text block.
 * @param {string} text the candidate outbound text.
 * @param {{ knownSecrets?: string[], enabled?: boolean }} [options] runtime secrets to scrub verbatim.
 * @returns {{ text: string, appliedRules: string[], redactions: number, changed: boolean }}
 */
export function redactText(text, options = {}) {
  const original = typeof text === 'string' ? text : String(text ?? '')
  if (options.enabled === false) {
    return { text: original, appliedRules: [], redactions: 0, changed: false }
  }

  let current = original
  let redactions = 0
  const applied = []

  const rules = [...RULES]
  const literal = literalRule(options.knownSecrets ?? [])
  if (literal !== null) rules.unshift(literal)

  for (const rule of rules) {
    let hits = 0
    current = current.replace(rule.pattern, (...args) => {
      hits += 1
      return typeof rule.replace === 'function' ? rule.replace(...args) : rule.replace
    })
    if (hits > 0) {
      applied.push(rule.id)
      redactions += hits
    }
  }

  return { text: current, appliedRules: applied, redactions, changed: current !== original }
}

/**
 * Redact a multi-field brief and report the aggregate audit facts.
 * @param {{ system?: string, question: string, context?: string, evidence?: string, requestedOutput?: string }} brief
 * @param {{ knownSecrets?: string[], enabled?: boolean }} [options]
 */
export function redactBrief(brief, options = {}) {
  const fields = ['system', 'question', 'context', 'evidence', 'requestedOutput']
  const appliedRules = new Set()
  let redactions = 0
  let originalBytes = 0
  const out = {}

  for (const field of fields) {
    const value = brief[field]
    if (typeof value !== 'string' || value === '') continue
    originalBytes += Buffer.byteLength(value, 'utf8')
    const result = redactText(value, options)
    out[field] = result.text
    redactions += result.redactions
    for (const rule of result.appliedRules) appliedRules.add(rule)
  }

  const sentBytes = Object.values(out).reduce((sum, value) => sum + Buffer.byteLength(value, 'utf8'), 0)

  return {
    brief: out,
    audit: {
      redactions,
      appliedRules: [...appliedRules],
      originalBytes,
      sentBytes,
      truncated: false,
    },
  }
}

/**
 * Reject content scopes that would imply uploading a whole repository or the
 * process environment. This is a policy gate, not a redaction: the caller must
 * narrow the scope rather than have the plugin silently drop data.
 * @param {unknown} privacyScope the model-supplied scope description.
 * @param {{ allowRepoScope?: boolean }} [security]
 * @returns {{ ok: true } | { ok: false, category: string, reason: string }}
 */
export function checkPrivacyScope(privacyScope, security = {}) {
  if (privacyScope === undefined || privacyScope === null || privacyScope === '') return { ok: true }
  if (typeof privacyScope !== 'string') {
    return { ok: false, category: 'DATA_APPROVAL_REQUIRED', reason: 'privacy_scope must be a short description string' }
  }
  const normalized = privacyScope.toLowerCase()
  const forbidden = ['entire repo', 'whole repo', 'full repository', 'entire repository', '整个仓库', '全部仓库', 'whole workspace', 'entire workspace', '整个工作区', 'all environment variables', '全部环境变量', '整个环境变量', 'process.env', 'all files']
  if (!security.allowRepoScope && forbidden.some((token) => normalized.includes(token))) {
    return {
      ok: false,
      category: 'DATA_APPROVAL_REQUIRED',
      reason: `privacy_scope "${privacyScope}" would send more than a curated excerpt; narrow it to the specific files or values needed, or have the user enable security.allowRepoScope`,
    }
  }
  return { ok: true }
}
