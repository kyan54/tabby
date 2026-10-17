import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

test('exact partition metadata and public ACL API operate in memory without Keychain item imports', {
    skip: process.platform !== 'darwin' ? 'Requires macOS Security.framework.' : false,
    timeout: 30000,
}, () => {
    const directory = mkdtempSync(join(tmpdir(), 'tabby-partition-memory-'))
    try {
        const executable = join(directory, 'partition-test')
        execFileSync('clang++', ['-std=c++17', '-Wall', '-Wextra', '-Werror', '-Wno-deprecated-declarations',
            fileURLToPath(new URL('./partition.test.cc', import.meta.url)), '-framework', 'Security', '-framework', 'CoreFoundation', '-o', executable], { stdio: 'pipe' })
        const imports = execFileSync('nm', ['-u', executable], { encoding: 'utf8' })
        assert.doesNotMatch(imports, /SecKeychain(Item|Find|Search|Add|Copy|Set)/)
        assert.match(execFileSync(executable, [], { encoding: 'utf8' }), /in-memory public API tests passed/)
    } finally {
        rmSync(directory, { recursive: true, force: true })
    }
})
