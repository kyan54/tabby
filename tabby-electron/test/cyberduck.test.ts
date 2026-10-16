import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { findCyberduckApplication } from '../src/cyberduck.ts'

describe('macOS Cyberduck discovery without launching apps', () => {
    it('checks bundle identity rather than accepting an app named Cyberduck', async () => {
        const calls: string[] = []
        const found = await findCyberduckApplication('/Users/test', async (program, args) => {
            calls.push(program)
            if (program.endsWith('mdfind')) return '/Custom Apps/Cyberduck.app\0'
            return args.at(-1)?.startsWith('/Custom Apps/') ? 'ch.sudo.cyberduck\n' : 'org.other.app'
        })
        assert.equal(found, '/Custom Apps/Cyberduck.app')
        assert.ok(calls.every(p => p === '/usr/bin/mdfind' || p === '/usr/bin/plutil'))
    })
    it('finds a standard installation even when Spotlight is unavailable', async () => {
        assert.equal(await findCyberduckApplication('/Users/test', async (program, args) => {
            if (program.endsWith('mdfind')) throw Error('not indexed')
            if (args.at(-1)?.startsWith('/Applications/')) return 'ch.sudo.cyberduck'
            throw Error('missing')
        }), '/Applications/Cyberduck.app')
    })
    it('returns null when no verified app is available', async () => {
        assert.equal(await findCyberduckApplication('/Users/test', async () => { throw Error('not found') }), null)
    })
})
