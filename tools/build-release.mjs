#!/usr/bin/env node
/**
 * Build the release artifacts for dsh-expert-council.
 *
 * Produces, under `dist/`:
 *   dsh-expert-council-<version>.tar.gz   the installable bundle (npm pack layout)
 *   dsh-expert-council-<version>.zip      the same tree, for users without tar
 *   SHA256SUMS.txt                        checksums for both archives
 *
 * The bundle is packed from `plugin/`, because that directory — not the
 * repository root — is what `plugin_manager install_bundle` expects: it holds
 * `package.json` and `cordis.patch.yml`.
 *
 * Usage: node tools/build-release.mjs
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN = join(ROOT, 'plugin')
const DIST = join(ROOT, 'dist')

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', ...options })
}

async function walk(dir, base = dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full, base)))
    else if (entry.isFile()) out.push({ path: full, rel: relative(base, full).split('\\').join('/') })
  }
  return out
}

async function sha256(file) {
  const buffer = await readFile(file)
  return createHash('sha256').update(buffer).digest('hex')
}

async function main() {
  const manifest = JSON.parse(await readFile(join(PLUGIN, 'package.json'), 'utf8'))
  const version = manifest.version
  const baseName = `${manifest.name}-${version}`

  await rm(DIST, { recursive: true, force: true })
  await mkdir(DIST, { recursive: true })

  // 1. Stage exactly what ships: the manifest's `files` plus package.json itself.
  const stage = join(DIST, baseName)
  await mkdir(stage, { recursive: true })
  const wanted = new Set(['package.json', ...manifest.files])
  const files = await walk(PLUGIN)
  const shipped = []
  for (const file of files) {
    const top = file.rel.split('/')[0]
    const included = wanted.has(file.rel) || wanted.has(top) || [...wanted].some((pattern) => pattern.includes('*') && matches(pattern, file.rel))
    if (!included) continue
    const target = join(stage, file.rel)
    await mkdir(dirname(target), { recursive: true })
    await cp(file.path, target)
    shipped.push(file.rel)
  }
  shipped.sort()

  // 2. Sanity: every runtime entry the manifest promises must exist in the stage.
  const required = ['package.json', 'index.js', 'client.js', 'cordis.patch.yml', 'icon.svg']
  const missing = required.filter((name) => !shipped.includes(name))
  if (missing.length > 0) throw new Error(`staged bundle is missing: ${missing.join(', ')}`)

  // 3. Archives.
  const tarName = `${baseName}.tar.gz`
  const zipName = `${baseName}.zip`
  run('tar', ['-czf', join(DIST, tarName), '-C', DIST, baseName])
  try {
    run('tar', ['-a', '-cf', join(DIST, zipName), '-C', DIST, baseName])
  } catch (error) {
    // bsdtar (shipped with Windows) supports -a; if it is unavailable, skip the
    // zip rather than shipping a broken archive.
    console.warn(`zip archive skipped: ${error.message.split('\n')[0]}`)
  }

  // 4. Checksums.
  const lines = []
  for (const name of [tarName, zipName]) {
    const full = join(DIST, name)
    try {
      await stat(full)
      lines.push(`${await sha256(full)}  ${name}`)
    } catch {
      // skipped above
    }
  }
  await writeFile(join(DIST, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`, 'utf8')

  console.log(`bundle: ${manifest.name}@${version}`)
  console.log(`files:  ${shipped.length}`)
  console.log(`total:  ${(await Promise.all(shipped.map(async (rel) => (await stat(join(stage, rel))).size))).reduce((a, b) => a + b, 0)} bytes`)
  console.log('')
  for (const name of [tarName, zipName]) {
    const full = join(DIST, name)
    try {
      const info = await stat(full)
      console.log(`  dist/${name}  ${info.size} bytes  sha256 ${(await sha256(full)).slice(0, 16)}…`)
    } catch {
      console.log(`  dist/${name}  (not produced)`)
    }
  }
  console.log(`  dist/SHA256SUMS.txt`)
  console.log('')
  console.log('shipped files:')
  for (const rel of shipped) console.log(`  ${rel}`)
}

/** Minimal glob support for the `files` patterns this manifest actually uses. */
function matches(pattern, rel) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
  return new RegExp(`^${escaped}$`).test(rel)
}

await main()
