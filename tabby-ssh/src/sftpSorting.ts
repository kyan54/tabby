import type { SFTPFile } from './session/sftp'

export type SFTPSortField = 'name'|'modified'|'size'
export type SFTPSortDirection = 'asc'|'desc'

export interface SFTPSortPreferences {
    field: SFTPSortField
    direction: SFTPSortDirection
}

/** Config files may contain preferences saved by a different version. */
export function normalizeSFTPSort (value: unknown): SFTPSortPreferences {
    const candidate = value as Partial<SFTPSortPreferences>|null|undefined
    return {
        field: candidate?.field === 'modified' || candidate?.field === 'size' ? candidate.field : 'name',
        direction: candidate?.direction === 'desc' ? 'desc' : 'asc',
    }
}

/** Keep folders first in both directions without changing the source listing. */
export function sortSFTPFiles (files: readonly SFTPFile[], preferences: SFTPSortPreferences): SFTPFile[] {
    const direction = preferences.direction === 'desc' ? -1 : 1
    return [...files].sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
            return a.isDirectory ? -1 : 1
        }
        let comparison = 0
        if (preferences.field === 'modified') {
            comparison = a.modified.getTime() - b.modified.getTime()
        } else if (preferences.field === 'size') {
            comparison = a.size - b.size
        }
        return direction * (comparison || a.name.localeCompare(b.name))
    })
}
