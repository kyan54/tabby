# Official upstream sync — 2026-10-16

## Scope and provenance

- Fork: https://github.com/kyan54/tabby, default branch `master`.
- Official upstream: https://github.com/Eugeny/tabby, identified by this fork's explicit README attribution and its existing shared Git history.
- Fork baseline: `83fa2de802147e2eb8809aaf69e06d81feff3e20`.
- Shared ancestor: `ecf2a487bcfdbdd43a324dc4b168e522b0d65130`.
- Upstream target: `467ce8ebfa467fb88cf6d154c9a5891e3d3647f0` (latest official release: [v1.0.238](https://github.com/Eugeny/tabby/releases/tag/v1.0.238)).
- Release distinction: v1.0.238 points to `54869e108aaa336fdd01bc4de5b160fd8feccf7b`. The synchronized official master is one commit newer (`467ce8eb`, xterm 6); that change was not yet in the release tag.
- Before merging: upstream had 132 commits absent from the fork; the fork had 14 commits absent from upstream.
- Integration branch: `sync/upstream-2026-10-16`. Original checkout `/Users/hujinwu/dev/tabby` was clean and was left untouched; integration uses a separate clone.
- No project AGENTS.md or project skill files were found in the checked repository.

## Notable official updates

Features include nested profile groups and a profile tree, pinned tabs, MRU tab switching, split-pane labels, Windows 11 Acrylic, searchable vault entries, configurable SSH TERM, restoration of SSH working directories, serial connection toolbar controls, mouse-wheel hotkeys, and search query retention.

Fixes include closed-session/terminal/WebGL timer leaks, quadratic background output buffering, duplicate hotkey dispatch, modal input focus, renderer recovery after GPU resets, ZMODEM transfers, SSH authentication chaining and blank passwords, PuTTY key forwarding to WinSCP, SSH shell teardown, SFTP errors/navigation, WSL starting directories, Windows environment refresh, and shell-command injection avoidance through execFile.

The [official release history](https://github.com/Eugeny/tabby/releases) and [full baseline comparison](https://github.com/Eugeny/tabby/compare/ecf2a487bcfdbdd43a324dc4b168e522b0d65130...467ce8ebfa467fb88cf6d154c9a5891e3d3647f0) provide the detailed source record.

## Compatibility considerations

Electron moves from 38 to 43, xterm from 5 to 6, electron-builder advances to 26.16, and native SSH/build dependencies change. Native modules must be rebuilt for the updated Electron ABI. Third-party plugins that rely on private renderer internals need compatibility testing. Upstream includes explicit compatibility handling for Alt-arrow word movement and WebGL cleanup. New Windows sessions refresh environment values from the registry. No configuration format migration or intentional breaking-change announcement was identified in the reviewed release notes; this is not a guarantee of compatibility with every third-party plugin.

## Fork differences retained

- Search highlights are excluded from right-click clipboard copying, Ctrl+C copying, and copy-on-select. Actual mouse selections still copy; cancelling search clears its selection.
- Selection capture listeners now have stable references and are removed on detach, preserving the fork's behavior alongside upstream's listener cleanup.
- WinSCP passwords fall back from keychain/vault storage to profile passwords, including jump hosts. Upstream's support for explicitly empty passwords remains intact. `SSHProfileOptions.password` now includes `null`, matching the existing profile default.
- Fork release/tag behavior, signing-secret guards, optional Sentry/Firebase integration, version fallback, plugin typings paths, and fork README explanations remain intact.
- Windows builds adopt upstream's windows-2022 runner and build the UAC helper from source.

Three text conflicts were resolved by retaining both behaviors: build workflow, SSH password handling, and terminal mouse event lifecycle. No choice to discard fork functionality was required.

## Validation

- `yarn run test:ssh-term`: 14 tests passed.
- `yarn run test:unit`: 11 tests passed.
- `yarn run build:typings`: all 13 built-in plugins checked successfully.
- Full lint passed locally. Full source build passed all 17 webpack configurations (app, built-in plugins, web, demo), with warnings and no errors.
- Additional smoke tests executed the actual transpiled fork code with mocked services/host: six password cases each for direct/jump-host WinSCP URIs; search/redraw exclusion, mouse copying, search cancellation, and listener teardown all passed.
- Integration source commit `9b2f3072` passed GitHub Package-Build (including tests, typings, lint) and Docs. Its existing workflow skipped native platform packaging jobs on this non-tag push because Create-Release was skipped. Native packages were not validated or published. This final follow-up changes this report only; see the final commit's checks for remote status.
- Lockfiles retained; dependency installation used frozen lockfiles. Local installation skipped lifecycle scripts; native packaging and platform jobs run in CI.
- Interactive application, real SSH server, and physical Windows/macOS behavior were not manually exercised.

This synchronization creates no release tag and publishes no installer release. Existing tag-only release steps remain available for a future explicitly authorized release.
