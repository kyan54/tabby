import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { selectNextAuthMethod, updateAuthPlanAfterFailure } from '../src/session/authMethodSelection.ts'
import { resolveCyberduckSharing } from '../src/cyberduck.ts'

// Run the real authentication control flow with only transport, UI, and Keychain
// adapters replaced. These tests never connect to a server or write credentials.
const Platform = { macOS: 'mac', Windows: 'win', Linux: 'linux' }
class CyberduckService { }
class AuthenticatedSSHClient { }
class SSHClient {
    disconnect$ = { subscribe: () => ({ unsubscribe () { } }) }
    async authenticateNone () { return { remainingMethods: [] } }
    async authenticateWithPassword (_username: string, _password: string): Promise<any> { return new AuthenticatedSSHClient() }
    async authenticateWithKeyPair () { return new AuthenticatedSSHClient() }
    async authenticateWithAgent () { return new AuthenticatedSSHClient() }
    async startKeyboardInteractiveAuthentication (): Promise<any> {
        return { state: 'pending', name: 'MFA', instructions: '', prompts: () => [{ prompt: 'Password:' }, { prompt: 'One-time code:' }] }
    }
    async continueKeyboardInteractiveAuthentication (_responses: string[]) { return new AuthenticatedSSHClient() }
}
const compiled = ts.transpileModule(readFileSync(new URL('../src/session/ssh.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const exports: any = {}
runInNewContext(compiled, {
    exports,
    require: (name: string) => {
        if (name === 'tabby-core') return { Platform }
        if (name === 'russh') return { SSHClient, AuthenticatedSSHClient }
        if (name === '../services/cyberduck.service') return { CyberduckService }
        if (name === '../cyberduck') return { resolveCyberduckSharing }
        if (name === './authMethodSelection') return { selectNextAuthMethod, updateAuthPlanAfterFailure }
        return {}
    },
})

function fixture (methods: any[], sharing: any = true, platform = Platform.macOS) {
    const shared: any[][] = [], errors: string[] = [], logged: string[] = []
    const session: any = Object.create(exports.SSHSession.prototype)
    const service = { shareAuthenticatedPassword: async (...args: any[]) => { shared.push(args) } }
    Object.assign(session, {
        profile: { id: 'ssh:custom:test:uuid', options: { host: 'host.invalid', user: '$SSH_USER', cyberduckPasswordSharing: sharing } },
        authUsername: 'resolved-user',
        ssh: new SSHClient(),
        allAuthMethods: methods,
        previouslyDisconnected: false,
        hostApp: { platform },
        config: { store: { ssh: { cyberduckPasswordSharingDefault: false } } },
        notifications: { error: (message: string) => { errors.push(message) } },
        translate: { instant: (message: string) => message },
        injector: { get: (token: any) => { assert.equal(token, CyberduckService); return service } },
        passwordStorage: { loadPassword: async () => null },
        ngbModal: { open: () => ({ componentInstance: {}, result: Promise.resolve({ value: 'prompt-secret', remember: false }) }) },
        emitServiceMessage: (message: string) => { logged.push(message) },
        emitKeyboardInteractivePrompt: (prompt: any) => { prompt.responses[0] = 'interactive-secret'; prompt.responses[1] = '123456'; prompt.respond() },
        loadPrivateKey: async () => ({}),
    })
    return { session, service, shared, errors, logged }
}

describe('Cyberduck ordinary-password authentication capture', () => {
    it('shares a successful saved password with the resolved username without retaining another session secret', async () => {
        const f = fixture([{ type: 'saved-password', password: 'saved-secret' }])
        assert.ok(await f.session.handleAuth() instanceof AuthenticatedSSHClient)
        assert.equal(f.shared.length, 1)
        assert.equal(f.shared[0][0], f.session.profile)
        assert.equal(f.shared[0][1], 'resolved-user')
        assert.equal(f.shared[0][2], 'saved-secret')
        assert.equal(f.session.savedPassword, undefined)
        assert.equal(f.shared[0][3](), true)
        f.session.previouslyDisconnected = true
        assert.equal(f.shared[0][3](), false)
        assert.ok(!f.logged.join(' ').includes('saved-secret'))
    })

    it('shares only the successful prompted attempt, including an accepted empty password', async () => {
        for (const password of ['prompt-secret', '']) {
            const f = fixture([{ type: 'saved-password', password: 'rejected-secret' }, { type: 'prompt-password' }])
            f.session.ngbModal.open = () => ({ componentInstance: {}, result: Promise.resolve({ value: password, remember: false }) })
            f.session.ssh.authenticateWithPassword = async (_username: string, candidate: string) => candidate === 'rejected-secret'
                ? { remainingMethods: ['password'] } : new AuthenticatedSSHClient()
            assert.ok(await f.session.handleAuth() instanceof AuthenticatedSSHClient)
            assert.equal(f.shared.length, 1)
            assert.equal(f.shared[0][2], password)
            assert.equal(f.session.savedPassword, undefined)
        }
    })

    it('does not share rejected or cancelled password attempts', async () => {
        const f = fixture([{ type: 'saved-password', password: 'rejected-secret' }, { type: 'prompt-password' }])
        f.session.ssh.authenticateWithPassword = async () => ({ remainingMethods: ['password'] })
        f.session.ngbModal.open = () => ({ componentInstance: {}, result: Promise.reject(new Error('Cancelled')) })
        assert.equal(await f.session.handleAuth(), null)
        assert.equal(f.shared.length, 0)
    })

    it('never shares passwords from a partial-success MFA flow or keyboard-interactive answers', async () => {
        for (const methods of [
            [{ type: 'saved-password', password: 'partial-secret' }],
            [{ type: 'keyboard-interactive', savedPassword: 'interactive-secret' }],
        ]) {
            const f = fixture(methods)
            f.session.ssh.authenticateWithPassword = async () => ({ partialSuccess: true, remainingMethods: ['keyboard-interactive'] })
            assert.ok(await f.session.handleAuth() instanceof AuthenticatedSSHClient)
            assert.equal(f.shared.length, 0)
        }
    })

    it('does not share credentials after key, agent, or none authentication', async () => {
        for (const methods of [[{ type: 'publickey', name: 'key', contents: null }], [{ type: 'agent' }], []]) {
            const f = fixture(methods)
            if (!methods.length) f.session.ssh.authenticateNone = async () => new AuthenticatedSSHClient()
            assert.ok(await f.session.handleAuth() instanceof AuthenticatedSSHClient)
            assert.equal(f.shared.length, 0)
        }
    })

    it('requires explicit true opt-in and macOS before resolving the sharing service', async () => {
        for (const [sharing, platform] of [[false, Platform.macOS], [null, Platform.macOS], ['true', Platform.macOS], [true, Platform.Windows], [true, Platform.Linux]]) {
            const f = fixture([{ type: 'saved-password', password: 'secret' }], sharing, platform as string)
            f.session.injector.get = () => assert.fail('Sharing service must not be resolved')
            assert.ok(await f.session.handleAuth() instanceof AuthenticatedSSHClient)
            assert.equal(f.shared.length, 0)
        }
    })

    it('does not block successful SSH authentication while Keychain approval is pending', async () => {
        const f = fixture([{ type: 'saved-password', password: 'secret' }])
        let release: (() => void)|undefined
        f.service.shareAuthenticatedPassword = () => new Promise<void>(resolve => { release = resolve })
        assert.ok(await f.session.handleAuth() instanceof AuthenticatedSSHClient)
        assert.ok(release)
        release()
    })

    it('isolates sharing failures and never exposes raw secret-bearing error details', async () => {
        const f = fixture([{ type: 'saved-password', password: 'secret' }])
        f.service.shareAuthenticatedPassword = async () => { throw new Error('SECRET_RAW_KEYCHAIN_ERROR') }
        assert.ok(await f.session.handleAuth() instanceof AuthenticatedSSHClient)
        assert.equal(f.errors.length, 1)
        assert.ok(!f.errors[0].includes('SECRET_RAW'))
        assert.ok(!f.logged.join(' ').includes('SECRET_RAW'))
    })
})

describe('Cyberduck global-default authentication capture', () => {
    it('captures only a new successful ordinary password authentication when global consent is enabled', async () => {
        const f = fixture([{ type: 'saved-password', password: 'synthetic' }], null)
        f.session.config = { store: { ssh: { cyberduckPasswordSharingDefault: true }, profiles: [{ id: f.session.profile.id, options: {} }] } }
        assert.equal(f.shared.length, 0)
        assert.ok(await f.session.handleAuth() instanceof AuthenticatedSSHClient)
        assert.equal(f.shared.length, 1)
    })
    it('keeps raw explicit opt-out stronger than global consent and stale session snapshots', async () => {
        const f = fixture([{ type: 'saved-password', password: 'synthetic' }], true)
        f.session.config = { store: { ssh: { cyberduckPasswordSharingDefault: true }, profiles: [{ id: f.session.profile.id, options: { cyberduckPasswordSharing: false } }] } }
        f.session.injector.get = () => assert.fail('No sharing service for opted-out connection')
        assert.ok(await f.session.handleAuth() instanceof AuthenticatedSSHClient)
        assert.equal(f.shared.length, 0)
    })
})
