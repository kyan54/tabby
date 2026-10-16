import { Injectable } from '@angular/core'
import { HostAppService, NotificationsService, Platform, PlatformService, TranslateService } from 'tabby-core'
import type { SSHProfile } from '../api'
import { buildCyberduckURL, hasCyberduckRoutingRestriction } from '../cyberduck'

@Injectable({ providedIn: 'root' })
export class CyberduckService {
    constructor (
        private hostApp: HostAppService,
        private platform: PlatformService,
        private notifications: NotificationsService,
        private translate: TranslateService,
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
