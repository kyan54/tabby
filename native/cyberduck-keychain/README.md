# Cyberduck Keychain bridge (macOS)

This private N-API addon writes an **Internet Password** that Cyberduck can find
for an SFTP connection. It is loaded directly into the existing signed Tabby
renderer. There is no helper process, IPC service, shell command, credential
retrieval API, or password-bearing temporary file.

**Release gate:** arm64/x64 SDK compile/link, unsigned-host rejection and
in-memory ACL construction/read-back now pass on macOS (Electron 43.7.0).
These checks do **not** validate signed Renderer execution, macOS prompts,
persisted ACLs, or Cyberduck retrieval. The signed-candidate Actions workflow
produces validation artifacts only. Complete the signed macOS acceptance matrix
before merging/releasing/enabling this feature.

## API

```ts
type Status = 'stored' | 'revoked' | 'not-found' | 'conflict' |
    'denied' | 'unavailable' | 'invalid' | 'failed'

validateTarget(appPath: string): boolean
write(host: string, port: number, username: string, password: Buffer,
    appPath: string, ownerId: string): Status
revoke(host: string, port: number, username: string, ownerId: string): Status
```

All operations are synchronous. They may wait for macOS Keychain authorization.
Errors are sanitized status values, never native error descriptions or caller
data. `validateTarget` returns false when either the caller or target cannot be
verified; it never reads the Keychain.

`ownerId` is the complete persisted custom SSH profile ID (`ssh:custom:…`, up to
1024 UTF-8 bytes), not the profile display name or a newly generated identifier.
Use the exact same owner ID and connection tuple for revocation. Hostnames must
already be ASCII-canonicalized and unbracketed (including IPv6); the native host
byte limit is 253. Ports are integer 1–65535. Accounts are nonempty UTF-8 strings
up to 1024 bytes. Control characters are rejected in tuple/owner metadata.
Password buffers can be empty and are limited to 65536 bytes.

The caller must establish that the password is a successful, ordinary SSH
password, that profile sharing is explicitly enabled, and that user consent
covers persistent sharing with Cyberduck. This API cannot determine password
provenance. Never pass private-key passphrases, keyboard-interactive responses,
OTP/MFA answers, or unsuccessful guesses.
An opaque ordinary SSH password prompt can itself request a one-time value;
neither the native bridge nor transport method can categorically distinguish
that from a reusable password. Do not enable sharing for those accounts.

The native write clears the supplied Buffer before returning (including normal
validation/native failures after the Buffer is identified). The TypeScript caller
must also clear its Buffer in `finally`. Immutable JavaScript source strings and
copies made inside V8 or Security.framework cannot be guaranteed erased.

## Matching and ownership

The matching tuple is:

- `kSecInternetPasswordItemClass`
- server = exact launch hostname, account = exact SSH username
- port = exact connection port (`UInt32` in attribute APIs)
- protocol = `kSecProtocolTypeSSH`, authentication = `kSecAuthenticationTypeDefault`
- empty path and security domain

Before any mutation, metadata-only searches cover the user's Keychain search
list. Path/domain are deliberately omitted from the search: Cyberduck also omits
them. A matching item with any path/domain, a foreign owner marker, a foreign
creator, or multiple matching items results in `conflict`. No foreign item is
overwritten or deleted. No password data is retrieved during matching.

Owned items carry creator `TbyC` and comment
`org.tabby.cyberduck-keychain:v1:<complete profile ID>`. An owned item is updated by
its Keychain item reference, after narrowing its ACL. A new item is created with
its password, owner metadata and ACL in one Security.framework operation. A
duplicate appearing during creation is a conflict, not an invitation to update.
Revocation is by exact tuple and owner marker. It does not delete Tabby's own
credential vault entry. These markers identify items created by this integration;
they are not a cryptographic boundary against an attacker controlling the user's
Keychain or arbitrary code already running inside Tabby.

The default Keychain must be unlocked for new writes. The bridge does not unlock
it, change the search list, suppress authorization dialogs globally, or bypass a
denial. macOS can still prompt, including because of cross-team partition checks.
No `security set-key-partition-list`, all-app access, whole-team grant, or
`apple-tool` exception is added to suppress such prompts.

## Identity and ACL policy

Runtime requirements are fail-closed:

