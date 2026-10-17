import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import webpack from 'webpack'
import productionConfig from '../webpack.config.mjs'

test('production webpack preserves runtime native loading from packaged resources', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tabby-native-loader-'))
    try {
        const source = await fs.readFile(new URL('../src/services/platform.service.ts', import.meta.url), 'utf8')
        const body = source.match(/const filename = path\.join\(process\.resourcesPath[^]*?return createRequire\(filename\)\(filename\)/)?.[0]
        assert.ok(body, 'exercise the actual packaged native-loader source')
        const entry = path.join(dir, 'entry.mjs')
        await fs.writeFile(entry, `import * as path from 'path'; import { createRequire } from 'module'; export default function () { ${body} }`)
        const resource = path.join(dir, 'cyberduck-keychain')
        await fs.mkdir(resource)
        // A harmless JS stand-in exercises module resolution without Keychain access.
        await fs.writeFile(path.join(resource, 'cyberduck_keychain.node'), 'module.exports = { loadedFromFixedResource: true }')
        const config = productionConfig()
        await new Promise((resolve, reject) => webpack({
            mode: 'production', target: config.target, entry,
            module: { parser: config.module.parser },
            optimization: { minimize: false },
            output: { path: dir, filename: 'bundle.cjs', library: { type: 'commonjs2' } },
        }, (error, stats) => error || stats?.hasErrors() ? reject(error || Error(stats.toString())) : resolve()))
        const require = createRequire(import.meta.url)
        const oldPath = process.resourcesPath
        const nativeExtension = require.extensions['.node']
        try {
            process.resourcesPath = dir
            require.extensions['.node'] = require.extensions['.js']
            assert.equal(require(path.join(dir, 'bundle.cjs')).default().loadedFromFixedResource, true)
        } finally {
            if (oldPath === undefined) delete process.resourcesPath
            else process.resourcesPath = oldPath
            require.extensions['.node'] = nativeExtension
        }
    } finally {
        await fs.rm(dir, { recursive: true, force: true })
    }
})
