import { ConfigProvider } from 'tabby-core'

/** @hidden */
export class SSHConfigProvider extends ConfigProvider {
    defaults = {
        ssh: {
            warnOnClose: false,
            winSCPPath: null,
            sftpSort: {
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
