import { ConfigProvider } from 'tabby-core'

/** @hidden */
export class SSHConfigProvider extends ConfigProvider {
    defaults = {
        ssh: {
            warnOnClose: false,
            winSCPPath: null,
            cyberduckPasswordSharingDefault: false,
            sftpSort: {
                rules: null,
                field: 'name',
                direction: 'asc',
            },
            agentType: 'auto',
            agentPath: null,
            x11Display: null,
            knownHosts: [],
            verifyHostKeys: true,
        },
        hotkeys: {
            'restart-ssh-session': [],
            'launch-winscp': [],
            'open-sftp': [],
        },
    }

    platformDefaults = { }
}
