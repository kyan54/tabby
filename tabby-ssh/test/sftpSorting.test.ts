import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeSFTPSort, sortSFTPFiles, sftpFileType } from '../src/sftpSorting.ts'
import type { SFTPSortDirection, SFTPSortField } from '../src/sftpSorting.ts'

const listing = () => [
    { name: 'b.txt', isDirectory: false, size: 20, modified: new Date(30) },
    { name: 'z-folder', isDirectory: true, size: 1000, modified: new Date(3) },
    { name: 'a.txt', isDirectory: false, size: 30, modified: new Date(10) },
    { name: 'a-folder', isDirectory: true, size: 200, modified: new Date(1) },
    { name: 'c.txt', isDirectory: false, size: 10, modified: new Date(20) },
].map(file => ({ ...file, fullPath: '/test/' + file.name, mode: 0o644, isSymlink: false }))

describe('SFTP file ordering', () => {
    const cases: [SFTPSortField, SFTPSortDirection, string[]][] = [
        ['name', 'asc', ['a-folder', 'z-folder', 'a.txt', 'b.txt', 'c.txt']],
        ['name', 'desc', ['z-folder', 'a-folder', 'c.txt', 'b.txt', 'a.txt']],
        ['modified', 'asc', ['a-folder', 'z-folder', 'a.txt', 'c.txt', 'b.txt']],
        ['modified', 'desc', ['z-folder', 'a-folder', 'b.txt', 'c.txt', 'a.txt']],
        ['size', 'asc', ['a-folder', 'z-folder', 'c.txt', 'b.txt', 'a.txt']],
        ['size', 'desc', ['z-folder', 'a-folder', 'a.txt', 'b.txt', 'c.txt']],
    ]
    for (const [field, direction, expected] of cases) {
        it(`sorts ${field} ${direction}, keeping directories first`, () => {
            assert.deepEqual(sortSFTPFiles(listing(), [{ field, direction }]).map(x => x.name), expected)
        })
    }

    it('uses names to break equal size/time ties deterministically', () => {
        const files = listing().filter(x => !x.isDirectory).map(x => ({ ...x, size: 0, modified: new Date(0) }))
        for (const field of ['size', 'modified'] as const) {
            assert.deepEqual(sortSFTPFiles(files, [{ field, direction: 'asc' }]).map(x => x.name), ['a.txt', 'b.txt', 'c.txt'])
            assert.deepEqual(sortSFTPFiles(files, [{ field, direction: 'desc' }]).map(x => x.name), ['a.txt', 'b.txt', 'c.txt'])
        }
    })

    it('does not mutate the server listing or replace file objects used by actions', () => {
        const files = listing()
        const original = [...files]
        const result = sortSFTPFiles(files, [{ field: 'size', direction: 'desc' }])
        assert.deepEqual(files, original)
        for (const file of result) assert.ok(original.includes(file))
        assert.notEqual(result, files)
    })

    it('handles an empty directory', () => {
        assert.deepEqual(sortSFTPFiles([], [{ field: 'modified', direction: 'desc' }]), [])
    })

    it('defaults old, missing, and malformed preferences to name ascending', () => {
        for (const value of [undefined, null, {}, 'bad', { field: 'bogus', direction: 'sideways' }]) {
            assert.deepEqual(normalizeSFTPSort(value), [{ field: 'name', direction: 'asc' }])
        }
        assert.deepEqual(normalizeSFTPSort([{ field: 'modified', direction: 'desc' }]), [{ field: 'modified', direction: 'desc' }])
    })
})

