import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

test('native portable validation, ownership and erasure policy', {
    timeout: 20000,
    skip: process.platform === 'win32' ? 'Requires a POSIX C++17 compiler (Linux/macOS CI).' : false,
}, () => {
    const directory = mkdtempSync(join(tmpdir(), 'tabby-keychain-policy-'))
    const executable = join(directory, 'policy-test')
    try {
        execFileSync(process.env.CXX || 'c++', ['-std=c++17', '-Wall', '-Wextra', '-Werror',
            fileURLToPath(new URL('./policy.test.cc', import.meta.url)), '-o', executable], {
            timeout: 15000,
            stdio: 'pipe',
        })
        const output = execFileSync(executable, [], { timeout: 3000, encoding: 'utf8' })
        assert.match(output, /Native policy tests passed/)
    } finally {
        rmSync(directory, { recursive: true, force: true })
    }
})
