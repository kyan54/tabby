import { Component, HostBinding } from '@angular/core'
import { X11Socket } from '../session/x11'
import { ConfigService, HostAppService, Platform } from 'tabby-core'
import { CyberduckService } from '../services/cyberduck.service'

/** @hidden */
@Component({
    templateUrl: './sshSettingsTab.component.pug',
})
export class SSHSettingsTabComponent {
    Platform = Platform
    defaultX11Display: string
    changingCyberduckDefault = false

    async setCyberduckDefault (event: Event): Promise<void> {
        const input = event.target as HTMLInputElement
        const enabled = input.checked
        input.checked = this.config.store.ssh.cyberduckPasswordSharingDefault === true
        if (this.changingCyberduckDefault) {
            return
        }
        this.changingCyberduckDefault = true
        try {
            await this.cyberduck.setGlobalSharingEnabled(enabled)
        } finally {
            this.changingCyberduckDefault = false
            input.checked = this.config.store.ssh.cyberduckPasswordSharingDefault === true
        }
    }

    @HostBinding('class.content-box') true

    constructor (
        public config: ConfigService,
        public hostApp: HostAppService,
        private cyberduck: CyberduckService,
    ) {
        const spec = X11Socket.resolveDisplaySpec()
        if ('path' in spec) {
            this.defaultX11Display = spec.path
        } else {
            this.defaultX11Display = `${spec.host}:${spec.port}`
        }
    }
}
