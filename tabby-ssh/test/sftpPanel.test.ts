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
    Object.defineProperty(config.store.ssh, 'sftpSort', { get: () => saved, configurable: true, enumerable: true })
    const panel = new exports.SFTPPanelComponent({}, { error: assert.fail }, {}, config, [])
    let reads = 0
    panel.sftp = { readdir: async () => { reads++; return files() } }
    return { panel, reads: () => reads, config }
}
const names = (panel: any): string[] => Array.from(panel.filteredFileList, (file: any) => file.name)

function choose (panel: any, rules: any[]) {
    rules.forEach((rule, index) => {
        panel.sortColumn(rule.field, { shiftKey: index > 0 })
        if (rule.direction === 'desc') panel.sortColumn(rule.field, { shiftKey: index > 0 })
    })
}

describe('SFTP panel sorting integration', () => {
    it('keeps filtering and path when applying combined sorting, without a server reload', async () => {
        const { panel, reads } = fixture()
        await panel.navigate('/logs')
        panel.showFilter = true
        panel.filterText = 'ALPHA'
        panel.onFilterChange()
        choose(panel, [{ field: 'size', direction: 'desc' }, { field: 'modified', direction: 'asc' }])
        assert.deepEqual(names(panel), ['alpha.txt', 'alpha.log'])
        assert.equal(panel.filterText, 'ALPHA')
        assert.equal(panel.showFilter, true)
        assert.equal(panel.path, '/logs')
        assert.equal(reads(), 1)
        panel.clearFilter()
        assert.deepEqual(names(panel), ['folder', 'beta.log', 'alpha.txt', 'alpha.log'])
    })

    it('persists multiple rules across refresh, navigation and reopening', async () => {
        let saves = 0
        const { panel, config } = fixture({ store: { ssh: {} }, save: () => { saves++ } })
        await panel.navigate('/one')
        choose(panel, [{ field: 'modified', direction: 'desc' }, { field: 'size', direction: 'asc' }])
        assert.equal(saves, 3)
        await panel.navigate('/one')
        await panel.navigate('/two')
        assert.deepEqual(names(panel), ['folder', 'alpha.log', 'alpha.txt', 'beta.log'])
        const reopened = fixture(config).panel
        await reopened.navigate('/three')
        assert.deepEqual(names(reopened), names(panel))
        assert.deepEqual(JSON.parse(JSON.stringify(reopened.sort)), [{ field: 'modified', direction: 'desc' }, { field: 'size', direction: 'asc' }])
        assert.equal(config.store.ssh.sftpSort.field, 'modified')
        assert.equal(config.store.ssh.sftpSort.direction, 'desc')
        assert.equal(saves, 3)
        assert.equal(panel.sort.length, 2)
    })

    it('applies a selection made while a directory listing is loading', async () => {
        const { panel } = fixture()
        let finish: (items: any[]) => void = () => { }
        panel.sftp.readdir = () => new Promise(resolve => { finish = resolve })
        const navigating = panel.navigate('/slow')
        choose(panel, [{ field: 'size', direction: 'desc' }])
        finish(files())
        await navigating
        assert.deepEqual(names(panel), ['folder', 'beta.log', 'alpha.txt', 'alpha.log'])
    })

    it('continues to download original selected files and navigate selected folders', async () => {
        const { panel } = fixture()
        await panel.navigate('/')
        choose(panel, [{ field: 'size', direction: 'desc' }])
        const downloaded: any[] = []
        panel.download = (...args: any[]) => { downloaded.push(args) }
        await panel.open(panel.filteredFileList[1])
        assert.deepEqual(downloaded, [['/beta.log', 0o644, 30]])
        await panel.open(panel.filteredFileList[0])
        assert.equal(panel.path, '/folder')
        assert.equal(panel.sort[0].direction, 'desc')
    })

})

describe('header-only compatibility', () => {
    it('removes invisible legacy Type rules without changing directory priority or saving on open', async () => {
        let saves = 0
        const preferences = { rules: [{ field: 'type', direction: 'desc' }, { field: 'size', direction: 'asc' }], directoriesFirst: false }
        const { panel, config } = fixture({ store: { ssh: { sftpSort: preferences } }, save: () => { saves++ } })
        await panel.navigate('/legacy')
        assert.equal(panel.sort.length, 1)
        assert.equal(panel.sortPriority('size'), 1)
        assert.equal(panel.sortPriority('type'), 0)
        assert.equal(saves, 0)
        assert.equal(config.store.ssh.sftpSort.directoriesFirst, false)
        panel.sortColumn('size', { shiftKey: false })
        assert.deepEqual(JSON.parse(JSON.stringify(config.store.ssh.sftpSort.rules)), [{ field: 'size', direction: 'desc' }])
        assert.equal(config.store.ssh.sftpSort.directoriesFirst, false)
        assert.equal(saves, 1)
    })
    it('reopens Type-only preferences as off with the full server sequence when grouping is disabled', async () => {
        const { panel } = fixture({ store: { ssh: { sftpSort: { field: 'type', direction: 'desc', directoriesFirst: false } } }, save () {} })
        await panel.navigate('/legacy')
        assert.equal(panel.sort.length, 0)
        assert.deepEqual(names(panel), ['alpha.log', 'folder', 'beta.log', 'alpha.txt'])
    })
})

