import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'

const source = readFileSync(new URL('../src/addon.cc', import.meta.url), 'utf8')

// These are source-contract guards, NOT macOS runtime or ACL integration tests.
test('native bridge exposes only write, revoke, and preflight', () => {
    const exports = [...source.matchAll(/\{"([a-zA-Z]+)", nullptr, /g)].map(x => x[1])
    assert.deepEqual(exports, ['write', 'revoke', 'validateTarget'])
})

test('bridge never invokes a secret-bearing process or reads password data', () => {
    assert.doesNotMatch(source, /\b(system|popen|execve|posix_spawn|NSLog|printf|fprintf)\s*\(/)
    assert.doesNotMatch(source, /SecKeychainFind(Internet|Generic)Password\s*\(/)
    assert.match(source, /SecKeychainItemCopyContent\(item\.get\(\), nullptr, &requested, nullptr, nullptr\)/)
})

test('creation includes restrictive access atomically', () => {
    assert.match(source, /const void\* apps\[\] = \{host\.get\(\), cyberduck\.get\(\)\}/)
    assert.match(source, /SecKeychainItemCreateFromContent\([\s\S]*?password, keychain\.get\(\), access\.get\(\), item\.out\(\)\)/)
    assert.doesNotMatch(source, /SecKeychainAddInternetPassword\s*\(/)
    assert.match(source, /SecAccessCopyACLList\(access\.get\(\), acls\.out\(\)\)/)
    assert.match(source, /SecACLSetContents\(acl, owner \? hostOnly\.get\(\) : trusted\.get\(\)/)
    assert.match(source, /CFEqual\(checkedApplications\.get\(\), owner \? hostOnly\.get\(\) : trusted\.get\(\)\)/)
})

test('host, target, sealed addon and hardened identity checks remain present', () => {
    assert.match(source, /SecCodeCopySelf/)
    assert.match(source, /SecCodeCheckValidity/)
    assert.match(source, /kSecCSCheckAllArchitectures \| kSecCSCheckNestedCode/)
    assert.match(source, /kSecCodeInfoFlags/)
    assert.match(source, /Contents\/Resources\/cyberduck-keychain\/cyberduck_keychain\.node/)
    assert.match(source, /G69SCX94XU/)
    assert.match(source, /TABBY_KEYCHAIN_TEAM_ID/)
})

test('all owned mutations use item references and secret memory is scoped', () => {
    assert.match(source, /EraseOnExit wipe\(password, size\)/)
    assert.match(source, /SecKeychainItemDelete\(item\.get\(\)\)/)
    assert.match(source, /SecKeychainItemModifyAttributesAndData\(item\.get\(\)/)
    assert.match(source, /isOwned\(marker, tuple\.owner, creatorMatches\)/)
    assert.match(source, /UInt32 port = 0/)
})
