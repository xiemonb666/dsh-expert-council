# Changelog

All notable changes to `dsh-expert-council` are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-10-21

First public release. Model-agnostic expert consultation gateway for
DeepSeek Harness `0.2.1-rc.2`.

### Added

**Expert tiers**

- Three independently configured model slots: `L1` Frontier, `L2` Advanced,
  `L3` Core. Each carries its own protocol, provider label, base URL, model ID,
  credential reference, output budget, timeout, retries and reasoning settings.
- Slot-level `enabled` / disabled state. A disabled or incomplete slot reports
  `SLOT_DISABLED` / `SLOT_UNCONFIGURED` and is never silently replaced by
  another tier.

**Protocols**

- `openai_chat_completions` — [OI]-compatible Chat Completions.
- `anthropic_messages` — native Anthropic Messages: `system` as a top-level
  field, mandatory `max_tokens`, `content[]` block aggregation, `thinking`
  blocks excluded from the displayable answer.
- Extensible adapter registry (`plugin/src/host/protocols/index.js`); adding a
  protocol does not touch the orchestrator.

**Consultation**

- `consult_expert` — one tier, explicit or auto-routed by risk/complexity.
- `consult_council` — every requested tier asked the same frozen brief
  **concurrently**; one failure never discards another tier's answer. Reports
  `COMPLETE` / `PARTIAL` / `FAILED` with per-slot status.
- `followup_expert` — follow up with one tier, carrying only that tier's own
  previous answer.
- `verify_consultation` — record `ADOPTED` / `PARTIAL` / `NEEDS_MORE_EVIDENCE` /
  `REJECTED` with evidence, per consultation or per slot.
- Mechanical cross-answer aggregation (shared tokens, per-slot unique tokens,
  answer lengths). Explicitly labelled lexical, not semantic.

**Reasoning and output controls**

- `reasoningEffort` (`minimal` … `max`) sent as `reasoning_effort` on
  [OI]-compatible endpoints.
- `thinkingBudget` for Anthropic: an explicit `thinking.budget_tokens` that
  overrides the effort-derived value. Some gateways ignore `reasoning_effort`
  on their Anthropic endpoint and honour only this field.
- Adapter enforces Anthropic's constraints automatically: budget stays below
  `max_tokens`, budgets under 1024 disable thinking rather than sending an
  invalid request, and `temperature` is dropped when thinking is enabled.
- Output budget up to 1,000,000 tokens; timeout up to 900,000 ms.

**Security**

- Outbound redaction with 11 rule families (PEM private keys, `sk-*` /
  `sk-ant-*`, Bearer tokens, AWS/GitHub/Google keys, JWTs, `*_key=…`
  assignments, URL userinfo, environment-variable assignments, plus the literal
  credential resolved for the call).
- Endpoint policy: HTTPS required, loopback/private addresses need an explicit
  `trustedLocalEndpoints` grant, optional host allow list, embedded credentials
  and query/fragment refused, **redirects not followed** so an `Authorization`
  header is never forwarded to an unauthorised host.
- `privacy_scope` gate refuses whole-repository / whole-environment sharing
  unless `security.allowRepoScope` is set.
- Payload size cap (`security.maxPayloadBytes`, default 120 000 bytes).
- Expert models receive **no tools** — no `tools` / `tool_choice` is ever sent.
- Credentials resolve through the host credential store and never appear in a
  response, a log line, or card metadata.

**UI**

- Four tool cards registered on `tool.call.toolview`: single, council,
  follow-up, verification. Expand/collapse, copy answer, copy report, copy raw
  JSON, redaction diff, diagnostics, and the host's verbatim synthesis note.
- Expert Council settings page on `settings.section`: per-tier editor, write-only
  API key field, connection test (which performs a real billable request and says
  so), read-only consultation history, storage and endpoint-policy display.
- **Bilingual UI** (English + Chinese, 271 dictionary entries) through the host's
  own `ctx.locale` service. The nav label is a thunk so it follows a language
  switch live. Without a locale service the plugin falls back to the browser
  language, never to a raw dictionary key.

**Diagnostics**

- Durable consultation index at `$DSH_HOME/expert-council/index.json`
  (200-entry cap, redacted text only, atomic writes, corrupt files quarantined).
  It lets `followup_expert` and `verify_consultation` address a consultation
  after a restart; the session log remains the audit authority.
- Settings API on `/expert-council/*`: loopback-only, requires the
  `x-dsh-expert-council: 1` header, never returns a credential value.

**Skill**

- `dsh-expert-routing` — when consulting is worth the cost, which tier to pick,
  how to structure the question, and how to verify the answer. Installs to
  `<DSH_HOME>/skills/dsh-expert-routing/SKILL.md`.

**Packaging**

- `tools/build-release.mjs` produces a versioned `.tar.gz` and `.zip` plus
  `SHA256SUMS.txt`. The archives were verified by extracting them and installing
  the extracted bundle through `plugin_manager install_bundle`.

### Fixed

- **Credential service resolved at load time.** `apply()` captured
  `ctx.get('credentials')` once; the credential service is a separate host
  plugin that may register later, so the captured `undefined` was reused forever
  and every consultation failed with `CREDENTIAL_MISSING`. Now resolved per call.
- **Locale service resolved at load time.** Same class of bug: the UI stayed
  English forever when the locale service activated after this plugin. Now
  attached lazily, re-notified through `ctx.inject(['locale'], …)`, retried from
  the translate function, and backed by a browser-language fallback.
- **History detail route never matched.** The route was registered as
  `/expert-council/history/` (trailing slash) while the web server matches a
  prefix as `pathname === prefix || pathname.startsWith(prefix + '/')`.
- **Host synthesis note silently dropped** when a card rendered with
  `defaultExpanded: true`. The verbatim host note is now always retained for
  audit.
- **Caller cancellation reported as `TIMEOUT`** instead of `CANCELLED`.

### Known limitations

- Non-streaming only. A provider that answers with SSE is reported as
  `BAD_RESPONSE` rather than silently truncated.
- No tool calling is offered to expert models.
- Reasoning content is kept only as diagnostic blocks; it never enters the
  displayable answer, and Anthropic `signature` is not returned, so multi-turn
  thinking continuation is unsupported.
- Usage fields the provider does not report stay `null`; cost stays `unknown`
  unless `pricing` is configured.
- The UI's pixel-level appearance has not been verified in a live browser; the
  bilingual rendering is verified character-by-character against the real
  dictionaries.
