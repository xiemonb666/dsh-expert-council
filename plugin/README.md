# dsh-expert-council

Model-agnostic expert consultation gateway for **DeepSeek Harness**.

Ask one user-configured external expert model (tier L1 / L2 / L3), or all
configured tiers the same question in parallel, and get every answer back
separately with a full audit trail.

This package is the **installable bundle** (the directory containing
`package.json` and `cordis.patch.yml`). Install it with:

```
plugin_manager(action: install_bundle, target: "<abs path to this directory>")
```

Full documentation, tests and the acceptance report live in the repository
root, one level up.

## What it registers

| Kind | Name |
|---|---|
| Tool | `consult_expert` — ask one tier |
| Tool | `consult_council` — ask several tiers in parallel, independent answers |
| Tool | `followup_expert` — follow up with one tier of a previous consultation |
| Tool | `verify_consultation` — record ADOPTED / PARTIAL / NEEDS_MORE_EVIDENCE / REJECTED |
| Client card | `tool.call.toolview` × 4 (single, council, follow-up, verification) |
| Client page | `settings.section` → Expert Council |
| HTTP | `/expert-council/*` (loopback only, requires `x-dsh-expert-council: 1`) |

## Protocols

- `openai_chat_completions` — [OI]-compatible Chat Completions
- `anthropic_messages` — native Anthropic Messages (system as a top-level field,
  mandatory `max_tokens`, `content[]` block aggregation, extended `thinking`)

## Non-negotiable constraints of this bundle

- **No bare imports.** The plugin directory has no resolution path to
  `@deepseek-ai/*`, so the host half uses only `node:*` built-ins and relative
  ESM imports.
- **`client.js` is one self-contained file.** The only `require` it performs is
  `require('react')`; the browser provides that module.
- **The expert models get no tools.** No `tools` / `tool_choice` is ever sent, so
  an external model cannot execute anything.

## License

MIT — see the repository root `LICENSE`.