1. Caller is Developer ID-signed `org.tabby` or `org.tabby.helper.Renderer`, with
   the build-pinned Tabby team, a valid dynamic signature and hardened runtime.
   Debug/get-task-allow, disabled library validation and allowed DYLD environment
   variable entitlements are rejected.
2. The caller is inside an enclosing signed `org.tabby` app, validated strictly
   with nested code and every architecture. The loaded addon must be exactly
   `Contents/Resources/cyberduck-keychain/cyberduck_keychain.node` in that app.
3. Cyberduck is a strictly valid, Developer ID-signed `ch.sudo.cyberduck` app from
   team `G69SCX94XU`. The target is verified before and after constructing its
   trusted-application reference, including an unchanged code-directory digest.
   Mac App Store and legacy-signer distributions currently fail closed; they
   require separate runtime validation before support is added.
4. The trusted list contains only the current signed Tabby process and the
   verified Cyberduck app. Public `SecTrustedApplicationCreateFromPath` records
   their designated requirements, which support the vendors' permitted updates.
   Cyberduck's own designated requirement includes its published historical/MAS
   signer alternatives; this is not an arbitrary application-name/path grant.
5. Every ACL created by `SecAccessCreate` is explicitly narrowed. Its default
   ancillary all-app ENCRYPT ACL is not left in place. Change-ACL ownership is
   Tabby-only; other ACL app lists contain Tabby and Cyberduck. The app lists,
   authorizations and prompt selectors are read back before creating/updating an
   item. Unexpected/non-simple ACLs fail closed. User-authorized Keychain prompts
   remain possible; this is a restriction on unattended access.

### Trust boundary and remaining risks

This does not isolate Tabby plugins: this application's existing Node-enabled
plugin model already trusts code loaded into its renderer. There is intentionally
no externally callable IPC endpoint to authenticate. The sealed signed host,
addon placement, hardened runtime and library validation checks reject generic
Node/Electron, unsigned development builds and separately loaded addon copies.

The public path-based trusted-application API still has a residual check/use race
if another process can replace a valid application between native calls and
restore it before the post-check. Strict pre/post signature/digest checks narrow
that window but do not make it atomic. The subsequent app launch has a similar
path replacement window. Eliminating this entirely needs an independently
reviewed code-requirement ACL/launch design; this implementation does not use
undocumented Security APIs. Protect installed app directories and treat hostile
same-user code/app replacement as outside the existing Tabby plugin trust
boundary. No claim of complete protection against same-user compromise is made.

Legacy Keychain APIs are deprecated but are used here because Cyberduck 9.5.4
uses the same legacy Internet Password API. Do not silently replace them with
generic-password keytar entries or data-protection Keychain items.

## Build and signing

Install the repository's normal dependencies and Xcode Command Line Tools on
macOS. The normal `scripts/build-native.mjs` integration invokes:

```sh
node native/cyberduck-keychain/build.mjs --electron-version <installed-version> --arch arm64
```

Use `x64` for Intel (`x86_64` is also normalized). The script resolves the
repository's existing `node-gyp`, builds against the chosen Electron headers and
links only Security/CoreFoundation. N-API version 8 avoids a V8 ABI dependency.
It writes `build/Release/cyberduck_keychain.node`.

Set `TABBY_KEYCHAIN_TEAM_ID` to the intended release signer's public ten-character
Apple Team ID before building. If omitted, `APPLE_TEAM_ID` is used. This is public
identity configuration, not a credential. The resulting pin is compiled into the
addon; runtime environment variables cannot change it. A build with no pin is
allowed, but all sharing operations fail closed. There is no development bypass.
`scripts/build-macos.mjs` rebuilds during final packaging so signer-team
environment variables supplied only at that step are compiled into the addon.
A previously built empty pin cannot be enabled by changing runtime variables.

`electron-builder.yml` copies the addon to the exact resource path above. Package
and sign it with the same identity as Tabby and its renderer using the existing
hardened-runtime build; verify the `.node` is signed, included in the app's sealed
resources and accepted by library validation. If packaging tools do not sign this
extra resource, fix the release signing step before enabling it. Do not add
`disable-library-validation`, get-task-allow, broad Keychain access groups, or
extra access entitlements to make a failed build work. Rebuild the addon when the
signing pin or architecture changes. A normal unsigned development checkout is
intentionally unable to exercise real writes.

## Checks possible without macOS

