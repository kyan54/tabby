# Append missing platform assets to v1.0.238-fix

The existing Release ID is 416434182. The immutable application source is
b72b9b6e2feb7b5e352afd6b47c2f41fce3bfcf1 and version is 1.0.238-fix.
The five existing assets, IDs, sizes and hashes are frozen in
scripts/supplement/policy.cjs. The tag is never moved; assets are never deleted
or overwritten. A differing collision or changed original asset stops publication.
An interrupted append may resume only identical already-uploaded bytes.

The supplemental workflow builds Intel macOS DMG/ZIP; Windows x64/arm64 NSIS and
portable ZIP; Linux x64/arm64/armv7l AppImage/DEB/RPM/Pacman/tar.gz; and Web bundle.
Only normal public-repository standard runners are used. ARMv7 builds and CLI
smoke tests execute under QEMU, not native ARMv7 hardware.

Application checkout is pinned. Reviewed build-control helpers are read from
master, allowing failed-job retries to use repaired tooling without rebuilding
successful jobs or changing application source. Each report records both SHAs.
Packaging receives no Keygen/Packagecloud/GitHub publishing credentials. Only the
final append job has contents:write. It waits for all six validated matrix entries,
adds 22 missing products and two separate metadata files, and updates only the
release body to explain actual platform/signing/validation scope.

Intel Mac requires Developer ID signing, notarization, strict codesign and
Gatekeeper. Windows checks only configuration presence, signs with existing
configuration if complete, otherwise explicitly records unsigned outputs and
never suppresses system warnings or changes security policy. Linux package
format/architecture/version/native dependency checks do not imply package signing.
All reports require embedded application version and native-addon architecture
checks plus CLI smoke. This is CI validation, not all-platform real-desktop or
live-SSH acceptance. The original Mac arm64 verification files remain unchanged;
new hashes and evidence live in SHA256SUMS-additional.txt and
BUILD_INFO-additional.json. Expected final count: 29 uploaded assets plus two
GitHub-generated source archives (31 UI entries).

Recovery planning lives in scripts/supplement/recovery.json. Only listed failed
producers are rebuilt; the collector reuses previously validated artifacts from
explicit run IDs. Every reused report must still match the immutable source,
version, architecture, native-load, package and smoke requirements. Missing
producer evidence blocks append. The append job is serialized independently, so
a repair producer can run while the original ARMv7 job continues. VS C++ toolsets
and VC runtime directories are discovered from the installed runner toolchain.

ARMv7 recovery uses Debian-native 7za, squashfs-tools and desktop-file-utils with the checksum-pinned original AppImage runtime. A real ARMv7 AppImage assembly/extraction fixture runs before dependency compilation. Explicit QEMU invocation preserves the binfmt target argv0; runtime bytes and host security settings are unchanged.

To avoid repeating architecture-independent frontend compilation, recovery may copy only app/dist and plugin/dist from the original published, SHA-256-verified Mac arm64 ZIP at the same application commit/version. Native file extensions, ELF/PE/Mach-O magic and symlinks are rejected. ARMv7 native dependencies are rebuilt and validated independently, and frontend provenance is recorded in BUILD_INFO-additional.json. A prepared-source artifact is saved before packaging, allowing package-only retries in the same recovery run.
