# Cyberduck password handoff: cloud validation and macOS handoff

Base: `f393a1b9000fd7570b5d2d8abbd76da420359e5d`.
Validation date: 2026-10-17. Environment: Linux, Node 24.19.0.

**Draft only. Do not merge or release until native macOS acceptance is complete.**
No real passwords, private keys, Keychain records, or servers were accessed.
All credential values in tests are synthetic fixtures.

## Implemented behavior

- Default-off, explicit saved-profile opt-in. Group/default/duplicate profiles do
  not inherit authorization. Saving and fully reconnecting is required.
- Capture only successful ordinary password authentication, using the actual
  authenticated username. No private-key/passphrase, keyboard-interactive or
  partial MFA response capture. Ordinary password prompts are opaque: do not
  enable sharing for accounts using one-time values in that prompt.
- The first Cyberduck launch waits for an in-flight share. Credentials never
  enter the launch URL, process arguments, environment, clipboard, logs, config
  serialization, or plaintext temporary files.
- A directly loaded native addon uses Security.framework; no credential IPC
  listener exists. The signed host and official Developer-ID Cyberduck are
  checked. Missing signer pin, unsigned/tampered apps, or unexpected ACLs fail
  closed. No entitlements are expanded.
- Additional mutable password bytes are cleared on completion, failure,
  disconnect, opt-out and revoke. Existing immutable strings owned by SSH/V8
  cannot be guaranteed erased. See the native README for the plugin trust
  boundary and remaining application-path replacement race.
- Existing foreign/multiple matching items are conflicts, not overwritten.
  Revocation confirms the exact public connection tuple, durably disables only
  the saved sharing flag, and deletes only the owned item. Canceling the profile
  editor later does not silently re-enable sharing. Endpoint/username changes
  can leave old owned items; the UI explains using Keychain Access for these.
- WinSCP and existing credential-free Cyberduck URL/cwd behavior are preserved.

## Passed checks

- `npm run test:ssh-term`: 69 tests.
- `npm run test:unit`: 19 tests.
- `npm run test:cyberduck-keychain`: 6 tests, including portable C++
  validation/ownership/zeroization compiled and run in an isolated temp directory.
- `npm run lint`: full repository source lint.
- `tsc -p tabby-core/tsconfig.typings.json --noEmit --emitDeclarationOnly false`.
- `tsc -p tabby-ssh/tsconfig.typings.json --noEmit --emitDeclarationOnly false`.
- `webpack --config tabby-ssh/webpack.config.mjs`: Angular/plugin build passed;
  existing Sass legacy API deprecation warnings remain.
- Pug compilation for the updated settings template.
- Syntax checks for native/macOS build scripts; `git diff --check`.
- Independent static security review, with lifecycle/ownership/ACL findings
  addressed. This is not a native security certification.

Dependencies were installed in a temporary cloud test directory with package
install scripts disabled; no repository lockfile was changed. This is not a
reproducible signed release build.

## Blocked/untested checks

Electron plugin TypeScript and webpack builds report the same three diagnostics
on both this change and an untouched checkout of the exact base under the same
temporary dependencies:

- `tabby-electron/src/shells/posix.ts:28`: optional shell name versus string.
- `tabby-local/src/session.ts:243`: nullable realpath input and resulting type.

No unrelated fixes were included. Core and SSH typechecks pass. A full packaged
app build, macOS SDK compile/link, signed arm64/x64 artifacts, notarization,
Keychain ACL persistence/denials and actual Cyberduck 9.5.4 retrieval have **not**
been verified here. Linux native build intentionally skips; it is not a compile
pass.

## Tonight's macOS sequence

1. Confirm official Cyberduck 9.5.4 Developer-ID identity and the installed Tabby
   signing team. Use the existing signing workflow; never put signing secrets
   in source, commands, chat, or logs. The final packaging step compiles the
   existing public team ID into the addon.
2. Compile and package with the macOS SDK. Verify the app, Renderer helper and
   bundled addon are sealed/signed; check both supported architectures.
