#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

function usage() {
  console.error(
    'Usage: node check-locale-coverage.mjs --locales <dir> [--partials <dir>] --source <code> --target <code>',
  )
  process.exit(2)
}

const args = process.argv.slice(2)
const options = {}
for (let i = 0; i < args.length; i += 2) {
  const key = args[i]
  const value = args[i + 1]
  if (!key?.startsWith('--') || !value) usage()
  options[key.slice(2)] = value
}

if (!options.locales || !options.source || !options.target) usage()

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function leafPaths(value, prefix = '') {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, child]) =>
      leafPaths(child, prefix ? `${prefix}.${key}` : key),
    )
  }
  return [prefix]
}

function compareTrees(label, sourceTree, targetTree) {
  const sourcePaths = leafPaths(sourceTree)
  const targetPaths = new Set(leafPaths(targetTree))
  const missing = sourcePaths.filter((item) => !targetPaths.has(item))
  console.log(`${label}: ${sourcePaths.length - missing.length}/${sourcePaths.length}`)
  if (missing.length) {
    console.log(missing.map((item) => `  - ${item}`).join('\n'))
  }
  return missing.length
}

let failures = 0
const sourceBase = path.join(options.locales, `${options.source}.json`)
const targetBase = path.join(options.locales, `${options.target}.json`)

failures += compareTrees(`base ${options.target}`, readJson(sourceBase), readJson(targetBase))

if (options.partials && fs.existsSync(options.partials)) {
  const files = fs
    .readdirSync(options.partials)
    .filter((file) => file.endsWith('.json'))
    .sort()
  for (const file of files) {
    const json = readJson(path.join(options.partials, file))
    failures += compareTrees(
      `${file} ${options.target}`,
      json[options.source] ?? {},
      json[options.target] ?? {},
    )
  }
}

if (failures) {
  console.error(`Missing ${failures} target translation keys.`)
  process.exit(1)
}

console.log('Locale coverage complete.')
