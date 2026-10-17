import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { buildCyberduckURL, hasCyberduckRoutingRestriction, resolveCyberduckSharing } from '../src/cyberduck.ts'

const target = { host: 'example.invalid', user: 'profile-user' }
const transpile = (file: string) => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
}).outputText
const Platform = { macOS: 'mac', Windows: 'win', Linux: 'linux' }
class SSHTabComponent { }
const core = { Injectable: () => (x: any) => x, Platform, TabContextMenuItemProvider: class {} }
const serviceExports: any = {}
runInNewContext(transpile('../src/services/cyberduck.service.ts'), { Buffer, URL, exports: serviceExports, require: (name: string) => name === '@angular/core' ? core : name === '../cyberduck' ? { buildCyberduckURL, hasCyberduckRoutingRestriction, resolveCyberduckSharing } : core })
const menuExports: any = {}
runInNewContext(transpile('../src/tabContextMenu.ts'), { exports: menuExports, require: (name: string) => name === './components/sshTab.component' ? { SSHTabComponent } : core })

function fixture (platformName = Platform.macOS) {
    const calls: any[] = [], errors: string[] = [], dialogs: any[] = []
    const adapter: any = {
        getCyberduckPath: async () => '/Applications/Cyberduck.app',
        validateCyberduckApplication: async () => true,
        exec: async (...args: any[]) => { calls.push(args) },
        showMessageBox: async (options: any) => { dialogs.push(options); return { response: 0 } },
    }
    const service = new serviceExports.CyberduckService({ platform: platformName }, adapter, { error: (x: string) => errors.push(x) }, { instant: (x: string) => x }, {}, { store: { ssh: { cyberduckPasswordSharingDefault: false } } })
    return { service, adapter, calls, errors, dialogs }
}

describe('Cyberduck credential-free SFTP URL', () => {
    it('encodes username and each directory segment without leaking credentials', () => {
        const profile = { ...target, password: 'SECRET', privateKeyPassphrase: 'KEY_SECRET' }
        const url = new URL(buildCyberduckURL(profile, 'u:p@?#%中文', '/目录 with spaces/a#b?c%2F/$(`x`)'))
        assert.equal(decodeURIComponent(url.username), 'u:p@?#%中文')
        assert.equal(url.password, '')
        assert.equal(decodeURIComponent(url.pathname), '/目录 with spaces/a#b?c%2F/$(`x`)/')
        assert.equal(url.search, '')
        assert.equal(url.hash, '')
        assert.ok(!url.href.includes('SECRET'))
    })
    it('accepts bare and bracketed IPv6 with custom ports', () => {
        for (const host of ['2001:db8::1', '[2001:db8::1]']) {
            const url = new URL(buildCyberduckURL({ ...target, host, port: 2222 }, 'user', '/'))
            assert.equal(url.hostname, '[2001:db8::1]')
            assert.equal(url.port, '2222')
        }
    })
    it('supports IDN hosts and preserves root versus unspecified directories', () => {
        assert.match(buildCyberduckURL({ ...target, host: '例子.example' }, 'user', '/'), /xn--/)
        assert.equal(new URL(buildCyberduckURL(target, 'user', null)).pathname, '')
        assert.equal(new URL(buildCyberduckURL(target, 'user', '/')).pathname, '/')
    })
    it('rejects malformed authorities, ports, relative and control-character paths', () => {
        for (const host of ['user:password@host', 'host/path', 'host?x', 'host\\evil', 'host\n', '[invalid]', 'fe80::1%en0']) assert.throws(() => buildCyberduckURL({ ...target, host }, 'u', '/'))
        for (const port of [0, -1, 65536, 1.5, NaN]) assert.throws(() => buildCyberduckURL({ ...target, port }, 'u', '/'))
        for (const cwd of ['relative', '~', '/a\0b', '/a\nb']) assert.throws(() => buildCyberduckURL(target, 'u', cwd))
    })
})

