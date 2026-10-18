const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

function validateArtifacts (directory, sha, version) {
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'BUILD_INFO.json'), 'utf8'))
    if (manifest.commit !== sha || manifest.version !== version || manifest.architecture !== 'arm64' ||
        !manifest.developer_id_signing_requested || !manifest.notarization_requested) {
        throw new Error('Release provenance/signing mismatch')
    }
    const signature = fs.readFileSync(path.join(directory, 'SIGNATURE_INFO.txt'), 'utf8')
    if (!signature.includes('Developer ID Application:') || !signature.includes('The validate action worked!') ||
        !signature.includes('source=Notarized Developer ID')) throw new Error('Missing signing/notarization/Gatekeeper evidence')
    const sums = ['SHA256SUMS-zip.txt', 'SHA256SUMS-dmg.txt'].flatMap(file =>
        fs.readFileSync(path.join(directory, file), 'utf8').trim().split('\n'))
    const files = []
    for (const line of sums) {
        const match = line.match(/^([a-f0-9]{64})\s+\*?([^/\\]+)$/)
        if (!match || !['zip', 'dmg'].some(ext => match[2] === `tabby-${version}-macos-arm64.${ext}`)) {
            throw new Error('Unexpected release asset')
        }
        const bytes = fs.readFileSync(path.join(directory, match[2]))
        if (crypto.createHash('sha256').update(bytes).digest('hex') !== match[1]) throw new Error('Release checksum mismatch')
        files.push(match[2])
    }
    if (files.length !== 2 || new Set(files).size !== 2) throw new Error('Expected exactly arm64 ZIP and DMG')
    fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), sums.join('\n') + '\n')
    return [...files, 'SHA256SUMS.txt', 'BUILD_INFO.json', 'SIGNATURE_INFO.txt']
}