```sh
node --test native/cyberduck-keychain/test/*.test.mjs
# Or run the portable C++ policy check directly:
g++ -std=c++17 -Wall -Wextra -Werror native/cyberduck-keychain/test/policy.test.cc -o /tmp/tabby-keychain-policy-test
/tmp/tabby-keychain-policy-test
node --test native/cyberduck-keychain/test/source.test.mjs
node --check native/cyberduck-keychain/build.mjs
```

The C++ tests run the real shared validation/ownership/erasure policy. The Node
tests are source-contract regression guards, not a mocked Security.framework
integration suite.

## Required signed macOS acceptance matrix

Use an isolated macOS test account, a dedicated disposable test Keychain and
synthetic credentials only. No real-server authentication is needed. Configure
that account's Keychain/search list manually for testing; do not add a production
API to redirect the bridge to arbitrary Keychains or relax identity checks.

- Compile/link for arm64 and x64 using the supported SDK/Electron version. Verify
  signing, nested-resource seal and actual renderer identifier before runtime QA.
- Unsigned/ad-hoc/generic Electron, mismatched team, separately copied addon,
  broken root resource seal, unsafe entitlements, fake Cyberduck bundle ID,
  unsigned/mismatched team target: preflight false; zero Keychain mutations.
- Successful synthetic password sharing: verify Internet Password class, exact
  SSH protocol/account/host/port, UTF-8 password, empty domain/path, owner marker
  and final **persisted** ACLs in Keychain Access/native test tooling. Check port
  22 and nondefault ports, IPv4, bracket-free IPv6 and empty password data.
- Official Cyberduck 9.5.4 reads the record using its normal bookmark/login flow.
  Record any Keychain/partition prompt. Do not broaden partitions to remove it.
- A third application cannot read or update the shared item without explicit
  macOS user authorization. No persisted all-app decrypt/encrypt ACL remains.
- Owned password update changes only that record; explicit revoke deletes it;
  repeated revoke returns not-found. Tabby's own saved credential remains.
- Existing unowned tuple, different-profile owner, foreign creator, nonempty
  domain/path and duplicates across searchable Keychains return conflict and
  leave every existing item unchanged. Exercise maximum-length owner IDs.
- Locked Keychain, denied/cancelled authorization, inaccessible Keychain and
  interrupted writes return sanitized errors without a fallback plaintext path.
- Inspect process arguments, child process list, app logs and temporary files
  using synthetic sentinel data; no password appears. Verify caller Buffer is
  zeroed after success, conflict, invalid tuple, denial and injected errors.
- Toggle sharing off, change connection tuple, forget the shared record and
  launch again: no automatic destructive cleanup or re-sharing without the
  profile's current opt-in, and no read of unrelated Keychain secrets.

## Primary references

Cyberduck tag `release-9-5-4` resolved to
`40c37bf36eaf7de90549cbf1d8e5febae7a7f9e3` when inspected:

- [Cyberduck Internet Password matching and SFTP→SSH mapping](https://github.com/iterate-ch/cyberduck/blob/release-9-5-4/core/dylib/src/main/java/ch/cyberduck/core/KeychainPasswordStore.java)
- [Cyberduck hostname/account/port selection](https://github.com/iterate-ch/cyberduck/blob/release-9-5-4/core/src/main/java/ch/cyberduck/core/DefaultHostPasswordStore.java)
- [Cyberduck's published signing requirement and Team ID](https://github.com/iterate-ch/cyberduck/blob/release-9-5-4/setup/app/codesign-requirement.txt)
- [Apple Keychain matching implementation (including UInt32 port and wildcard path/domain)](https://github.com/apple-oss-distributions/Security/blob/main/OSX/libsecurity_keychain/lib/SecKeychain.cpp)
- [Apple SecAccess default ACL construction](https://github.com/apple-oss-distributions/Security/blob/main/OSX/libsecurity_keychain/lib/Access.cpp)
- [Apple public trusted-application API](https://github.com/apple-oss-distributions/Security/blob/main/OSX/libsecurity_keychain/lib/SecTrustedApplication.h)
- [Apple Keychain item API definitions](https://github.com/apple-oss-distributions/Security/blob/main/OSX/libsecurity_keychain/lib/SecKeychainItem.h)
- [Apple code-signing guide](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/Procedures/Procedures.html)
