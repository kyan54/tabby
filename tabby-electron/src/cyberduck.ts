import * as path from 'path'

export async function findCyberduckApplication (home: string, run: (program: string, args: string[]) => Promise<string>): Promise<string|null> {
    const candidates = ['/Applications/Cyberduck.app', path.join(home, 'Applications/Cyberduck.app')]
    try {
        const indexed = await run('/usr/bin/mdfind', ['-0', 'kMDItemCFBundleIdentifier == "ch.sudo.cyberduck"'])
        candidates.push(...indexed.split('\0').filter(Boolean))
    } catch { }
    for (const app of new Set(candidates)) {
        if (!path.isAbsolute(app) || !app.endsWith('.app')) {
            continue
        }
        try {
            const bundle = await run('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', '--', path.join(app, 'Contents/Info.plist')])
            if (bundle.trim() === 'ch.sudo.cyberduck') {
                return app
            }
        } catch { }
    }
    return null
}