async function publish ({ github, context, core, directory, metadata, notes }) {
    const { owner, repo } = context.repo
    const sha = context.sha
    const assets = validateArtifacts(directory, sha, metadata.version)
    if (!([`v${metadata.version}`, `macos-v${metadata.version}`].includes(metadata.tag)) || !/^\d+\.\d+\.\d+(?:-fix)?$/.test(metadata.version)) throw new Error('Invalid release identity')
    const master = await github.rest.git.getRef({ owner, repo, ref: 'heads/master' })
    if (master.data.object.sha !== sha) throw new Error('Master moved; do not publish a stale build')
    let tag
    try { tag = await github.rest.git.getRef({ owner, repo, ref: `tags/${metadata.tag}` }) } catch (error) { if (error.status !== 404) throw error }
    let release
    try { release = (await github.rest.repos.getReleaseByTag({ owner, repo, tag: metadata.tag })).data } catch (error) { if (error.status !== 404) throw error }
    const replacement = metadata.replacement
    if (replacement) {
        if (metadata.tag !== 'v1.0.238-fix' || metadata.version !== '1.0.238-fix' ||
            !/^[a-f0-9]{40}$/.test(replacement.expected_tag_sha) || replacement.expected_tag_sha === sha ||
            !Number.isSafeInteger(replacement.expected_release_id) || replacement.expected_release_id <= 0) {
            throw new Error('Invalid exact replacement authorization')
        }
        const oldTag = tag?.data.object.sha === replacement.expected_tag_sha
        const oldRelease = release?.id === replacement.expected_release_id && !release.draft
        const newDraft = release?.draft && release.target_commitish === sha
        const newPublic = release && !release.draft && release.id !== replacement.expected_release_id && release.target_commitish === sha
        // Validate every existing identity before deleting anything. Missing old
        // objects permit recovery after an interrupted, already-authorized cutover.
        if ((tag && !oldTag && tag.data.object.sha !== sha) ||
            (release && !oldRelease && !newDraft && !newPublic) || (oldRelease && !oldTag)) {
            throw new Error('Replacement target changed; preserve existing release and tag')
        }
        if (newPublic) {
            const uploaded = (await github.rest.repos.listReleaseAssets({ owner, repo, release_id: release.id, per_page: 100 })).data
            if (oldTag || !tag || release.name !== metadata.tag || release.prerelease || uploaded.length !== assets.length ||
                !assets.every(name => uploaded.some(asset => asset.name === name &&
                    asset.size === fs.statSync(path.join(directory, name)).size && asset.digest === 'sha256:' +
                    crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex')))) {
                throw new Error('Published replacement does not match verified artifacts; do not mutate')
            }
            core.notice(`Replacement already published: ${release.html_url}`)
            return release
        }
        if ((await github.rest.git.getRef({ owner, repo, ref: 'heads/master' })).data.object.sha !== sha) throw new Error('Master moved; preserve old release')
        if (oldTag && (await github.rest.git.getRef({ owner, repo, ref: `tags/${metadata.tag}` })).data.object.sha !== replacement.expected_tag_sha) throw new Error('Old tag moved; preserve old release')
        fs.writeFileSync(path.join(directory, 'REPLACEMENT_AUDIT.json'), JSON.stringify({
            tag: metadata.tag, old_tag_sha: replacement.expected_tag_sha, new_tag_sha: sha,
            old_release_id: replacement.expected_release_id, run_id: context.runId,
            verified_assets: assets, verified_before_cutover: true,
        }, null, 2) + '\n')
        core.notice(`Verified replacement ${metadata.tag}: old ${replacement.expected_tag_sha}, new ${sha}, old release ${replacement.expected_release_id}`)
        if (oldRelease) {
            await github.rest.repos.deleteRelease({ owner, repo, release_id: replacement.expected_release_id })
            release = null
        }
        if (oldTag) {
            await github.rest.git.deleteRef({ owner, repo, ref: `tags/${metadata.tag}` })
            tag = null
        }
    }
    if (tag && tag.data.object.sha !== sha) throw new Error('Tag already targets another commit')
    if (release && (!release.draft || release.target_commitish !== sha)) throw new Error('Refuse to mutate an unrelated or published release')
    if (!tag) await github.rest.git.createRef({ owner, repo, ref: `refs/tags/${metadata.tag}`, sha })
    const body = notes.replaceAll('{{VERSION}}', metadata.version).replaceAll('{{SHA}}', sha)
        .replaceAll('{{RUN_URL}}', `https://github.com/${owner}/${repo}/actions/runs/${context.runId}`)
    if (!release) release = (await github.rest.repos.createRelease({ owner, repo, tag_name: metadata.tag,
        target_commitish: sha, name: metadata.tag, body, draft: true, prerelease: false })).data
    const existing = (await github.rest.repos.listReleaseAssets({ owner, repo, release_id: release.id, per_page: 100 })).data
    for (const name of assets) {
        const old = existing.find(asset => asset.name === name)
        if (old) await github.rest.repos.deleteReleaseAsset({ owner, repo, asset_id: old.id })
        const data = fs.readFileSync(path.join(directory, name))
        await github.rest.repos.uploadReleaseAsset({ owner, repo, release_id: release.id, name,
            headers: { 'content-type': 'application/octet-stream', 'content-length': data.length }, data })
    }
    const uploaded = (await github.rest.repos.listReleaseAssets({ owner, repo, release_id: release.id, per_page: 100 })).data
    if (uploaded.length !== assets.length || !assets.every(name => uploaded.some(asset => asset.name === name &&
        asset.size === fs.statSync(path.join(directory, name)).size && asset.digest === 'sha256:' +
        crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex')))) throw new Error('Release asset verification failed; keep draft')
    // Recheck immediately before publication. Never advance a tag or overwrite master.
    if ((await github.rest.git.getRef({ owner, repo, ref: 'heads/master' })).data.object.sha !== sha) throw new Error('Master moved; keep draft')
    const result = await github.rest.repos.updateRelease({ owner, repo, release_id: release.id, name: metadata.tag, body, draft: false, prerelease: false, make_latest: 'true' })
    core.notice(`Published ${result.data.html_url}`)
    return result.data
}

module.exports = { publish, validateArtifacts }