describe('SFTP multi-field sorting', () => {
    it('uses lower priority fields only for ties and honors independent directions', () => {
        const files = listing().filter(x => !x.isDirectory).map(x => ({ ...x, modified: new Date(x.name === 'c.txt' ? 2 : 1) }))
        assert.deepEqual(sortSFTPFiles(files, [{ field: 'modified', direction: 'asc' }, { field: 'size', direction: 'desc' }]).map(x => x.name), ['a.txt', 'b.txt', 'c.txt'])
        assert.deepEqual(sortSFTPFiles(files, [{ field: 'size', direction: 'asc' }, { field: 'modified', direction: 'asc' }]).map(x => x.name), ['c.txt', 'b.txt', 'a.txt'])
        const equal = files.map(x => ({ ...x, size: 0, modified: new Date(0) }))
        assert.deepEqual(sortSFTPFiles(equal, [{ field: 'modified', direction: 'desc' }, { field: 'size', direction: 'asc' }, { field: 'name', direction: 'desc' }]).map(x => x.name), ['c.txt', 'b.txt', 'a.txt'])
    })

    it('keeps folders first with combined and reversed rules', () => {
        const result = sortSFTPFiles(listing(), [{ field: 'modified', direction: 'desc' }, { field: 'size', direction: 'desc' }])
        assert.equal(result[0].isDirectory, true)
        assert.equal(result[1].isDirectory, true)
        assert.ok(result.slice(2).every(x => !x.isDirectory))
    })

    it('puts missing, non-finite and invalid metadata last in either direction', () => {
        for (const field of ['size', 'modified'] as const) {
            for (const direction of ['asc', 'desc'] as const) {
                const valid = listing()[0]
                const missing = { ...valid, name: 'missing', [field]: undefined }
                const invalid = { ...valid, name: 'invalid', [field]: field === 'size' ? NaN : new Date('invalid') }
                const infinite = { ...valid, name: 'infinite', [field]: field === 'size' ? Infinity : null }
                const result = sortSFTPFiles([missing, invalid, infinite, valid] as any, [{ field, direction }, { field: 'name', direction: 'desc' }])
                assert.equal(result[0], valid)
                assert.deepEqual(result.slice(1).map(x => x.name), ['missing', 'invalid', 'infinite'])
            }
        }
    })

    it('migrates legacy settings and removes invalid or duplicate fields', () => {
        assert.deepEqual(normalizeSFTPSort({ field: 'size', direction: 'desc', rules: null }), [{ field: 'size', direction: 'desc' }])
        assert.deepEqual(normalizeSFTPSort({ rules: [{ field: 'modified', direction: 'desc' }, null, { field: 'modified', direction: 'asc' }, { field: 'bogus' }, { field: 'size', direction: 'bad' }] }), [{ field: 'modified', direction: 'desc' }, { field: 'size', direction: 'asc' }])
        assert.deepEqual(normalizeSFTPSort({ rules: [] }), [])
    })
})


describe('SFTP extension type sorting', () => {
    it('uses lowercase final extensions, handles dotfiles and extensionless names consistently', () => {
        const files = ['z.TXT', '.env', 'a.txt', 'archive.tar.GZ', 'README', 'trailing.', '.config.JSON']
            .map(name => ({ ...listing()[0], name }))
        assert.deepEqual(files.map(sftpFileType), ['.txt', 'File', '.txt', '.gz', 'File', 'File', '.json'])
        const sorted = sortSFTPFiles(files, [{ field: 'type', direction: 'asc' }, { field: 'name', direction: 'desc' }])
        assert.deepEqual(sorted.map(x => x.name), ['trailing.', 'README', '.env', 'archive.tar.GZ', '.config.JSON', 'z.TXT', 'a.txt'])
        assert.deepEqual(normalizeSFTPSort({ rules: [{ field: 'type', direction: 'desc' }, { field: 'size', direction: 'asc' }] }),
            [{ field: 'type', direction: 'desc' }, { field: 'size', direction: 'asc' }])
        assert.equal(sftpFileType({ name: 'dir.txt', isDirectory: true }), 'Folder')
    })
    it('keeps directories first in either direction and breaks equal types by name', () => {
        for (const direction of ['asc', 'desc'] as const) {
            const sorted = sortSFTPFiles(listing(), [{ field: 'type', direction }])
            assert.deepEqual(sorted.map(x => x.name), ['a-folder', 'z-folder', 'a.txt', 'b.txt', 'c.txt'])
        }
    })
})


describe('SFTP explicitly disabled ordering', () => {
    it('distinguishes missing defaults and legacy settings from explicit empty rules', () => {
        for (const value of [undefined, null, {}, { rules: null }]) {
            assert.deepEqual(normalizeSFTPSort(value), [{ field: 'name', direction: 'asc' }])
        }
        assert.deepEqual(normalizeSFTPSort({ field: 'size', direction: 'desc' }), [{ field: 'size', direction: 'desc' }])
        assert.deepEqual(normalizeSFTPSort([]), [])
        assert.deepEqual(normalizeSFTPSort({ rules: [], field: 'size', direction: 'desc' }), [])
        assert.deepEqual(normalizeSFTPSort({ rules: [{ field: 'invalid' }] }), [{ field: 'name', direction: 'asc' }])
    })
    it('only stably groups folders when disabled, without a hidden name tie-breaker', () => {
        const items = listing()
        assert.deepEqual(sortSFTPFiles(items, []).map(x => x.name), ['z-folder', 'a-folder', 'b.txt', 'a.txt', 'c.txt'])
        assert.deepEqual(sortSFTPFiles(items, [], false), items)
        assert.deepEqual(items.map(x => x.name), ['b.txt', 'z-folder', 'a.txt', 'a-folder', 'c.txt'])
    })
})
