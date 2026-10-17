import { Injectable } from '@angular/core'
import { ConfigService, CyberduckPasswordTarget, HostAppService, NotificationsService, Platform, PlatformService, ProfilesService, TranslateService } from 'tabby-core'
import type { SSHProfile } from '../api'
import { buildCyberduckURL, hasCyberduckRoutingRestriction } from '../cyberduck'

@Injectable({ providedIn: 'root' })
export class CyberduckService {
    private pendingShares = new Map<string, Promise<void>>()
    private pendingBytes = new Map<string, Set<Buffer>>()
    private blockedProfiles = new Set<string>()
    private generations = new Map<string, number>()

    setSharingEnabled (profile: SSHProfile, enabled: boolean): void {
        profile.options.cyberduckPasswordSharing = enabled
        if (!profile.id) {
            return
        }
        if (enabled) {
            this.blockedProfiles.delete(profile.id)
        } else {
            this.blockedProfiles.add(profile.id)
            this.cancelPendingShares(profile.id)
        }
    }

    cancelPendingShares (id: string): void {
        this.generations.set(id, (this.generations.get(id) ?? 0) + 1)
        for (const bytes of this.pendingBytes.get(id) ?? []) {
            bytes.fill(0)
        }
    }

    private passwordTarget (profile: SSHProfile, username: string): CyberduckPasswordTarget {
        if (!profile.id?.startsWith('ssh:custom:')) {
            throw new Error('A saved connection is required')
        }
        const url = new URL(buildCyberduckURL(profile.options, username, null))
        return {
            host: url.hostname.replace(/^\[|\]$/g, ''),
            port: Number(url.port || 22),
            username,
            ownerId: profile.id,
        }
    }

    /** Called only after ordinary password authentication succeeds, never for MFA. */
    shareAuthenticatedPassword (profile: SSHProfile, username: string, password: string, isActive: () => boolean = () => true): Promise<void> {
        if (this.hostApp.platform !== Platform.macOS || profile.options.cyberduckPasswordSharing !== true ||
            !profile.id?.startsWith('ssh:custom:') || hasCyberduckRoutingRestriction(profile.options) || !isActive()) {
            return Promise.resolve()
        }
        // Do not close over the original immutable JS password across awaits.
        // SSH already owns that string; only our additional mutable copy is tracked.
        const bytes = Buffer.from(password, 'utf8')
        return this.queuePasswordShare(profile, username, bytes, isActive)
    }

    private async queuePasswordShare (profile: SSHProfile, username: string, bytes: Buffer, isActive: () => boolean): Promise<void> {
        const id = profile.id
        const configuredUser = profile.options.user
        const host = profile.options.host
        const port = profile.options.port ?? 22
        const buffers = this.pendingBytes.get(id) ?? new Set<Buffer>()
        buffers.add(bytes)
        this.pendingBytes.set(id, buffers)
        const generation = this.generations.get(id) ?? 0
        // Serialize updates; pending byte buffers can be erased on cancellation.
        const previous = this.pendingShares.get(id)
        const operation = (async () => {
            try {
                await previous
                const target = this.passwordTarget({ id, options: { host, port, user: configuredUser } } as SSHProfile, username)
                const appPath = await this.platform.getCyberduckPath()
                const savedProfile = (await this.profiles.getProfiles({ includeBuiltin: false })).find(x => x.id === id)
                // Consent must be explicit on this profile, never inherited from a group.
                if (savedProfile?.options?.cyberduckPasswordSharing !== true || this.blockedProfiles.has(id)) {
                    return
                }
                const current = this.profiles.getConfigProxyForProfile(savedProfile)
                if (current.options.host !== host || (current.options.port ?? 22) !== port ||
                    current.options.user !== configuredUser || hasCyberduckRoutingRestriction(current.options)) {
                    return
                }
                if (profile.options.cyberduckPasswordSharing !== true || this.blockedProfiles.has(id) || !isActive() ||
                    (this.generations.get(id) ?? 0) !== generation) {
                    return
                }
                if (!appPath) {
                    this.notifications.error(this.translate.instant('Cyberduck password sharing was skipped because Cyberduck is not installed. Reconnect after installing it.'))
                    return
                }
                const status = await this.platform.shareCyberduckPassword(target, bytes, appPath)
                if (status !== 'stored') {
                    this.notifications.error(this.translate.instant(status === 'conflict'
                        ? 'Cyberduck password sharing found an existing Keychain item owned elsewhere. It was not changed.'
                        : 'Cyberduck password sharing did not complete. Check macOS Keychain permissions and the signed application, then reconnect. SSH is still connected.'))
                }
            } catch {
                this.notifications.error(this.translate.instant('Cyberduck password sharing did not complete. SSH is still connected.'))
            } finally {
                bytes.fill(0)
                buffers.delete(bytes)
                if (!buffers.size && this.pendingBytes.get(id) === buffers) {
                    this.pendingBytes.delete(id)
                }
            }
        })()
        this.pendingShares.set(id, operation)
        try {
            await operation
        } finally {
            if (this.pendingShares.get(id) === operation) {
                this.pendingShares.delete(id)
            }
        }
    }

