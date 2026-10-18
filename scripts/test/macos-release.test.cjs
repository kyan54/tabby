const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { publish, validateArtifacts } = require('../publish-macos-release.cjs')
const sha = 'a'.repeat(40)
function fixture (metadata = { version: '1.2.3', tag: 'macos-v1.2.3' }) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tabby-release-test-'))
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
            createRelease: async args => { calls.push(['draft', args.draft, args.prerelease]); return { data: { id: 7, draft: true, target_commitish: sha } } },
            listReleaseAssets: async () => ({ data: uploaded }),
            deleteReleaseAsset: async () => { throw Error('unexpected deletion') },
            uploadReleaseAsset: async args => { if (failUpload) throw Error('synthetic upload failure'); calls.push(['upload', args.name]); uploaded.push({ name: args.name, size: args.data.length, digest: 'sha256:' + crypto.createHash('sha256').update(args.data).digest('hex') }) },
            updateRelease: async args => { calls.push(['public', args.draft, args.prerelease, args.make_latest]); return { data: { html_url: 'https://github.com/example/repo/releases/tag/'+metadata.tag } } },
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
        assert.deepEqual(f.calls[1], ['draft', true, false])
        assert.equal(f.calls.filter(x => x[0] === 'upload').length, 5)
        assert.deepEqual(f.calls.at(-1), ['public', false, false, 'true'])
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


test('accepts the exact user-requested fix suffix and v tag as a formal Latest release', async () => {
    const f = fixture({ version: '1.0.238-fix', tag: 'v1.0.238-fix' })
    try {
        await publish(f.args)
        assert.ok(f.calls.some(x => x[0] === 'upload' && x[1] === 'tabby-1.0.238-fix-macos-arm64.zip'))
        assert.deepEqual(f.calls.at(-1), ['public', false, false, 'true'])
        const { execFileSync } = require('node:child_process')
        const result = execFileSync(process.execPath, ['--input-type=module', '-e', 'import {version} from "./scripts/vars.mjs"; console.log(version)'], { env: { ...process.env, TABBY_RELEASE_VERSION: '1.0.238-fix' }, encoding: 'utf8' })
        assert.equal(result.trim(), '1.0.238-fix')
    } finally { f.cleanup() }
})
test('rejects an unrelated suffix or mismatched tag without publishing', async () => {
    for (const metadata of [{ version: '1.0.238-kyan54', tag: 'v1.0.238-kyan54' }, { version: '1.0.238-fix', tag: 'v1.0.239' }]) {
        const f = fixture(metadata)
        try { await assert.rejects(publish(f.args), /Invalid release identity/); assert.deepEqual(f.calls, []) }
        finally { f.cleanup() }
    }
})

function replacementFixture () {
    const oldSHA = 'd'.repeat(40)
    const f = fixture({ version: '1.0.238-fix', tag: 'v1.0.238-fix', replacement: { expected_tag_sha: oldSHA, expected_release_id: 42 } })
    const { git, repos } = f.args.github.rest
    const originalGetRef = git.getRef, originalUpload = repos.uploadReleaseAsset, originalUpdate = repos.updateRelease
    let tagSHA = oldSHA, release = { id: 42, draft: false, target_commitish: oldSHA }
    const missing = () => { throw Object.assign(Error('missing'), { status: 404 }) }
    git.getRef = async args => args.ref === 'heads/master' ? originalGetRef(args) : tagSHA ? { data: { object: { sha: tagSHA } } } : missing()
    git.createRef = async args => { f.calls.push(['tag', args.sha]); tagSHA = args.sha }
    git.deleteRef = async args => { f.calls.push(['deleteTag', args.ref]); tagSHA = null }
    repos.getReleaseByTag = async () => release ? { data: release } : missing()
    repos.deleteRelease = async args => { f.calls.push(['deleteRelease', args.release_id]); release = null }
    repos.createRelease = async args => { f.calls.push(['draft', args.draft, args.prerelease, args.name]); release = { ...args, id: 43 }; return { data: release } }
    repos.uploadReleaseAsset = async args => {
        await originalUpload(args)
        const asset = (await repos.listReleaseAssets()).data.find(a => a.name === args.name)
        asset.digest = 'sha256:' + crypto.createHash('sha256').update(args.data).digest('hex')
    }
    repos.updateRelease = async args => {
        const result = await originalUpdate(args)
        release = { ...release, ...args, html_url: result.data.html_url }
        return { data: release }
    }
    return { ...f, changeOldTag: () => { tagSHA = 'e'.repeat(40) }, changeOldRelease: () => { release.id = 44 },
        removeOldRelease: () => { release = null }, currentTag: () => tagSHA }
}

test('verified exact replacement deletes only the authorized release/tag and uses the exact title', async () => {
    const f = replacementFixture()
    try {
        const result = await publish(f.args)
        assert.deepEqual(f.calls.slice(0, 3), [['deleteRelease', 42], ['deleteTag', 'tags/v1.0.238-fix'], ['tag', sha]])
        assert.deepEqual(f.calls[3], ['draft', true, false, 'v1.0.238-fix'])
        assert.equal(result.name, 'v1.0.238-fix')
        assert.equal(f.currentTag(), sha)
        assert.deepEqual(f.calls.at(-1), ['public', false, false, 'true'])
        const count = f.calls.length
        await publish(f.args) // a successful retry must never delete the new public release
        assert.equal(f.calls.length, count)
    } finally { f.cleanup() }
})

test('replacement rejects changed identities, corrupt bytes and moved master before deleting anything', async () => {
    for (const mode of ['tag', 'release', 'checksum', 'master', 'anotherVersion']) {
        const f = replacementFixture()
        try {
            if (mode === 'tag') f.changeOldTag()
            if (mode === 'release') f.changeOldRelease()
            if (mode === 'checksum') fs.appendFileSync(path.join(f.directory, 'tabby-1.0.238-fix-macos-arm64.zip'), 'bad')
            if (mode === 'master') f.moveMaster()
            if (mode === 'anotherVersion') f.metadata.tag = 'macos-v1.0.238-fix'
            await assert.rejects(publish(f.args))
            assert.deepEqual(f.calls, [])
        } finally { f.cleanup() }
    }
})

test('replacement can resume after authorized old-release deletion without deleting another release', async () => {
    const f = replacementFixture()
    try {
        f.removeOldRelease()
        await publish(f.args)
        assert.equal(f.calls.some(c => c[0] === 'deleteRelease'), false)
        assert.deepEqual(f.calls[0], ['deleteTag', 'tags/v1.0.238-fix'])
    } finally { f.cleanup() }
})
