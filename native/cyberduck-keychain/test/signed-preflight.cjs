// Metadata-only QA. Run with the signed main or Renderer executable in Node
// bootstrap mode. This script never submits a valid credential-write tuple.
const assert = require('node:assert/strict')
const path = require('node:path')
const executable = process.execPath
const boundary = executable.indexOf('.app/Contents/')
if (!process.versions.electron || boundary < 0) {
    throw new Error('Requires the signed packaged Tabby executable; no Keychain operation attempted.')
}
const root = executable.slice(0, boundary + 4)
const addon = require(path.join(root, 'Contents/Resources/cyberduck-keychain/cyberduck_keychain.node'))
const target = process.argv[2] || '/Applications/Cyberduck.app'
assert.equal(addon.validateTarget(target), true, 'Signed host/official target preflight rejected; no credential operation attempted.')
assert.equal(addon.validateTarget(root), false, 'Wrong target must be rejected')
const bytes = Buffer.from('NON_AUTHENTICATING_TEST_SENTINEL')
assert.equal(addon.write('', 0, '', bytes, target, 'invalid-owner'), 'invalid')
assert.ok(bytes.every(x => x === 0))
assert.equal(addon.revoke('', 0, '', 'invalid-owner'), 'invalid')
console.log(JSON.stringify({
    context: executable.includes('Helper (Renderer)') ? 'signed Renderer executable, Node bootstrap' : 'signed main executable, Node bootstrap',
    nativeLoad: true, officialTargetAccepted: true, wrongTargetRejected: true,
    invalidInputRejected: true, bufferCleared: true,
    keychainLookupOrMutation: false, actualGUIValidation: 'pending',
}))
