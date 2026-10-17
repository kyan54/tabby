#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// This is a build-time script only. It never accepts or handles credentials.
if (process.platform !== 'darwin') {
    console.info('Cyberduck Keychain native build is macOS-only; skipped.')
    process.exit(0)
}

const directory = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const option = name => {
    const position = args.indexOf(name)
    return position === -1 ? undefined : args[position + 1]
}
const version = option('--electron-version')
const arch = (option('--arch') ?? process.arch).replace(/^x86_64$/, 'x64')
if (!version || !/^\d+(\.\d+){0,2}([.-][a-zA-Z0-9.-]+)?$/.test(version)) {
    throw new Error('Pass --electron-version with the installed Electron version.')
}
if (!['x64', 'arm64'].includes(arch)) throw new Error('Unsupported macOS architecture.')

const team = process.env.TABBY_KEYCHAIN_TEAM_ID ?? process.env.APPLE_TEAM_ID ?? ''
if (team && !/^[A-Z0-9]{10}$/.test(team)) {
    throw new Error('The Keychain signing pin must be a ten-character Apple Team ID.')
}
mkdirSync(join(directory, 'generated'), { recursive: true })
writeFileSync(join(directory, 'generated', 'signing_config.h'),
    `// Build-time public signing identity; never a credential.\n#pragma once\n#define TABBY_KEYCHAIN_TEAM_ID "${team}"\n`)
if (!team) console.warn('No Tabby signing-team pin: Keychain sharing will fail closed.')

const require = createRequire(new URL('../../package.json', import.meta.url))
const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js')
execFileSync(process.execPath, [nodeGyp, 'rebuild', '--release',
    `--target=${version}`, `--arch=${arch}`, '--dist-url=https://electronjs.org/headers'], {
    cwd: directory,
    stdio: 'inherit',
})