describe('Cyberduck launch workflow', () => {
    it('passes only public metadata to open using an argv array', async () => {
        const { service, calls } = fixture()
        const options: any = { ...target }
        for (const name of ['password', 'privateKeys', 'passphrase']) Object.defineProperty(options, name, { get: () => { throw Error('credential read') } })
        await service.launch({ options }, 'actual-user', async () => '/a space/中文', () => true)
        assert.equal(calls.length, 1)
        assert.equal(calls[0][0], '/usr/bin/open')
        assert.deepEqual(Array.from(calls[0][1]), ['-a', '/Applications/Cyberduck.app', 'sftp://actual-user@example.invalid:22/a%20space/%E4%B8%AD%E6%96%87/'])
    })
    it('shows a clear missing-install message without launching or reading cwd', async () => {
        const f = fixture()
        f.adapter.getCyberduckPath = async () => null as any
        await f.service.launch({ options: target }, 'u', async () => { throw Error('should not read') }, () => true)
        assert.equal(f.calls.length, 0)
        assert.match(f.errors[0], /not found/)
    })
    it('blocks every Tabby-specific route without silently connecting directly', async () => {
        for (const option of ['jumpHost', 'proxyCommand', 'socksProxyHost', 'httpProxyHost']) {
            const f = fixture()
            await f.service.launch({ options: { ...target, [option]: 'configured' } }, 'u', async () => '/', () => true)
            assert.equal(f.calls.length, 0)
            assert.match(f.dialogs[0].message, /jump host or proxy/)
        }
    })
    it('opens the server directly without a dialog or invented cwd when OSC cwd is unknown', async () => {
        const f = fixture()
        await f.service.launch({ options: target }, 'u', async () => null, () => true)
        assert.equal(f.calls.length, 1)
        assert.equal(f.dialogs.length, 0)
        assert.equal(new URL(f.calls[0][1][2]).pathname, '')
    })
    it('keeps signature checks and session validation before a server-only open', async () => {
        const f = sharingFixture()
        f.adapter.validateCyberduckApplication = async () => false
        await f.service.launch(f.profile, 'u', async () => null, () => true)
        assert.equal(f.calls.length, 0)
        assert.match(f.errors[0], /verified official/)
        const disconnected = fixture()
        let active = true
        await disconnected.service.launch({ options: target }, 'u', async () => { active = false; return null }, () => active)
        assert.equal(disconnected.calls.length, 0)
        assert.equal(disconnected.dialogs.length, 0)
    })
    it('does not launch a disconnected/replaced session or on non-macOS', async () => {
        const f = fixture()
        let active = true
        await f.service.launch({ options: target }, 'u', async () => { active = false; return '/' }, () => active)
        assert.equal(f.calls.length, 0)
        const linux = fixture(Platform.Linux)
        await linux.service.launch({ options: target }, 'u', async () => '/', () => true)
        assert.equal(linux.calls.length, 0)
    })
    it('never displays raw process errors which can include argv', async () => {
        const f = fixture()
        f.adapter.exec = async () => { throw Error('sensitive raw argv') }
        await f.service.launch({ options: target }, 'u', async () => '/', () => true)
        assert.equal(f.calls.length, 0)
        assert.ok(!f.errors[0].includes('sensitive'))
    })
})

describe('SSH tab Cyberduck menu', () => {
    it('is macOS-only, disabled when disconnected, and preserves WinSCP on Windows', async () => {
        const tab: any = new SSHTabComponent()
        tab.sshSession = { open: true, authUsername: 'u' }
        const translate = { instant: (s: string) => s }
        const win = new menuExports.SFTPContextMenu({ platform: Platform.Windows }, { getWinSCPPath: () => 'WinSCP.exe' }, translate, {})
        assert.deepEqual(Array.from(await win.getItems(tab), (x: any) => x.label), ['Open SFTP panel', 'Launch WinSCP'])
        const mac = new menuExports.SFTPContextMenu({ platform: Platform.macOS }, {}, translate, {})
        let items = await mac.getItems(tab)
        assert.equal(items[1].label, 'Open in Cyberduck')
        assert.equal(items[1].enabled, true)
        tab.sshSession.open = false
        items = await mac.getItems(tab)
        assert.equal(items[1].enabled, false)
    })
})

