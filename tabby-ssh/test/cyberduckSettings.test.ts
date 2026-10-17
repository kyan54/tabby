import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import deepClone from 'clone-deep'
import deepEqual from 'deep-equal'

const Platform = { macOS: 'mac', Windows: 'win', Linux: 'linux' }
const decorator = () => () => { }
function load (file: string): any {
    const exports: any = {}
    const compiled = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText
    runInNewContext(compiled, {
        exports,
        require: (name: string) => {
            if (name === '@angular/core') return { Component: decorator, Injectable: decorator, ViewChild: decorator, HostBinding: decorator }
            if (name === 'tabby-core') return { Platform, QuickConnectProfileProvider: class { } }
            if (name === '../session/x11') return { X11Socket: { resolveDisplaySpec: () => ({ host: 'localhost', port: 6000 }) } }
            if (name === 'thenby') return { firstBy: () => () => 0 }
            if (name === '../api' || name === './api') return { SSHAlgorithmType: {} }
            return {}
        },
    })
    return exports
}
const { SSHProfileSettingsComponent } = load('../src/components/sshProfileSettings.component.ts')
const { SSHProfilesService } = load('../src/profiles.ts')

function fixture (platform = Platform.macOS) {
    const changed: any[][] = [], revoked: any[] = []
    const cyberduck = {
        setSharingEnabled: (profile: any, enabled: boolean) => { changed.push([profile, enabled]); profile.options.cyberduckPasswordSharing = enabled },
        revoke: async (profile: any) => { revoked.push(profile) },
    }
    const component = new SSHProfileSettingsComponent(
        { platform },
        { getProfiles: async () => [] },
        {}, {}, {}, {}, {}, cyberduck,
    )
    component.profile = { id: 'ssh:custom:test:uuid', isBuiltin: false, isTemplate: false, options: { user: '', algorithms: {}, cyberduckPasswordSharing: false } }
    return { component, cyberduck, changed, revoked }
}

describe('Cyberduck profile password-sharing controls', () => {
    it('defaults to disabled for existing and new profiles', () => {
        const profiles = new SSHProfilesService({}, {}, {})
        assert.equal(profiles.configDefaults.options.cyberduckPasswordSharing, null)
    })

    it('resets inherited consent for new, duplicated, builtin, template and default editors', async () => {
        for (const patch of [{ id: '' }, { id: undefined }, { isBuiltin: true }, { isTemplate: true }, { id: 'ssh:template' }]) {
            const f = fixture()
            Object.assign(f.component.profile, patch)
            f.component.profile.options.cyberduckPasswordSharing = true
            await f.component.ngOnInit()
            assert.equal(f.component.canShareCyberduckPassword, false)
            assert.equal(f.component.profile.options.cyberduckPasswordSharing, null)
            f.component.setCyberduckPasswordSharing(true)
            assert.equal(f.changed.length, 0)
        }
    })

    it('keeps saved per-profile consent and sends toggle changes to the service', async () => {
        const f = fixture()
        f.component.profile.options.cyberduckPasswordSharing = true
        await f.component.ngOnInit()
        assert.equal(f.component.canShareCyberduckPassword, true)
        assert.equal(f.component.profile.options.cyberduckPasswordSharing, true)
        f.component.setCyberduckPasswordSharing(false)
        assert.equal(f.changed.length, 1)
        assert.equal(f.changed[0][0], f.component.profile)
        assert.equal(f.changed[0][1], false)
        assert.equal(f.component.profile.options.cyberduckPasswordSharing, false)
        assert.equal(f.revoked.length, 0)
    })

    it('does not expose sharing or revocation actions on Windows or Linux', async () => {
        for (const platform of [Platform.Windows, Platform.Linux]) {
            const f = fixture(platform)
            f.component.setCyberduckPasswordSharing(true)
            await f.component.revokeCyberduckPassword()
            assert.equal(f.changed.length, 0)
            assert.equal(f.revoked.length, 0)
        }
    })

    it('allows deliberate revocation while sharing is disabled and prevents repeated clicks', async () => {
        const f = fixture()
        let release: (() => void)|undefined
        f.cyberduck.revoke = async profile => {
            f.revoked.push(profile)
            await new Promise<void>(resolve => { release = resolve })
        }
        const pending = f.component.revokeCyberduckPassword()
        assert.equal(f.component.revokingCyberduckPassword, true)
        await f.component.revokeCyberduckPassword()
        assert.equal(f.revoked.length, 1)
        assert.equal(f.revoked[0], f.component.profile)
        release!()
        await pending
        assert.equal(f.component.revokingCyberduckPassword, false)
    })

    it('keeps the disclosure beside a macOS-only tri-state select and a separate revoke button', () => {
        const template = readFileSync(new URL('../src/components/sshProfileSettings.component.pug', import.meta.url), 'utf8')
        assert.match(template, /\*ngIf='hostApp\.platform === Platform\.macOS'/)
        for (const value of ['null', 'true', 'false']) assert.ok(template.includes(`[ngValue]='${value}'`))
        assert.match(template, /additional encrypted Internet Password/)
        assert.match(template, /official Cyberduck app can access/)
        assert.match(template, /macOS may ask for permission locally/)
        assert.match(template, /then fully reconnect/)
        assert.match(template, /Turning this off stops future updates/)
        assert.match(template, /It does not remove the shared password/)
        assert.match(template, /configured host, port and username/)
        assert.match(template, /\(click\)='revokeCyberduckPassword\(\)'/)
    })
})


const { SSHSettingsTabComponent } = load('../src/components/sshSettingsTab.component.ts')
describe('Cyberduck global default control', () => {
    it('restores unchecked UI state on cancellation without a two-way settings mutation', async () => {
        const config = { store: { ssh: { cyberduckPasswordSharingDefault: false } } }
        let calls = 0
        const service = { setGlobalSharingEnabled: async (enabled: boolean) => { assert.equal(enabled, true); calls++; return false } }
        const component = new SSHSettingsTabComponent(config, { platform: Platform.macOS }, service)
        const input = { checked: true }
        await component.setCyberduckDefault({ target: input })
        assert.equal(input.checked, false)
        assert.equal(config.store.ssh.cyberduckPasswordSharingDefault, false)
        assert.equal(component.changingCyberduckDefault, false)
        assert.equal(calls, 1)
    })
    it('preserves explicit false and resets inherited group consent using the real ConfigProxy', async () => {
        const source = readFileSync(new URL('../../tabby-core/src/services/config.service.ts', import.meta.url), 'utf8')
        const start = source.indexOf('function isStructuralMember')
        const end = source.indexOf("@Injectable({ providedIn: 'root' })", start)
        const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
        const exported: any = {}
        runInNewContext(code, { exports: exported, deepClone, deepEqual, Object, Array })
        for (const raw of [{ cyberduckPasswordSharing: false }, {}] as any[]) {
            const f = fixture()
            f.component.profile.options = new exported.ConfigProxy(raw, { cyberduckPasswordSharing: false, user: '', algorithms: {} })
            await f.component.ngOnInit()
            assert.equal(f.component.profile.options.cyberduckPasswordSharing, raw.cyberduckPasswordSharing === false ? false : null)
            f.component.setCyberduckPasswordSharing(false)
            f.component.profile.options.__cleanup()
            assert.equal(raw.cyberduckPasswordSharing, false)
        }
    })
})
