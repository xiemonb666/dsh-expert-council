import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ConsultationStore } from '../../plugin/src/host/records.js'

async function freshStore() {
  const root = await mkdtemp(join(tmpdir(), 'ec-records-'))
  return { store: new ConsultationStore(join(root, 'consultations')), root: join(root, 'consultations') }
}

function record(id, overrides = {}) {
  return {
    version: 1,
    kind: 'single',
    consultationId: id,
    createdAt: new Date().toISOString(),
    status: 'COMPLETE',
    mode: 'general',
    question: { normalized: 'Is this formula correct?', hash: 'abc' },
    slots: [
      { slot: 'L2', status: 'SUCCESS', modelId: 'm-1', protocol: 'openai_chat_completions', providerLabel: 'p', answer: 'yes' },
    ],
    ...overrides,
  }
}

test('a record survives a new store instance (restart)', async () => {
  const { store, root } = await freshStore()
  await store.put(record('ec-1'))
  const reopened = new ConsultationStore(root)
  const loaded = await reopened.get('ec-1')
  assert.ok(loaded)
  assert.equal(loaded.consultationId, 'ec-1')
  assert.equal(loaded.slots[0].answer, 'yes')
})

test('put replaces an existing record instead of duplicating it', async () => {
  const { store } = await freshStore()
  await store.put(record('ec-1'))
  await store.put(record('ec-1', { status: 'PARTIAL' }))
  const index = await store.load()
  assert.equal(index.records.length, 1)
  assert.equal(index.records[0].status, 'PARTIAL')
})

test('list returns summaries without answer bodies, newest first', async () => {
  const { store } = await freshStore()
  await store.put(record('ec-1'))
  await store.put(record('ec-2'))
  const summaries = await store.list(10)
  assert.equal(summaries.length, 2)
  assert.equal(summaries[0].consultationId, 'ec-2')
  assert.equal(JSON.stringify(summaries).includes('"answer"'), false)
  assert.equal(summaries[0].slots[0].modelId, 'm-1')
})

test('recordDecision writes a council-level verdict', async () => {
  const { store } = await freshStore()
  await store.put(record('ec-1', { kind: 'council', synthesis: { decision: null } }))
  const decision = { verdict: 'ADOPTED', notes: 'recomputed by hand', at: new Date().toISOString() }
  const updated = await store.recordDecision('ec-1', decision)
  assert.ok(updated)
  assert.equal(updated.synthesis.decision.verdict, 'ADOPTED')
})

test('recordDecision can target one slot of a council', async () => {
  const { store } = await freshStore()
  await store.put(record('ec-1', {
    kind: 'council',
    synthesis: { decision: null },
    slots: [
      { slot: 'L1', status: 'SUCCESS', answer: 'a' },
      { slot: 'L2', status: 'SUCCESS', answer: 'b' },
    ],
  }))
  const decision = { verdict: 'REJECTED', notes: 'the derivation breaks at step 3', at: new Date().toISOString() }
  const updated = await store.recordDecision('ec-1', decision, 'L2')
  assert.equal(updated.slots[1].verification.verdict, 'REJECTED')
  assert.equal(updated.slots[0].verification, undefined)
})

test('recordDecision on an unknown consultation or slot returns null', async () => {
  const { store } = await freshStore()
  assert.equal(await store.recordDecision('nope', { verdict: 'ADOPTED' }), null)
  await store.put(record('ec-1'))
  assert.equal(await store.recordDecision('ec-1', { verdict: 'ADOPTED' }, 'L3'), null)
})

test('a corrupt index is quarantined rather than crashing or being overwritten', async () => {
  const { store, root } = await freshStore()
  await store.put(record('ec-1'))
  await writeFile(join(root, 'index.json'), '{ this is not json', 'utf8')

  const loaded = await store.load()
  assert.deepEqual(loaded.records, [])

  const names = await readdir(root)
  assert.ok(names.some((name) => name.startsWith('index.corrupt-')), 'expected the damaged file to be kept for the operator')
  const damaged = names.find((name) => name.startsWith('index.corrupt-'))
  const text = await readFile(join(root, damaged), 'utf8')
  assert.ok(text.includes('this is not json'))
})

test('the index is capped so history cannot grow without bound', async () => {
  const { store } = await freshStore()
  for (let index = 0; index < 205; index += 1) {
    await store.put(record(`ec-${index}`))
  }
  const index = await store.load()
  assert.ok(index.records.length <= 200)
  assert.equal(index.records[0].consultationId, 'ec-204')
})

test('remove and clear work, and stats reports the store location', async () => {
  const { store } = await freshStore()
  await store.put(record('ec-1'))
  await store.put(record('ec-2'))
  assert.equal(await store.remove('ec-1'), true)
  assert.equal(await store.remove('ec-1'), false)
  assert.equal((await store.load()).records.length, 1)
  const stats = await store.stats()
  assert.equal(stats.count, 1)
  assert.ok(stats.path.includes('consultations'))
  await store.clear()
  assert.equal((await store.load()).records.length, 0)
})

test('an unwritable directory does not throw from stats', async () => {
  const store = new ConsultationStore(join(tmpdir(), 'ec-nonexistent-parent', 'deeper'))
  const stats = await store.stats()
  assert.equal(stats.count, 0)
})