    /** Explicit user flow. Disabling sharing alone never silently removes credentials. */
    async revoke (profile: SSHProfile): Promise<void> {
        if (this.hostApp.platform !== Platform.macOS) {
            return
        }
        try {
            const target = this.passwordTarget(profile, profile.options.user)
            if (target.username.startsWith('$')) {
                this.notifications.error(this.translate.instant('Use the actual SSH username to remove the shared password. Environment-variable usernames cannot be resolved here.'))
                return
            }
            const choice = await this.platform.showMessageBox({
                type: 'warning',
                message: this.translate.instant('Remove this connection’s shared Cyberduck password?'),
                detail: `${target.username}@${target.host}:${target.port}\n` + this.translate.instant('Only the item created by this profile for the currently configured host, port and username will be removed. Sharing will be turned off. If these details changed, remove the old item in Keychain Access. Tabby’s saved password is kept.'),
                buttons: [this.translate.instant('Cancel'), this.translate.instant('Remove shared password')],
                defaultId: 0,
                cancelId: 0,
            })
            if (choice.response !== 1) {
                return
            }
            this.setSharingEnabled(profile, false)
            // Revoke is a standalone action, even if the settings editor is later cancelled.
            // Persist only this flag on the saved profile, never unrelated unsaved edits.
            const savedProfile = (await this.profiles.getProfiles({ includeBuiltin: false, clone: true })).find(x => x.id === target.ownerId)
            if (savedProfile) {
                savedProfile.options = { ...savedProfile.options, cyberduckPasswordSharing: false }
                await this.profiles.writeProfile(savedProfile)
                await this.config.save()
            }
            await this.pendingShares.get(target.ownerId)
            const status = await this.platform.revokeCyberduckPassword(target)
            if (status !== 'revoked' && status !== 'not-found') {
                this.notifications.error(this.translate.instant(status === 'conflict'
                    ? 'This Keychain item belongs to another connection or application and was not removed.'
                    : 'Could not remove the shared password. Sharing is off; check Keychain Access to remove the item manually.'))
            }
        } catch {
            this.notifications.error(this.translate.instant('Could not remove the shared password. Check the configured connection details and Keychain Access.'))
        }
    }

    constructor (
        private hostApp: HostAppService,
        private platform: PlatformService,
        private notifications: NotificationsService,
        private translate: TranslateService,
        private profiles: ProfilesService,
        private config: ConfigService,
    ) { }

    async launch (profile: SSHProfile, username: string|null, getCwd: () => Promise<string|null>, isActive: () => boolean): Promise<void> {
        if (this.hostApp.platform !== Platform.macOS || !isActive()) {
            return
        }
        const target = {
            host: profile.options.host,
            port: profile.options.port,
            user: profile.options.user,
            jumpHost: profile.options.jumpHost,
            proxyCommand: profile.options.proxyCommand,
            socksProxyHost: profile.options.socksProxyHost,
            httpProxyHost: profile.options.httpProxyHost,
        }
        if (hasCyberduckRoutingRestriction(target)) {
            await this.platform.showMessageBox({
                type: 'warning',
                message: this.translate.instant('Cyberduck cannot reuse this Tabby jump host or proxy connection.'),
                detail: this.translate.instant('Configure the route in Cyberduck separately. No direct connection has been opened.'),
                buttons: [this.translate.instant('Close')],
            })
            return
        }
        try {
            const appPath = await this.platform.getCyberduckPath()
            if (!appPath) {
                this.notifications.error(this.translate.instant('Cyberduck was not found. Install it in Applications or open it once so macOS can find it.'))
                return
            }
            if (profile.options.cyberduckPasswordSharing === true && !await this.platform.validateCyberduckApplication(appPath)) {
                this.notifications.error(this.translate.instant('Cyberduck password sharing requires a verified official Cyberduck app and a signed Tabby build. No application was opened.'))
                return
            }
            // Auth sharing starts before SSH becomes ready. Wait before first Cyberduck open.
            if (profile.id) {
                await this.pendingShares.get(profile.id)
            }
            const cwd = await getCwd()
            const url = buildCyberduckURL(target, username ?? target.user, cwd)
            if (cwd === null) {
                const choice = await this.platform.showMessageBox({
                    type: 'warning',
                    message: this.translate.instant('The remote shell has not reported its current directory.'),
                    detail: this.translate.instant('Open only the server? Cyberduck will choose the directory. Authentication is managed by Cyberduck.'),
                    buttons: [this.translate.instant('Cancel'), this.translate.instant('Open server only')],
                    defaultId: 0,
                    cancelId: 0,
                })
                if (choice.response !== 1) {
                    return
                }
            }
            if (!isActive()) {
                return
            }
            // execFile with an argument array: no shell, password, passphrase or key export.
            await this.platform.exec('/usr/bin/open', ['-a', appPath, url])
        } catch {
            // Child-process errors can include argv. Never log or display the raw error.
            this.notifications.error(this.translate.instant('Could not open Cyberduck. Check the application and SSH connection details.'))
        }
    }
}
