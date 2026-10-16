import { Injectable } from '@angular/core'
import { BaseTabComponent, TabContextMenuItemProvider, HostAppService, Platform, MenuItemOptions, TranslateService } from 'tabby-core'
import { SSHTabComponent } from './components/sshTab.component'
import { CyberduckService } from './services/cyberduck.service'
import { SSHService } from './services/ssh.service'


/** @hidden */
@Injectable()
export class SFTPContextMenu extends TabContextMenuItemProvider {
    weight = 10

    constructor (
        private hostApp: HostAppService,
        private ssh: SSHService,
        private translate: TranslateService,
        private cyberduck: CyberduckService,
    ) {
        super()
    }

    async getItems (tab: BaseTabComponent): Promise<MenuItemOptions[]> {
        if (!(tab instanceof SSHTabComponent)) {
            return []
        }
        const items: MenuItemOptions[] = [{
            label: this.translate.instant('Open SFTP panel'),
            click: () => {
                tab.openSFTP()
            },
        }]
        if (this.hostApp.platform === Platform.Windows && this.ssh.getWinSCPPath()) {
            items.push({
                label: this.translate.instant('Launch WinSCP'),
                click: (): void => {
                    this.ssh.launchWinSCP(tab.sshSession!)
                },
            })
        }
        if (this.hostApp.platform === Platform.macOS) {
            items.push({
                label: this.translate.instant('Open in Cyberduck'),
                enabled: !!tab.sshSession?.open,
                click: async () => {
                    const session = tab.sshSession
                    const shell = tab.session
                    if (session) {
                        await this.cyberduck.launch(tab.profile, session.authUsername,
                            () => shell?.getWorkingDirectory() ?? Promise.resolve(null),
                            () => tab.sshSession === session && tab.session === shell && session.open)
                    }
                },
            })
        }
        return items
    }
}
