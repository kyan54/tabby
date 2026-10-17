import type { CyberduckPasswordStatus, CyberduckPasswordTarget } from 'tabby-core'

interface NativeKeychain {
    validateTarget: (appPath: string) => unknown
    write: (host: string, port: number, username: string, password: Buffer, appPath: string, ownerId: string) => CyberduckPasswordStatus
    revoke: (host: string, port: number, username: string, ownerId: string) => CyberduckPasswordStatus
}

const statuses = new Set<CyberduckPasswordStatus>(['stored', 'revoked', 'not-found', 'conflict', 'denied', 'unavailable', 'invalid', 'failed'])

/** Direct N-API calls: no child process, IPC listener, argv, environment, or files. */
export class CyberduckKeychain {
    constructor (private platform: string, private load: () => NativeKeychain) { }

    private validTarget (target: CyberduckPasswordTarget): boolean {
        return typeof target.host === 'string' && target.host.length > 0 && target.host.length <= 253 &&
            !/[\s\x00-\x1f\x7f/@?#%\\]/.test(target.host) &&
            Number.isInteger(target.port) && target.port > 0 && target.port <= 65535 &&
            typeof target.username === 'string' && target.username.length > 0 && target.username.length <= 1024 &&
            !/[\x00-\x1f\x7f]/.test(target.username) &&
            typeof target.ownerId === 'string' && target.ownerId.startsWith('ssh:custom:') && target.ownerId.length <= 1024
    }

    validateTarget (appPath: string): boolean {
        try {
            return this.platform === 'darwin' && this.load().validateTarget(appPath) === true
        } catch {
            return false
        }
    }

    write (target: CyberduckPasswordTarget, password: Buffer, appPath: string): CyberduckPasswordStatus {
        try {
            if (this.platform !== 'darwin') {
                return 'unavailable'
            }
            if (!this.validTarget(target) || !Buffer.isBuffer(password) || password.length > 65536 ||
                typeof appPath !== 'string' || !appPath.startsWith('/') || !appPath.endsWith('.app') || /[\x00-\x1f\x7f]/.test(appPath)) {
                return 'invalid'
            }
            const status = this.load().write(target.host, target.port, target.username, password, appPath, target.ownerId)
            return statuses.has(status) ? status : 'failed'
        } catch {
            // Native load and OS failures must not include a password in diagnostics.
            return 'unavailable'
        } finally {
            if (Buffer.isBuffer(password)) {
                password.fill(0)
            }
        }
    }

    revoke (target: CyberduckPasswordTarget): CyberduckPasswordStatus {
        try {
            if (this.platform !== 'darwin') {
                return 'unavailable'
            }
            if (!this.validTarget(target)) {
                return 'invalid'
            }
            const status = this.load().revoke(target.host, target.port, target.username, target.ownerId)
            return statuses.has(status) ? status : 'failed'
        } catch {
            return 'unavailable'
        }
    }
}