function sharingFixture () {
    const profile: any = { id: 'ssh:custom:test:fixture', options: { ...target, cyberduckPasswordSharing: true } }
    const f = fixture()
    const writes: any[] = [], revokes: any[] = []
    let saved = profile
    const adapter: any = f.adapter
    adapter.shareCyberduckPassword = async (connection: any, bytes: Buffer, app: string) => {
        writes.push({ connection, password: bytes.toString(), bytes, app })
        return 'stored'
    }
    adapter.revokeCyberduckPassword = async (connection: any) => { revokes.push(connection); return 'revoked' }
    const config = { store: { ssh: { cyberduckPasswordSharingDefault: false } }, save: async () => {} }
    const service = new serviceExports.CyberduckService({ platform: Platform.macOS }, adapter,
        { error: (x: string) => f.errors.push(x) }, { instant: (x: string) => x },
        { getProfiles: async () => saved ? [saved] : [], getConfigProxyForProfile: (x: any) => x,
            writeProfile: async (x: any) => { saved = x } }, config)
    return { ...f, profile, service, config, writes, revokes, setSaved: (value: any) => { saved = value }, getSaved: () => saved }
}

describe('Cyberduck opt-in credential lifecycle (mocks only)', () => {
    it('shares only explicitly opted-in persisted direct connections and uses the authenticated username', async () => {
        const f = sharingFixture()
        await f.service.shareAuthenticatedPassword(f.profile, 'actual-user', 'mock-password')
        assert.equal(f.writes.length, 1)
        assert.equal(f.writes[0].connection.username, 'actual-user')
        assert.equal(f.writes[0].connection.host, 'example.invalid')
        assert.equal(f.writes[0].connection.port, 22)
        assert.equal(f.writes[0].password, 'mock-password')
        assert.ok(f.writes[0].bytes.every((x: number) => x === 0))
        for (const options of [{ cyberduckPasswordSharing: false }, { cyberduckPasswordSharing: undefined },
            { jumpHost: 'other' }, { proxyCommand: 'proxy' }]) {
            await f.service.shareAuthenticatedPassword({ ...f.profile, options: { ...f.profile.options, ...options } }, 'u', 'mock-password')
        }
        await f.service.shareAuthenticatedPassword({ ...f.profile, id: 'ssh:template' }, 'u', 'mock-password')
        assert.equal(f.writes.length, 1)
    })
    it('does not treat an unsaved flag as consent or write after a profile is removed/changed', async () => {
        const f = sharingFixture()
        for (const saved of [null, { ...f.profile, options: { ...f.profile.options, cyberduckPasswordSharing: false } },
            { ...f.profile, options: { ...f.profile.options, host: 'changed.invalid' } }]) {
            f.setSaved(saved)
            await f.service.shareAuthenticatedPassword(f.profile, 'u', 'mock-password')
        }
        assert.equal(f.writes.length, 0)
    })
    it('clears bytes and sanitizes a rejected platform write', async () => {
        const f = sharingFixture()
        let received: Buffer
        f.adapter.shareCyberduckPassword = async (_target: any, bytes: Buffer) => { received = bytes; throw Error('mock-password') }
        await f.service.shareAuthenticatedPassword(f.profile, 'u', 'mock-password')
        assert.ok(received!.every(x => x === 0))
        assert.equal(f.errors.length, 1)
        assert.ok(!f.errors[0].includes('mock-password'))
    })
    it('cancels a pending share on disconnect or opt-out', async () => {
        for (const reason of ['disconnect', 'disable']) {
            const f = sharingFixture()
            let resolve: (path: string) => void
            let active = true
            f.adapter.getCyberduckPath = () => new Promise<string>(r => { resolve = r })
            const pending = f.service.shareAuthenticatedPassword(f.profile, 'u', 'mock-password', () => active)
            await Promise.resolve()
            if (reason === 'disconnect') active = false
            else f.service.setSharingEnabled(f.profile, false)
            resolve!('/Applications/Cyberduck.app')
            await pending
            assert.equal(f.writes.length, 0)
        }
    })
    it('waits for authentication sharing before first Cyberduck launch', async () => {
        const f = sharingFixture()
        let resolve: (status: string) => void
        f.adapter.shareCyberduckPassword = () => new Promise<string>(r => { resolve = r })
        const pending = f.service.shareAuthenticatedPassword(f.profile, 'u', 'mock-password')
        const launching = f.service.launch(f.profile, 'u', async () => '/', () => true)
        for (let i = 0; i < 8; i++) await Promise.resolve()
        assert.equal(f.calls.length, 0)
        resolve!('stored')
        await Promise.all([pending, launching])
        assert.equal(f.calls.length, 1)
        assert.ok(!JSON.stringify(f.calls).includes('mock-password'))
    })
    it('does not revoke on cancel, then revokes only its exact target and disables sharing', async () => {
        const f = sharingFixture()
        await f.service.revoke(f.profile)
        assert.equal(f.revokes.length, 0)
        assert.equal(f.profile.options.cyberduckPasswordSharing, true)
        f.adapter.showMessageBox = async () => ({ response: 1 })
        await f.service.revoke(f.profile)
        assert.equal(f.revokes.length, 1)
        assert.equal(f.revokes[0].ownerId, f.profile.id)
        assert.equal(f.profile.options.cyberduckPasswordSharing, false)
        // An already-open session has an old profile snapshot: it still cannot re-create it.
        await f.service.shareAuthenticatedPassword({ ...f.profile, options: { ...f.profile.options, cyberduckPasswordSharing: true } }, 'u', 'mock-password')
        assert.equal(f.writes.length, 0)
    })
    it('invalidates queued writes before an explicit revoke', async () => {
        const f = sharingFixture()
        let resolve: (path: string) => void
        f.adapter.getCyberduckPath = () => new Promise<string>(r => { resolve = r })
        const pending = f.service.shareAuthenticatedPassword(f.profile, 'u', 'mock-password')
        await Promise.resolve()
        f.adapter.showMessageBox = async () => ({ response: 1 })
        const revoke = f.service.revoke(f.profile)
        await Promise.resolve()
        resolve!('/Applications/Cyberduck.app')
        await Promise.all([pending, revoke])
        assert.equal(f.writes.length, 0)
        assert.equal(f.revokes.length, 1)
    })
})


