import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CyberduckKeychain } from '../src/cyberduckKeychain.ts'

const target = { host: 'example.invalid', port: 22, username: 'test-user', ownerId: 'ssh:custom:test:fixture' }
const app = '/Applications/Cyberduck.app'

describe('Cyberduck native bridge boundary (mocks only)', () => {
    it('passes bytes directly to the native API and scrubs the original buffer', () => {
        let calls = 0
        const bridge = new CyberduckKeychain('darwin', () => ({
            validateTarget: () => true,
            write: (host, port, user, password, path, owner) => {
                calls++
                assert.deepEqual([host, port, user, path, owner], [target.host, 22, target.username, app, target.ownerId])
                assert.equal(password.toString(), 'mock-password')
                return 'stored'
            },
            revoke: () => 'revoked',
        }))
        const bytes = Buffer.from('mock-password')
        assert.equal(bridge.write(target, bytes, app), 'stored')
        assert.ok(bytes.every(x => x === 0))
        assert.equal(calls, 1)
    })
    it('scrubs bytes even for native failure and does not expose exceptions', () => {
        const bridge = new CyberduckKeychain('darwin', () => { throw Error('mock-secret must not escape') })
        const bytes = Buffer.from('mock-secret')
        assert.equal(bridge.write(target, bytes, app), 'unavailable')
        assert.ok(bytes.every(x => x === 0))
        assert.equal(bridge.revoke(target), 'unavailable')
    })
    it('does not load native code on Windows or Linux', () => {
        for (const platform of ['win32', 'linux']) {
            const bridge = new CyberduckKeychain(platform, () => { assert.fail('unexpected native load') })
            const bytes = Buffer.from('mock')
            assert.equal(bridge.write(target, bytes, app), 'unavailable')
            assert.equal(bridge.revoke(target), 'unavailable')
            assert.ok(bytes.every(x => x === 0))
        }
    })
    it('rejects invalid endpoints, owners, target paths and oversized credentials', () => {
        const bridge = new CyberduckKeychain('darwin', () => { assert.fail('unexpected native load') })
        for (const invalid of [{ ...target, port: 0 }, { ...target, port: 65536 }, { ...target, port: 1.5 },
            { ...target, host: 'user@host' }, { ...target, username: 'user\0' }, { ...target, ownerId: 'ssh:template' }]) {
            const bytes = Buffer.from('mock')
            assert.equal(bridge.write(invalid, bytes, app), 'invalid')
            assert.ok(bytes.every(x => x === 0))
            assert.equal(bridge.revoke(invalid), 'invalid')
        }
        for (const path of ['Cyberduck.app', '/tmp/not-app', '/tmp/Cyberduck.app\0']) {
            assert.equal(bridge.write(target, Buffer.from('mock'), path), 'invalid')
        }
        const bytes = Buffer.alloc(65537, 1)
        assert.equal(bridge.write(target, bytes, app), 'invalid')
        assert.ok(bytes.every(x => x === 0))
    })
    it('sanitizes unexpected native return values and preserves safe conflict status', () => {
        const bridge = new CyberduckKeychain('darwin', () => ({ validateTarget: () => false, write: () => 'conflict', revoke: () => 'sensitive arbitrary error' as any }))
        assert.equal(bridge.write(target, Buffer.from('mock'), app), 'conflict')
        assert.equal(bridge.revoke(target), 'failed')
    })
})