3. Complete the detailed **synthetic-only, disposable-Keychain** matrix in
   [the native README](../native/cyberduck-keychain/README.md#required-signed-macos-acceptance-matrix).
   The user performs local opt-in and OS authorization. Start with mock fixture
   accounts and isolated keys, not a user's existing credentials.
4. Verify first-open behavior, deny/cancel/locked-keychain paths, matching rules,
   foreign-item conflicts, all ACL entries, restart/update/revoke and session
   cleanup. Confirm untrusted applications cannot read without a user decision.
5. Only after results are reviewed should this draft become eligible for merge
   and a separately authorized release. A draft PR/CI artifact is not approval
   to publish a release or enable the setting on real profiles.


## macOS validation, 2026-10-17 (signed candidate pending)

Implementation head examined: `8bb17f915350dc61739e4b0ed9b8c57fa745bfce`.
A separate worktree preserves the earlier development and release worktrees.

Passed without accessing any credential records:

- Native SDK compile and link for **arm64 and x64**, using actual installed
  Electron **43.7.0** headers and the public build-time team pin `37BL9CNF8B`.
- On this Mac: 69 SSH, 19 unit and 6 portable native policy tests; repository lint.
- The actual arm64 addon loads in generic Node. Host preflight is false;
  synthetic valid-tuple writes/revoke return denied before the credential-query
  code, invalid tuples return invalid, and identified Buffers are zeroed.
- A metadata-only probe reusing the actual native signature functions accepts
  the installed official Cyberduck (`G69SCX94XU`) and Tabby (`37BL9CNF8B`), while
  rejecting the unsigned probe as a host. The installed Renderer identifier is
  `org.tabby.helper.Renderer`; both installed apps pass strict deep signature
  verification.
- A second probe contains no SecKeychain item API imports. It constructs only
  in-memory SecAccess/SecACL objects using the real `makeAccess` implementation;
  all three ACLs pass its narrowing and read-back checks. Nothing is persisted.

The new `Cyberduck Keychain signed macOS candidate` workflow creates signed,
notarized Actions artifacts only, never a GitHub Release. It requires existing
credentials, checks the addon signature/team/architecture, and tests loading it
from the sealed app using only invalid inputs (no credential lookup or write).
This does **not** replace actual Renderer or persisted-Keychain acceptance.

Still blocked on user-prepared isolation: a separate macOS test account with a
manually configured disposable default Keychain/search list. The agent has not
created accounts/keychains, changed the search list, written fixture credential
records, unlocked a Keychain, accepted authorization, or connected to a server.
The user must perform any required account/Keychain setup and OS authorization.
Persisted ACL/partition behavior, real denial/cancel/lock behavior, owned-item
update/conflict/revoke and official Cyberduck first-open retrieval remain open.
Do not merge or publish an installer until those release gates are resolved.


### Candidate packaging transport issue

Run 39021008333 at 24495033 failed twice after signing when Apple's CloudKit
stapling endpoint lost its connection (`stapler 68`, `NSURLError -1005`). This
is not a native compiler or signing-pin failure. The candidate-only workflow now
wraps the existing stapling operation with at most three retries of that specific
transport failure. Rejections, other errors and exhausted retries still fail.
Three tests cover recovery, the four-attempt cap, and non-retryable failures
(native-policy/build tests now total 9; SSH/unit remain 69/19).

If that transport failure persists, the workflow can preserve a strictly signed
app/module as **DIAGNOSTIC-NOT-STAPLED**, with incomplete provenance metadata.
The build remains failed and does not upload accepted candidate installers.
Such a diagnostic must pass stapling/Gatekeeper and the native acceptance gate
before it can be treated as a validated candidate. It is never a Release.

### Minimal user-operated isolation

A clean temporary standard macOS account can use its own default login Keychain
as the disposable QA store; there is no need to change the existing account's
search list or create another Keychain. The user creates/switches this account,
keeps real SSH/password-manager/proxy configuration out of it, and handles OS
permission decisions. The agent does not create accounts or accept grants.

An explicitly approved alternative is namespace-only native fixture testing in
the existing default Keychain: unique `.invalid` hosts/accounts and non-authenticating
values, cleanup limited to fixture-owned references, no search-list/default or
security-policy changes. This provides weaker environment isolation and does not
by itself satisfy the full release matrix. Normal Cyberduck startup consults SSH
and proxy configuration; `.invalid` alone is not proof that the GUI cannot touch
existing authentication state. Real lock/multiple-Keychain/GUI acceptance must
remain unverified unless covered in an approved isolated environment.


### Signed metadata-only preflight (no test account needed)

After the candidate passes signature, stapling and Gatekeeper verification, run
these from the repository directory with the candidate app's actual path:

```sh
ELECTRON_RUN_AS_NODE=1 "/path/to/Tabby.app/Contents/MacOS/Tabby" native/cyberduck-keychain/test/signed-preflight.cjs /Applications/Cyberduck.app
ELECTRON_RUN_AS_NODE=1 "/path/to/Tabby.app/Contents/Frameworks/Tabby Helper (Renderer).app/Contents/MacOS/Tabby Helper (Renderer)" native/cyberduck-keychain/test/signed-preflight.cjs /Applications/Cyberduck.app
```

This checks the real signed executable, sealed addon and official target policy,
then rejects invalid write/revoke tuples and checks Buffer erasure. It never
queries or mutates credential items. Renderer-executable Node bootstrap is not a
full GUI test. Do not change Electron fuses, entitlements or signature policy if
the build does not support this mode; record that limitation instead.