describe('Cyberduck cancellation and durable revocation', () => {
    it('immediately erases pending bytes on session disposal or opt-out before discovery returns', async () => {
        for (const mode of ['dispose', 'disable']) {
            const f = sharingFixture()
            let resolve: (path: string) => void
            f.adapter.getCyberduckPath = () => new Promise<string>(r => { resolve = r })
            const pending = f.service.shareAuthenticatedPassword(f.profile, 'u', 'mock-password')
            const bytes = Array.from(f.service.pendingBytes.get(f.profile.id))[0] as Buffer
            assert.equal(bytes.toString(), 'mock-password')
            await Promise.resolve()
            if (mode === 'dispose') f.service.cancelPendingShares(f.profile.id)
            else f.service.setSharingEnabled(f.profile, false)
            assert.ok(bytes.every(x => x === 0))
            resolve!('/Applications/Cyberduck.app')
            await pending
            assert.equal(f.writes.length, 0)
            assert.equal(f.service.pendingBytes.size, 0)
            assert.equal(f.service.pendingShares.size, 0)
        }
    })
    it('durably disables only the sharing flag when revoking from an unsaved editor', async () => {
        const f = sharingFixture()
        const original = structuredClone(f.profile)
        f.setSaved(original)
        f.adapter.showMessageBox = async (options: any) => {
            assert.ok(options.detail.includes('profile-user@example.invalid:22'))
            return { response: 1 }
        }
        f.profile.name = 'unsaved-name'
        await f.service.revoke(f.profile)
        assert.equal(f.getSaved().options.cyberduckPasswordSharing, false)
        assert.equal(f.getSaved().name, undefined)
        // Simulate a new service process, with no in-memory blocked IDs.
        const restarted = sharingFixture()
        restarted.setSaved(f.getSaved())
        await restarted.service.shareAuthenticatedPassword(restarted.profile, 'u', 'mock-password')
        assert.equal(restarted.writes.length, 0)
    })
    it('rejects changed configured usernames and does not open an unverified app', async () => {
        const f = sharingFixture()
        f.setSaved({ ...f.profile, options: { ...f.profile.options, user: 'changed-user' } })
        await f.service.shareAuthenticatedPassword(f.profile, 'actual-user', 'mock-password')
        assert.equal(f.writes.length, 0)
        f.adapter.validateCyberduckApplication = async () => false
        await f.service.launch(f.profile, 'u', async () => '/', () => true)
        assert.equal(f.calls.length, 0)
        assert.equal(f.errors.length, 1)
    })
})

