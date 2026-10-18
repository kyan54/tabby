import type { SFTPFile } from './session/sftp'

export type SFTPSortField = 'name'|'modified'|'size'|'type'
export type SFTPSortDirection = 'asc'|'desc'

export interface SFTPSortRule {
    field: SFTPSortField
    direction: SFTPSortDirection
}

export const SFTP_SORT_FIELDS: SFTPSortField[] = ['name', 'modified', 'size', 'type']

/** Accept old single-field settings and sanitize ordered, unique sort rules. */
export function normalizeSFTPSort (value: unknown): SFTPSortRule[] {
    const candidate = value as { rules?: unknown, field?: unknown, direction?: unknown }|null|undefined
    const storedRules = candidate?.rules
    const rawRules: unknown[] = Array.isArray(value) ? value : Array.isArray(storedRules) ? storedRules : [candidate]
    const rules: SFTPSortRule[] = []
    for (const raw of rawRules) {
        const rule = raw as { field?: unknown, direction?: unknown }|null|undefined
        if (rule?.field !== 'name' && rule?.field !== 'modified' && rule?.field !== 'size' && rule?.field !== 'type') {
            continue
        }
        if (!rules.some(x => x.field === rule.field)) {
            rules.push({ field: rule.field, direction: rule.direction === 'desc' ? 'desc' : 'asc' })
        }
    }
    return rules.length ? rules : [{ field: 'name', direction: 'asc' }]
}

/** Dotfiles without a second dot and trailing dots have no extension. */
export function sftpFileType (file: Pick<SFTPFile, 'name'|'isDirectory'>): string {
    if (file.isDirectory) {
        return 'Folder'
    }
    const dot = file.name.lastIndexOf('.')
    return dot > 0 && dot < file.name.length - 1 ? file.name.slice(dot).toLowerCase() : 'File'
}

function numericValue (file: SFTPFile, field: 'modified'|'size'): number|null {
    const value = field === 'modified' ? file.modified instanceof Date ? file.modified.getTime() : NaN : file.size
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Folders stay first. Missing metadata stays last in either direction. */
export function sortSFTPFiles (files: readonly SFTPFile[], rules: readonly SFTPSortRule[]): SFTPFile[] {
    return [...files].sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
            return a.isDirectory ? -1 : 1
        }
        for (const rule of rules) {
            const direction = rule.direction === 'desc' ? -1 : 1
            let comparison = 0
            if (rule.field === 'name') {
                comparison = a.name.localeCompare(b.name)
            } else if (rule.field === 'type') {
                const typeKey = (file: SFTPFile) => sftpFileType(file) === 'File' ? '' : sftpFileType(file)
                comparison = typeKey(a).localeCompare(typeKey(b))
            } else {
                const av = numericValue(a, rule.field)
                const bv = numericValue(b, rule.field)
                if (av === null || bv === null) {
                    if (av !== bv) {
                        return av === null ? 1 : -1
                    }
                    continue
                }
                comparison = av - bv
            }
            if (comparison) {
                return direction * comparison
            }
        }
        return a.name.localeCompare(b.name)
    })
}
