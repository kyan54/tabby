const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { publish, validateArtifacts } = require('../publish-macos-release.cjs')
const sha = 'a'.repeat(40)
function fixture () {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tabby-release-test-'))
    const metadata = { version: '1.2.3', tag: 'macos-v1.2.3' }
    fs.writeFileSync(path.join(directory, 'BUILD_INFO.json'), JSON.stringify({ commit: sha, version: metadata.version,
        architecture: 'arm64', developer_id_signing_requested: true, notarization_requested: true }))
    fs.writeFileSync(path.join(directory, 'SIGNATURE_INFO.txt'), 'Developer ID Application: fixture\nThe validate action worked!\nsource=Notarized Developer ID\n')
    for (const ext of ['zip', 'dmg']) {
        const name = `tabby-${metadata.version}-macos-arm64.${ext}`
        fs.writeFileSync(path.join(directory, name), `synthetic ${ext}`)
        const hash = crypto.createHash('sha256').update(`synthetic ${ext}`).digest('hex')
        fs.writeFileSync(path.join(directory, `SHA256SUMS-${ext}.txt`), `${hash}  ${name}\n`)
    }
    const calls = [], uploaded = []
    let failUpload = false, master = sha, tag = null
    const missing = () => { throw Object.assign(new Error('missing'), { status: 404 }) }
    const github = { rest: {
        git: {
            getRef: async ({ ref }) => ref === 'heads/master' ? { data: { object: { sha: master } } } : tag ? { data: { object: { sha: tag } } } : missing(),
            createRef: async args => { calls.push(['tag', args.sha]); tag = args.sha },
        },
        repos: {
            getReleaseByTag: async () => missing(),
            createRelease: async args => { calls.push(['draft', args.draft]); return { data: { id: 7, draft: true, target_commitish: sha } } },
            listReleaseAssets: async () => ({ data: uploaded }),
            deleteReleaseAsset: async () => { throw Error('unexpected deletion') },
            uploadReleaseAsset: async args => { if (failUpload) throw Error('synthetic upload failure'); calls.push(['upload', args.name]); uploaded.push({ name: args.name, size: args.data.length }) },
            updateRelease: async args => { calls.push(['public', args.draft]); return { data: { html_url: 'https://github.com/example/repo/releases/tag/'+metadata.tag } } },
        },
    } }
    return { directory, metadata, calls, args: { github, context: { repo: { owner: 'example', repo: 'repo' }, sha, runId: 1 }, core: { notice () {} }, directory, metadata, notes: '{{VERSION}} {{SHA}} {{RUN_URL}}' },
        failUpload: () => { failUpload = true }, moveMaster: () => { master = 'b'.repeat(40) }, conflictTag: () => { tag = 'c'.repeat(40) },
        cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) }
}
test('publishes only after matching provenance, checksums and all five draft assets', async () => {
    const f = fixture(); try {
        await publish(f.args)
        assert.deepEqual(f.calls[0], ['tag', sha])
        assert.deepEqual(f.calls[1], ['draft', true])
        assert.equal(f.calls.filter(x => x[0] === 'upload').length, 5)
        assert.deepEqual(f.calls.at(-1), ['public', false])
    } finally { f.cleanup() }
})
test('checksum, source SHA and missing notarization evidence fail before mutation', async () => {
    for (const mode of ['checksum', 'sha', 'notary']) {
        const f = fixture(); try {
            if (mode === 'checksum') fs.appendFileSync(path.join(f.directory, 'tabby-1.2.3-macos-arm64.zip'), 'corrupt')
            if (mode === 'notary') fs.writeFileSync(path.join(f.directory, 'SIGNATURE_INFO.txt'), 'unsigned')
            await assert.rejects(publish(mode === 'sha' ? { ...f.args, context: { ...f.args.context, sha: 'b'.repeat(40) } } : f.args))
            assert.deepEqual(f.calls, [])
        } finally { f.cleanup() }
    }
})
test('moved master and conflicting tag never get overwritten', async () => {
    for (const mode of ['master', 'tag']) {
        const f = fixture(); try {
            mode === 'master' ? f.moveMaster() : f.conflictTag()
            await assert.rejects(publish(f.args)); assert.deepEqual(f.calls, [])
        } finally { f.cleanup() }
    }
})
test('upload failure keeps release unpublished', async () => {
    const f = fixture(); try {
        f.failUpload(); await assert.rejects(publish(f.args), /upload failure/)
        assert.equal(f.calls.some(x => x[0] === 'public'), false)
    } finally { f.cleanup() }
})
test('asset validation rejects another platform and explicit release version is valid', () => {
    const f = fixture(); try {
        fs.writeFileSync(path.join(f.directory, 'SHA256SUMS-zip.txt'), '0'.repeat(64)+'  tabby-1.2.3-linux.zip\n')
        assert.throws(() => validateArtifacts(f.directory, sha, '1.2.3'), /Unexpected release asset/)
        const { execFileSync } = require('node:child_process')
        const result = execFileSync(process.execPath, ['--input-type=module', '-e', 'import {version} from "./scripts/vars.mjs"; console.log(version)'], { env: { ...process.env, TABBY_RELEASE_VERSION: '1.0.239' }, encoding: 'utf8' })
        assert.equal(result.trim(), '1.0.239')
    } finally { f.cleanup() }
})
