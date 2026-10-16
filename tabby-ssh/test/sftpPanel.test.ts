import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, it } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { normalizeSFTPSort, sortSFTPFiles } from '../src/sftpSorting.ts'

// Exercise the actual component without an Electron renderer or a real SSH connection.
// Angular decorators and UI services are host adapters; sorting/filter/navigation code is real.
const require = createRequire(import.meta.url)
class EventEmitter {
    next () { }
    emit () { }
}
const decorator = () => () => { }
const compiled = ts.transpileModule(readFileSync(new URL('../src/components/sftpPanel.component.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
}).outputText
const exports: any = {}
runInNewContext(compiled, {
    exports, console,
    require: (name: string) => {
        if (name === 'constants' || name === 'path') return require(name)
        if (name === '@angular/core') return { Component: decorator, Input: decorator, Output: decorator, Inject: decorator, Optional: decorator, EventEmitter }
        if (name === '../sftpSorting') return { normalizeSFTPSort, sortSFTPFiles }
        return {}
    },
})

const files = () => [
    { name: 'alpha.log', isDirectory: false, size: 10, modified: new Date(30), fullPath: '/alpha.log', mode: 0o644 },
    { name: 'folder', isDirectory: true, size: 100, modified: new Date(0), fullPath: '/folder', mode: 0o755 },
    { name: 'beta.log', isDirectory: false, size: 30, modified: new Date(10), fullPath: '/beta.log', mode: 0o644 },
    { name: 'alpha.txt', isDirectory: false, size: 20, modified: new Date(20), fullPath: '/alpha.txt', mode: 0o644 },
]

function fixture (config: any = { store: { ssh: {} }, save () { } }) {
    // ConfigProxy exposes nested objects through getter-only structural members.
    const saved = config.store.ssh.sftpSort ?? { field: 'name', direction: 'asc' }
    Object.defineProperty(config.store.ssh, 'sftpSort', { get: () => saved, configurable: true })
    const panel = new exports.SFTPPanelComponent({}, { error: assert.fail }, {}, config, [])
    let reads = 0
    panel.sftp = { readdir: async () => { reads++; return files() } }
    return { panel, reads: () => reads, config }
}
const names = (panel: any): string[] => Array.from(panel.filteredFileList, (file: any) => file.name)

describe('SFTP panel sorting integration', () => {
    it('keeps filtering and current path while changing sort, without reloading the server', async () => {
        const { panel, reads } = fixture()
        await panel.navigate('/logs')
        panel.showFilter = true
        panel.filterText = 'ALPHA'
        panel.onFilterChange()
        panel.sort.field = 'size'
        panel.toggleSortDirection()
        assert.deepEqual(names(panel), ['alpha.txt', 'alpha.log'])
        assert.equal(panel.filterText, 'ALPHA')
        assert.equal(panel.showFilter, true)
        assert.equal(panel.path, '/logs')
        assert.equal(reads(), 1)
        panel.clearFilter()
        assert.deepEqual(names(panel), ['folder', 'beta.log', 'alpha.txt', 'alpha.log'])
    })

    it('persists sorting across refresh, navigation and reopening the panel', async () => {
        let saves = 0
        const { panel, config } = fixture({ store: { ssh: {} }, save: () => { saves++ } })
        await panel.navigate('/one')
        panel.sort.field = 'modified'
        panel.toggleSortDirection()
        assert.equal(saves, 1)
        await panel.navigate('/one')
        await panel.navigate('/two')
        assert.deepEqual(names(panel), ['folder', 'alpha.log', 'alpha.txt', 'beta.log'])
        const reopened = fixture(config).panel
        await reopened.navigate('/three')
        assert.deepEqual(names(reopened), names(panel))
        assert.equal(reopened.sort.field, 'modified')
        assert.equal(reopened.sort.direction, 'desc')
    })

    it('applies a selection made while a directory listing is loading', async () => {
        const { panel } = fixture()
        let finish: (items: any[]) => void = () => { }
        panel.sftp.readdir = () => new Promise(resolve => { finish = resolve })
        const navigating = panel.navigate('/slow')
        panel.sort.field = 'size'
        panel.changeSort()
        panel.toggleSortDirection()
        finish(files())
        await navigating
        assert.deepEqual(names(panel), ['folder', 'beta.log', 'alpha.txt', 'alpha.log'])
    })

    it('continues to download the original selected file and navigate selected folders', async () => {
        const { panel } = fixture()
        await panel.navigate('/')
        panel.sort.field = 'size'
        panel.toggleSortDirection()
        const downloaded: any[] = []
        panel.download = (...args: any[]) => { downloaded.push(args) }
        await panel.open(panel.filteredFileList[1])
        assert.deepEqual(downloaded, [['/beta.log', 0o644, 30]])
        await panel.open(panel.filteredFileList[0])
        assert.equal(panel.path, '/folder')
        assert.equal(panel.sort.direction, 'desc')
    })
})
