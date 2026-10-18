import type { SFTPFile } from './session/sftp'

export type SFTPSortField = 'name'|'modified'|'size'
export type SFTPSortDirection = 'asc'|'desc'

export interface SFTPSortRule {
    field: SFTPSortField
    direction: SFTPSortDirection
}

/** Accept old single-field settings and sanitize ordered, unique sort rules. */
export function normalizeSFTPSort (value: unknown): SFTPSortRule[] {
    const candidate = value as { rules?: unknown, field?: unknown, direction?: unknown }|null|undefined
    const storedRules = candidate?.rules
    // Explicit [] means the user cleared sorting; null/missing keeps legacy defaults.
    if ((Array.isArray(value) && value.length === 0) || (Array.isArray(storedRules) && storedRules.length === 0)) {
        return []
    }
    const rawRules: unknown[] = Array.isArray(value) ? value : Array.isArray(storedRules) ? storedRules : [candidate]
    const rules: SFTPSortRule[] = []
    let removedLegacyType = false
    for (const raw of rawRules) {
        const rule = raw as { field?: unknown, direction?: unknown }|null|undefined
        if (rule?.field === 'type') {
            // The removed editor was the only way to see/control this field.
            removedLegacyType = true
            continue
        }
        if (rule?.field !== 'name' && rule?.field !== 'modified' && rule?.field !== 'size') {
            continue
        }
        if (!rules.some(x => x.field === rule.field)) {
            rules.push({ field: rule.field, direction: rule.direction === 'desc' ? 'desc' : 'asc' })
        }
    }
    return rules.length || removedLegacyType ? rules : [{ field: 'name', direction: 'asc' }]
}

function numericValue (file: SFTPFile, field: 'modified'|'size'): number|null {
    const value = field === 'modified' ? file.modified instanceof Date ? file.modified.getTime() : NaN : file.size
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Folders stay first. Missing metadata stays last in either direction. */
export function sortSFTPFiles (files: readonly SFTPFile[], rules: readonly SFTPSortRule[], directoriesFirst = true): SFTPFile[] {
    return [...files].sort((a, b) => {
        if (directoriesFirst && a.isDirectory !== b.isDirectory) {
            return a.isDirectory ? -1 : 1
        }
        for (const rule of rules) {
            const direction = rule.direction === 'desc' ? -1 : 1
            let comparison = 0
            if (rule.field === 'name') {
                comparison = a.name.localeCompare(b.name)
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
        return rules.length ? a.name.localeCompare(b.name) : 0
    })
}