describe('Cyberduck confirmed global default and explicit overrides', () => {
    it('fails closed on upgrade and preserves explicit false instead of treating it as unset', () => {
        for (const value of [null, undefined, false, 'true', 1]) assert.equal(resolveCyberduckSharing(value, false), false)
        for (const value of [null, undefined, true]) assert.equal(resolveCyberduckSharing(value, true), true)
        for (const value of [false, 'true', 1]) assert.equal(resolveCyberduckSharing(value, true), false)
        assert.equal(resolveCyberduckSharing(true, false), true)
    })
    it('cancelling global consent changes no settings and never reads or writes passwords', async () => {
        const f = sharingFixture()
        let saves = 0
        f.config.save = async () => { saves++ }
        assert.equal(await f.service.setGlobalSharingEnabled(true), false)
        assert.equal(f.config.store.ssh.cyberduckPasswordSharingDefault, false)
        assert.equal(saves, 0)
        assert.equal(f.writes.length, 0)
        assert.equal(f.dialogs[0].defaultId, 0)
        for (const text of ['已有和新建', 'macOS 钥匙串', '官方 Cyberduck', '动态验证码', '不会读取旧密码']) assert.ok(f.dialogs[0].detail.includes(text))
    })
    it('enables the default once without backfilling sessions and shares only on later authentication', async () => {
        const f = sharingFixture()
        delete f.profile.options.cyberduckPasswordSharing
        f.adapter.showMessageBox = async () => ({ response: 1 })
        assert.equal(await f.service.setGlobalSharingEnabled(true), true)
        assert.equal(f.config.store.ssh.cyberduckPasswordSharingDefault, true)
        assert.equal(f.writes.length, 0)
        assert.equal(await f.service.setGlobalSharingEnabled(true), true)
        await f.service.shareAuthenticatedPassword(f.profile, 'u', 'synthetic')
        assert.equal(f.writes.length, 1)
        f.profile.options.cyberduckPasswordSharing = false
        await f.service.shareAuthenticatedPassword(f.profile, 'u', 'synthetic')
        assert.equal(f.writes.length, 1)
    })
    it('uses raw saved profile overrides rather than inherited group values', async () => {
        const f = sharingFixture()
        const raw = { ...f.profile, options: { ...target } }
        ;(f.config.store as any).profiles = [raw]
        f.setSaved(raw)
        // Session proxy says true (e.g. a group), but no raw consent/global consent exists.
        await f.service.shareAuthenticatedPassword(f.profile, 'u', 'synthetic')
        assert.equal(f.writes.length, 0)
        f.config.store.ssh.cyberduckPasswordSharingDefault = true
        await f.service.shareAuthenticatedPassword(f.profile, 'u', 'synthetic')
        assert.equal(f.writes.length, 1)
        ;(raw.options as any).cyberduckPasswordSharing = false
        await f.service.shareAuthenticatedPassword(f.profile, 'u', 'synthetic')
        assert.equal(f.writes.length, 1)
    })
    it('disabling global sharing clears queued buffers before discovery completes', async () => {
        const f = sharingFixture()
        delete f.profile.options.cyberduckPasswordSharing
        f.config.store.ssh.cyberduckPasswordSharingDefault = true
        let resolve: (value: string) => void
        f.adapter.getCyberduckPath = () => new Promise<string>(r => { resolve = r })
        const pending = f.service.shareAuthenticatedPassword(f.profile, 'u', 'synthetic')
        await Promise.resolve()
        const buffers: Set<Buffer> = f.service.pendingBytes.get(f.profile.id)
        assert.ok(buffers.size)
        await f.service.setGlobalSharingEnabled(false)
        for (const bytes of buffers) assert.ok(bytes.every(x => x === 0))
        resolve!('/Applications/Cyberduck.app')
        await pending
        assert.equal(f.writes.length, 0)
    })
    it('revoke persists false so a global default cannot recreate that connection copy', async () => {
        const f = sharingFixture()
        f.profile.options.cyberduckPasswordSharing = null
        f.config.store.ssh.cyberduckPasswordSharingDefault = true
        f.adapter.showMessageBox = async () => ({ response: 1 })
        await f.service.revoke(f.profile)
        assert.equal(f.getSaved().options.cyberduckPasswordSharing, false)
        f.service.blockedProfiles.clear() // Simulate loss of process-only state after restart.
        await f.service.shareAuthenticatedPassword({ ...f.profile, options: { ...f.profile.options, cyberduckPasswordSharing: null } }, 'u', 'synthetic')
        assert.equal(f.writes.length, 0)
    })
})
