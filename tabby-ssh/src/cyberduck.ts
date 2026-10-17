import { isIP } from 'net'

/** Only an unset override inherits. Explicit false and malformed values never do. */
export function resolveCyberduckSharing (override: unknown, globalDefault: unknown): boolean {
    return override === true || (override == null && globalDefault === true)
}

export interface CyberduckTarget {
    host: string
    port?: number
    user: string
    jumpHost?: string|null
    proxyCommand?: string|null
    socksProxyHost?: string|null
    httpProxyHost?: string|null
}

export function hasCyberduckRoutingRestriction (target: CyberduckTarget): boolean {
    return [target.jumpHost, target.proxyCommand, target.socksProxyHost, target.httpProxyHost].some(value => !!value)
}

function encodePart (value: string): string {
    return encodeURIComponent(value).replace(/[!'()*]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase())
}

/** Only public connection metadata is accepted. Never accept credentials here. */
export function buildCyberduckURL (target: CyberduckTarget, username: string, cwd: string|null): string {
    let host = target.host
    if (host.startsWith('[') && host.endsWith(']')) {
        host = host.slice(1, -1)
        if (isIP(host) !== 6) {
            throw new Error('Invalid IPv6 address')
        }
    }
    if (isIP(host) === 6 && !host.includes('%')) {
        host = `[${host}]`
    } else {
        if (!host || /[\s\\/:@?#%\[\]]/.test(host)) {
            throw new Error('Invalid SFTP host')
        }
        host = new URL(`https://${host}`).hostname
        if (!/^[a-z\d._-]+$/i.test(host)) {
            throw new Error('Invalid SFTP host')
        }
    }
    const port = target.port ?? 22
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !username || /[\x00-\x1f\x7f]/.test(username)) {
        throw new Error('Invalid SFTP connection parameters')
    }
    const url = new URL(`sftp://${host}:${port}`)
    url.username = encodePart(username)
    if (cwd !== null) {
        if (!cwd.startsWith('/') || /[\x00-\x1f\x7f]/.test(cwd)) {
            throw new Error('Invalid remote working directory')
        }
        url.pathname = cwd.split('/').map(encodePart).join('/') + (cwd.endsWith('/') ? '' : '/')
    }
    return url.toString()
}