describe('SFTP table header interaction', () => {
    it('loads legacy multi-field choices unchanged, then uses plain clicks for one column', async () => {
        let saves = 0
        const { panel, config, reads } = fixture({ store: { ssh: { sftpSort: { rules: [
            { field: 'modified', direction: 'desc' }, { field: 'size', direction: 'desc' },
        ] } } }, save: () => { saves++ } })
        await panel.navigate('/test')
        assert.equal(panel.sortPriority('modified'), 1)
        assert.equal(panel.sortPriority('size'), 2)
        assert.equal(panel.sortDirection('size'), 'desc')
        assert.equal(saves, 0)
        panel.sortColumn('size', { shiftKey: false })
        assert.equal(panel.sort.length, 1)
        assert.equal(panel.sortPriority('size'), 1)
        assert.equal(panel.sortPriority('modified'), 0)
        assert.equal(panel.sortDirection('size'), 'asc')
        panel.sortColumn('size', { shiftKey: false })
        assert.equal(panel.sortDirection('size'), 'desc')
        assert.deepEqual(names(panel), ['folder', 'beta.log', 'alpha.txt', 'alpha.log'])
        assert.equal(reads(), 1)
        assert.equal(saves, 2)
        assert.equal(config.store.ssh.sftpSort.field, 'size')
        assert.equal(config.store.ssh.sftpSort.direction, 'desc')
        const reopened = fixture(config).panel
        assert.equal(reopened.sort.length, 1)
        assert.equal(reopened.sortDirection('size'), 'desc')
    })
    it('adds and toggles secondary columns with Shift and keeps all priorities unique', () => {
        const { panel, config } = fixture()
        panel.sortColumn('size', { shiftKey: true })
        assert.equal(panel.sortPriority('name'), 1)
        assert.equal(panel.sortPriority('size'), 2)
        panel.sortColumn('size', { shiftKey: true })
        assert.equal(panel.sortPriority('size'), 2)
        assert.equal(panel.sortDirection('size'), 'desc')
        panel.sortColumn('modified', { shiftKey: false })
        assert.equal(panel.sortPriority('modified'), 1)
        assert.equal(panel.sortPriority('name'), 0)
        assert.equal(panel.sortPriority('size'), 0)
        assert.equal(fixture(config).panel.sortDirection('modified'), 'asc')
    })
    it('supports Enter, Space and Shift keyboard activation without a duplicate native click', () => {
        const { panel } = fixture()
        let prevented = 0, stopped = 0
        const key = (value: string, shiftKey: boolean) => ({ key: value, shiftKey,
            preventDefault: () => { prevented++ }, stopPropagation: () => { stopped++ } })
        panel.sortColumnKeydown('size', key('Enter', false))
        assert.equal(panel.sortPriority('size'), 1)
        panel.sortColumnKeydown('modified', key(' ', true))
        assert.equal(panel.sortPriority('modified'), 2)
        panel.sortColumnKeydown('modified', key('Enter', true))
        assert.equal(panel.sortDirection('modified'), 'desc')
        panel.sortColumnKeydown('modified', key('Tab', false))
        assert.equal(prevented, 3)
        assert.equal(stopped, 3)
        assert.equal(panel.sortPriority('modified'), 2)
    })
    it('retains a parent row outside filtered/sorted entries and uses native keyboard buttons', () => {
        const template = readFileSync(new URL('../src/components/sftpPanel.component.pug', import.meta.url), 'utf8')
        assert.match(template, /\*ngIf='path !== "\/"'/)
        assert.ok(template.indexOf("(click)='goUp()'") < template.indexOf("*ngFor='let item of filteredFileList'"))
        assert.match(template, /sortColumn\("name", \$event\)/)
        assert.match(template, /sortColumnKeydown\("name", \$event\)/)
        assert.match(template, /\(click\)='open\(item\)'/)
        assert.match(template, /list-group-item-action.d-flex.align-items-center/)
        assert.doesNotMatch(template, /table.file-table/)
        assert.doesNotMatch(template, /sort-bar|sort-editor|Advanced sorting|openSortEditor|aria-expanded/)
    })
})


