import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { buildCyberduckURL, hasCyberduckRoutingRestriction } from '../src/cyberduck.ts'

const target = { host: 'example.invalid', user: 'profile-user' }
const transpile = (file: string) => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
}).outputText
const Platform = { macOS: 'mac', Windows: 'win', Linux: 'linux' }
class SSHTabComponent { }
const core = { Injectable: () => (x: any) => x, Platform, TabContextMenuItemProvider: class {} }
const serviceExports: any = {}
runInNewContext(transpile('../src/services/cyberduck.service.ts'), { exports: serviceExports, require: (name: string) => name === '@angular/core' ? core : name === '../cyberduck' ? { buildCyberduckURL, hasCyberduckRoutingRestriction } : core })
const menuExports: any = {}
runInNewContext(transpile('../src/tabContextMenu.ts'), { exports: menuExports, require: (name: string) => name === './components/sshTab.component' ? { SSHTabComponent } : core })

function fixture (platformName = Platform.macOS) {
    const calls: any[] = [], errors: string[] = [], dialogs: any[] = []
    const adapter = {
        getCyberduckPath: async () => '/Applications/Cyberduck.app',
        exec: async (...args: any[]) => { calls.push(args) },
        showMessageBox: async (options: any) => { dialogs.push(options); return { response: 0 } },
    }
    const service = new serviceExports.CyberduckService({ platform: platformName }, adapter, { error: (x: string) => errors.push(x) }, { instant: (x: string) => x })
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
    it('defaults to cancel on missing OSC cwd and requires explicit server-only consent', async () => {
        const f = fixture()
        await f.service.launch({ options: target }, 'u', async () => null, () => true)
        assert.equal(f.calls.length, 0)
        assert.equal(f.dialogs[0].defaultId, 0)
        f.adapter.showMessageBox = async () => ({ response: 1 })
        await f.service.launch({ options: target }, 'u', async () => null, () => true)
        assert.equal(new URL(f.calls[0][1][2]).pathname, '')
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
