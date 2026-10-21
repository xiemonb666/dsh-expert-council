#!/usr/bin/env node
// Minimal ASAR reader used to inspect the installed DeepSeek Harness packages.
// The Desktop install ships its packages inside app.asar, which the normal
// filesystem tools cannot traverse; this helper parses the archive header and
// can list or extract entries into the workspace for reading.
import { createReadStream, openSync, readSync, closeSync, mkdirSync, writeFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const DEFAULT_ASAR = 'C:\\Users\\XieMo\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar'

function readHeader(asarPath) {
  const fd = openSync(asarPath, 'r')
  try {
    const sizeBuf = Buffer.alloc(16)
    readSync(fd, sizeBuf, 0, 16, 0)
    const headerSize = sizeBuf.readUInt32LE(12)
    const headerBuf = Buffer.alloc(headerSize)
    readSync(fd, headerBuf, 0, headerSize, 16)
    return { fd: null, headerSize, json: JSON.parse(headerBuf.toString('utf8')) }
  } finally {
    closeSync(fd)
  }
}

function walk(node, prefix, out) {
  if (node === null || typeof node !== 'object') return
  if (node.files) {
    for (const [name, child] of Object.entries(node.files)) {
      walk(child, prefix === '' ? name : `${prefix}/${name}`, out)
    }
    return
  }
  if (typeof node.offset === 'string' || typeof node.offset === 'number') {
    out.push({ path: prefix, size: node.size, offset: Number(node.offset), unpacked: node.unpacked === true })
  }
}

function listEntries(asarPath) {
  const { headerSize, json } = readHeader(asarPath)
  const out = []
  walk(json, '', out)
  return { entries: out, headerSize }
}

function extract(asarPath, innerPath, outPath) {
  const { headerSize, json } = readHeader(asarPath)
  const parts = innerPath.split('/').filter(Boolean)
  let node = json
  for (const part of parts) {
    if (node === null || typeof node !== 'object' || !node.files || !node.files[part]) {
      throw new Error(`not found in asar: ${innerPath}`)
    }
    node = node.files[part]
  }
  if (!node || typeof node.offset === 'undefined') throw new Error(`not a file: ${innerPath}`)
  const start = 16 + headerSize + Number(node.offset)
  const buf = Buffer.alloc(node.size)
  const fd = openSync(asarPath, 'r')
  try {
    readSync(fd, buf, 0, node.size, start)
  } finally {
    closeSync(fd)
  }
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, buf)
  return node.size
}

const [cmd, ...rest] = process.argv.slice(2)
const asarPath = process.env.DSH_ASAR || DEFAULT_ASAR

if (cmd === 'list') {
  const prefix = rest[0] ?? ''
  const { entries } = listEntries(asarPath)
  for (const entry of entries) {
    if (entry.path.startsWith(prefix)) console.log(`${entry.size}\t${entry.path}`)
  }
} else if (cmd === 'extract') {
  const [inner, out] = rest
  if (!inner || !out) throw new Error('usage: asar.mjs extract <innerPath> <outPath>')
  const size = extract(asarPath, inner, resolve(out))
  console.log(`extracted ${size} bytes -> ${out}`)
} else if (cmd === 'extract-tree') {
  const [prefix, outDir] = rest
  if (!prefix || !outDir) throw new Error('usage: asar.mjs extract-tree <prefix> <outDir>')
  const { entries } = listEntries(asarPath)
  const root = resolve(outDir)
  let count = 0
  let bytes = 0
  for (const entry of entries) {
    if (!entry.path.startsWith(prefix)) continue
    const rel = entry.path.slice(prefix.length).replace(/^\//, '')
    if (rel === '') continue
    const target = join(root, rel)
    bytes += extract(asarPath, entry.path, target)
    count += 1
  }
  console.log(`extracted ${count} files (${bytes} bytes) -> ${root}`)
} else {
  console.error('usage: asar.mjs <list|extract|extract-tree> ...')
  process.exitCode = 2
}
