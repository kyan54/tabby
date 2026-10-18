# SFTP table sorting

The implementation starts from `148dc179da8a3d1a446ba387dc96e6f89a72ba3f`
(PR #1 after the official upstream sync, before Cyberduck integration).
It keeps the existing sorting/filtering/navigation code and persisted ordered rules.

- Columns: Name, Size, Type, Modified. Clicking promotes a column to primary while
  retaining other selected rules. Clicking the primary again reverses it.
- Shift-click appends a new secondary rule or reverses a selected rule in place.
  Arrows and numbers show direction and priority. Native buttons support Tab,
  Enter, Space and modified keyboard activation; the primary column exposes aria-sort.
- Directories stay first in both directions. The parent row is outside the sorted,
  filtered entries and remains first except at the filesystem root.
- Type means the case-insensitive final extension (e.g. `.gz` for `a.tar.gz`).
  Extensionless names, lone dotfiles and trailing dots display File and sort before
  extensions ascending. Directory type is Folder. Equal values retain the existing
  name fallback unless a lower-priority rule resolves the tie.
- Existing single-field and ordered multi-field settings remain readable. Column
  interaction saves through the existing ConfigService path. Advanced sorting is
  collapsed initially; its Apply/Cancel editor remains available, including Type.
- A 620px minimum table width gives narrow panels horizontal scrolling. Column
  widths are shared between header and body. Colors inherit the current theme;
  focused buttons have visible outlines. Permissions remain available as row tooltips.

Validation: 40 SSH tests, 11 unit tests, complete typings/module build, lint and SSH
Webpack. The fake-data layout harness is `qa/sftp-header-sorting/generate-layout.cjs`;
its screenshots exercise the production Pug table markup and SCSS at wide/360px
widths in light/dark colors. This is a static layout check, not a live SSH test or
full Angular browser interaction test. Component interaction tests execute the
actual component with mocked host services and synthetic listings.

No SSH connections, credentials, user config, Keychain records, or installed apps
are changed by this work. Local test packaging is separate from installation and
public release; no signed/notarized distribution is implied.
