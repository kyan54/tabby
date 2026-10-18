# SFTP header sorting — original Tabby appearance

The clean baseline is `148dc179da8a3d1a446ba387dc96e6f89a72ba3f`
(PR #1, after official upstream sync and before Cyberduck integration).
The review branch contains an explicit rollback relative to current master.

The existing list-group rows, icons, click/context-menu actions, permissions,
hover colors, Source Sans Pro font, padding and panel layout are retained.
The only layout additions are a clickable header and shared metadata column
widths for alignment. No custom table skin, color palette, row font or borders
are introduced. The existing columns remain Name, Size, Modified and Permissions;
The advanced sorting entry, editor, state and styles have been removed. There
is no replacement toolbar or empty spacer. Only the visible header fields sort.

Plain clicks select a single column, cycle ascending/descending/off, and replace
other rules. Persisted visible multi-field choices stay intact until explicit
interaction. Shift-click appends, reverses, then removes only that rule in place.
Numbered arrows show priority. Enter/Space support the same Shift modifier and
prevent duplicate click activation. Parent stays first; the existing directory-priority setting is respected.
Existing single-field and ordered multi-field settings remain compatible.

Tests cover sorting, filtering, persistence, keyboard activation, parent rows and
legacy Type migration.
`qa/sftp-native-comparison/` contains screenshots and measurements captured from
an actual isolated Tabby renderer running the real Angular SFTP component.
Both captures use the same default native Tabby theme and synthetic directory
entries. The original capture uses the untouched baseline plugin; the modified
capture uses the current plugin. Component creation uses Angular's real factory
and application injector. Only the SFTP session adapter is replaced with an
in-memory fake; no server is contacted. The host uses the production bg-dark
class and the original SSH panel positioning, not an independent HTML preview.

The row font, size, padding, foreground and panel background match in both:
Source Sans Pro; 14px; 8px 16px; rgb(202,202,202); rgb(6,6,6).
No real user config or credentials are inspected. This validates native renderer
appearance and fake-data interactions, not live SSH transfers or the user's
personal theme configuration. Earlier standalone HTML previews are superseded.


Explicit `rules: []` means sorting is disabled; missing/null rules keep legacy
single-field/default behavior. A separate untouched server listing is the source
for every sort change, so clearing does not preserve an already-sorted array.
Empty sorting returns comparator ties within groups. `directoriesFirst` defaults
to true and can be set false in config to keep the complete raw server sequence.
Legacy field/direction values are only
mirrors; explicit rules take precedence, including empty lists.


Legacy Type rules are removed during normalization because they no longer have
a visible header. Remaining visible rules keep order/direction; Type-only settings
become explicit off in memory. Merely opening a panel does not rewrite the user
configuration. The next header action persists visible rules and updates only
the legacy primary-rule mirrors, preserving directoriesFirst and other settings.
Unconfigured users still default to name ascending; explicit [] remains off.
The published v1.0.238-fix assets and tag are unchanged by this unreleased change.
