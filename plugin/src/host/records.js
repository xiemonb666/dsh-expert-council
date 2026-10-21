/**
 * Consultation record store.
 *
 * Two things must be true after a restart:
 * 1. a consultation id can still be resolved for `followup_expert` and
 *    `verify_consultation`;
 * 2. the record is bounded, so an unbounded history cannot grow forever.
 *
 * The durable authority for what was said is still the session log
 * (`tool/call` + `tool/result`); this store is the index the tools need to
 * address a previous consultation by id, plus the verification verdict that is
 * written after the fact. It holds redacted text only — the same text the card
 * displays.
 */
import { mkdir, readFile, writeFile, rename, readdir, unlink, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const FILE_VERSION = 1
const MAX_RECORDS = 200

function emptyIndex() {
  return { version: FILE_VERSION, records: [] }
}

function recordPath(root) {
  return join(root, 'index.json')
}

function summaryOf(record) {
  return {
    consultationId: record.consultationId,
    kind: record.kind,
    createdAt: record.createdAt,
    mode: record.mode,
    status: record.status,
    question: typeof record.question?.normalized === 'string' ? record.question.normalized.slice(0, 400) : '',
    slots: Array.isArray(record.slots)
      ? record.slots.map((slot) => ({
          slot: slot.slot,
          status: slot.status,
          modelId: slot.modelId,
          protocol: slot.protocol,
          providerLabel: slot.providerLabel,
        }))
      : [],
    decision: record.synthesis?.decision ?? null,
  }
}

export class ConsultationStore {
  /**
   * @param {string} root directory holding `index.json`; created on demand.
   */
  constructor(root) {
    this.root = resolve(root)
    this.ready = null
  }

  async ensure() {
    if (this.ready === null) {
      this.ready = (async () => {
        await mkdir(this.root, { recursive: true })
      })()
    }
    return this.ready
  }

  async load() {
    await this.ensure()
    try {
      const text = await readFile(recordPath(this.root), 'utf8')
      const parsed = JSON.parse(text)
      if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.records)) return emptyIndex()
      return { version: FILE_VERSION, records: parsed.records.filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.consultationId === 'string') }
    } catch (error) {
      if (error?.code === 'ENOENT') return emptyIndex()
      // A corrupt index must not take consultations down; start a fresh one and
      // leave the damaged file for the operator instead of overwriting it.
      try {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        await rename(recordPath(this.root), join(this.root, `index.corrupt-${stamp}.json`))
      } catch {
        // best effort only
      }
      return emptyIndex()
    }
  }

  async save(index) {
    await this.ensure()
    const trimmed = { version: FILE_VERSION, records: index.records.slice(0, MAX_RECORDS) }
    const target = recordPath(this.root)
    const temp = join(this.root, `index.tmp-${process.pid}-${Date.now()}.json`)
    await writeFile(temp, JSON.stringify(trimmed, null, 2), 'utf8')
    await rename(temp, target)
  }

  /** Insert or replace one consultation record. */
  async put(record) {
    const index = await this.load()
    const existing = index.records.findIndex((entry) => entry.consultationId === record.consultationId)
    if (existing >= 0) index.records[existing] = record
    else index.records.unshift(record)
    await this.save(index)
    return record
  }

  /** Read one full record. */
  async get(consultationId) {
    const index = await this.load()
    return index.records.find((entry) => entry.consultationId === consultationId) ?? null
  }

  /** Recent consultations, newest first, without the full answer bodies. */
  async list(limit = 20) {
    const index = await this.load()
    return index.records.slice(0, Math.max(1, Math.min(MAX_RECORDS, limit))).map(summaryOf)
  }

  /** Append or replace the verification verdict of one slot (or the whole record). */
  async recordDecision(consultationId, decision, slot) {
    const index = await this.load()
    const record = index.records.find((entry) => entry.consultationId === consultationId)
    if (record === undefined || record === null) return null

    if (typeof slot === 'string' && Array.isArray(record.slots)) {
      const target = record.slots.find((entry) => entry.slot === slot)
      if (target === undefined) return null
      target.verification = decision
    } else if (record.synthesis !== undefined && record.synthesis !== null) {
      record.synthesis.decision = decision
    } else {
      record.decision = decision
    }

    await this.save(index)
    return record
  }

  /** Delete one consultation. */
  async remove(consultationId) {
    const index = await this.load()
    const before = index.records.length
    index.records = index.records.filter((entry) => entry.consultationId !== consultationId)
    if (index.records.length === before) return false
    await this.save(index)
    return true
  }

  /** Delete every consultation record. */
  async clear() {
    await this.ensure()
    const index = emptyIndex()
    await this.save(index)
    return true
  }

  /** Diagnostics for the settings page. */
  async stats() {
    await this.ensure()
    const index = await this.load()
    let bytes = 0
    try {
      const info = await stat(recordPath(this.root))
      bytes = info.size
    } catch {
      bytes = 0
    }
    let orphans = []
    try {
      orphans = (await readdir(this.root)).filter((name) => name.startsWith('index.corrupt-') || name.startsWith('index.tmp-'))
    } catch {
      orphans = []
    }
    return { path: this.root, count: index.records.length, bytes, orphans }
  }
}