describe('SFTP three-state sorting', () => {
    it('cycles an unselected column asc, desc, off and restores the untouched server sequence', async () => {
        const { panel, config, reads } = fixture()
        await panel.navigate('/demo')
        const original = ['folder', 'alpha.log', 'beta.log', 'alpha.txt']
        assert.deepEqual(names(panel), ['folder', 'alpha.log', 'alpha.txt', 'beta.log'])
        panel.sortColumn('size', { shiftKey: false })
        assert.equal(panel.sortDirection('size'), 'asc')
        assert.deepEqual(names(panel), ['folder', 'alpha.log', 'alpha.txt', 'beta.log'])
        panel.sortColumn('size', { shiftKey: false })
        assert.equal(panel.sortDirection('size'), 'desc')
        panel.sortColumn('size', { shiftKey: false })
        assert.equal(panel.sortPriority('size'), 0)
        assert.deepEqual(names(panel), original)
        assert.equal(config.store.ssh.sftpSort.rules.length, 0)
        assert.equal(config.store.ssh.sftpSort.field, null)
        assert.equal(reads(), 1)
        await panel.navigate('/demo')
        await panel.navigate('/another')
        assert.deepEqual(names(panel), original)
        assert.equal(panel.sort.length, 0)
        const reopened = fixture(JSON.parse(JSON.stringify(config))).panel
        await reopened.navigate('/reopened')
        assert.equal(reopened.sort.length, 0)
        assert.deepEqual(names(reopened), original)
    })
    it('removes only the Shift-selected secondary, primary, then last rule and renumbers priorities', () => {
        const { panel } = fixture({ store: { ssh: { sftpSort: { rules: [] } } }, save () {} })
        for (const field of ['name', 'size', 'modified']) panel.sortColumn(field, { shiftKey: true })
        for (let i = 0; i < 2; i++) panel.sortColumn('size', { shiftKey: true })
        assert.equal(panel.sortPriority('size'), 0)
        assert.equal(panel.sortPriority('name'), 1)
        assert.equal(panel.sortPriority('modified'), 2)
        for (let i = 0; i < 2; i++) panel.sortColumn('name', { shiftKey: true })
        assert.equal(panel.sortPriority('modified'), 1)
        for (let i = 0; i < 2; i++) panel.sortColumn('modified', { shiftKey: true })
        assert.equal(panel.sort.length, 0)
    })
    it('honors disabled directory grouping with empty rules and keeps parent outside filtering', async () => {
        const { panel } = fixture({ store: { ssh: { sftpSort: { rules: [], directoriesFirst: false } } }, save () {} })
        await panel.navigate('/demo')
        assert.deepEqual(names(panel), ['alpha.log', 'folder', 'beta.log', 'alpha.txt'])
        const template = readFileSync(new URL('../src/components/sftpPanel.component.pug', import.meta.url), 'utf8')
        assert.ok(template.indexOf("(click)='goUp()'") < template.indexOf("*ngFor='let item of filteredFileList'"))
        assert.match(template, /\*ngIf='path !== "\/"'/)
        assert.doesNotMatch(template, /sort-bar|sort-editor|sortDraft/)
    })
    it('preserves explicit [] through the actual ConfigProxy default cleanup and disk-shaped roundtrip', async () => {
        const code = ts.transpileModule(readFileSync(new URL('../../tabby-core/src/services/config.service.ts', import.meta.url), 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true, esModuleInterop: true },
        }).outputText
        const proxyExports: any = {}
        const configRequire = createRequire(new URL('../../tabby-core/package.json', import.meta.url))
        runInNewContext(code, { exports: proxyExports, Object, Array, require: (name: string) => {
            if (['clone-deep', 'deep-equal', 'deepmerge', 'js-yaml'].includes(name)) return configRequire(name)
            if (name === '@angular/core') return { Injectable: decorator, Inject: decorator }
            return {}
        } })
        const defaults = { ssh: { sftpSort: { rules: null, field: 'name', direction: 'asc', directoriesFirst: true } } }
        let raw: any = {}; let saved = ''
        const store = new proxyExports.ConfigProxy(raw, defaults)
        const config = { store, save: () => { store.__cleanup(); saved = JSON.stringify(raw) } }
        const panel = new exports.SFTPPanelComponent({}, { error: assert.fail }, {}, config, [])
        panel.sftp = { readdir: async () => files() }
        await panel.navigate('/first')
        panel.sortColumn('name', { shiftKey: false }); panel.sortColumn('name', { shiftKey: false })
        assert.deepEqual(JSON.parse(saved).ssh.sftpSort.rules, [])
        raw = JSON.parse(saved)
        const reloaded = new proxyExports.ConfigProxy(raw, defaults)
        assert.deepEqual(normalizeSFTPSort(reloaded.ssh.sftpSort), [])
        assert.equal(reloaded.ssh.sftpSort.directoriesFirst, true)
    })
})
