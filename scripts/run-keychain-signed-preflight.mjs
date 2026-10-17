import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'
import fuses from '@electron/fuses'
import { canBootstrapForQA } from './qa-bootstrap-policy.mjs'

const args = process.argv.slice(2)
const renderer = args.includes('--renderer')
const paths = args.filter(x => x !== '--renderer')
if (paths.length < 1 || paths.length > 2) throw new Error('Pass candidate Tabby.app, optional Cyberduck.app, and optional --renderer.')
const app = resolve(paths[0])
const wire = await fuses.getCurrentFuseWire(app)
if (!canBootstrapForQA(wire)) {
    console.info(JSON.stringify({ result: 'not-executed', reason: 'RunAsNode disabled or unsupported; no fuse changed', keychainLookupOrMutation: false }))
    process.exit(2)
}
const requirement = 'anchor apple generic and identifier "org.tabby" and certificate leaf[subject.OU] = "37BL9CNF8B"'
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', requirement, app], { timeout: 45000, stdio: 'inherit' })
execFileSync('/usr/sbin/spctl', ['--assess', '--type', 'execute', app], { timeout: 45000, stdio: 'inherit' })
const executable = renderer ? join(app, 'Contents/Frameworks/Tabby Helper (Renderer).app/Contents/MacOS/Tabby Helper (Renderer)') : join(app, 'Contents/MacOS/Tabby')
const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
delete env.NODE_OPTIONS
delete env.NODE_PATH
execFileSync(executable, [fileURLToPath(new URL('../native/cyberduck-keychain/test/signed-preflight.cjs', import.meta.url)), paths[1] || '/Applications/Cyberduck.app'], { env, timeout: 45000, stdio: 'inherit' })
