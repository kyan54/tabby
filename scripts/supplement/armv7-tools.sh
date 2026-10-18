#!/usr/bin/env bash
# Sourced by the ARMv7 producer; use native Debian host tools and the original
# checksum-pinned electron-builder FUSE2 runtime, without tool binary rewriting.
set -euo pipefail
export ELECTRON_BUILDER_7ZIP_PATH=/usr/bin/7za
export APPIMAGE_TOOLS_PATH=/tmp/tabby-armv7-appimage-tools
archive=/tmp/tabby-appimage-12.0.1.7z
if [ ! -f "$archive" ]; then curl --fail --silent --show-error --location --retry 3 -o "$archive" https://github.com/electron-userland/electron-builder-binaries/releases/download/appimage-12.0.1/appimage-12.0.1.7z; fi
printf '%s  %s\n' d12ff7eb8f1d1ec4652ca5237a7fbdca33acc0c758045636feca62dc6ecb8ec4 "$archive" | sha256sum -c -
mkdir -p "$APPIMAGE_TOOLS_PATH/vendor" "$APPIMAGE_TOOLS_PATH/linux-arm32" "$APPIMAGE_TOOLS_PATH/lib/x64"
7za x -y "$archive" "-o$APPIMAGE_TOOLS_PATH/vendor" >/tmp/tabby-armv7-tool-extract.log
cp "$APPIMAGE_TOOLS_PATH/vendor/runtime-armv7l" "$APPIMAGE_TOOLS_PATH/runtime-armv7l"
ln -sf /usr/bin/mksquashfs "$APPIMAGE_TOOLS_PATH/linux-arm32/mksquashfs"
ln -sf /usr/bin/desktop-file-validate "$APPIMAGE_TOOLS_PATH/linux-arm32/desktop-file-validate"
node - <<'JS'
const fs=require('node:fs')
if(process.arch!=='arm')throw Error('Expected ARMv7 Node runtime')
for(const f of ['/usr/lib/p7zip/7za','/usr/bin/mksquashfs','/usr/bin/desktop-file-validate',process.env.APPIMAGE_TOOLS_PATH+'/runtime-armv7l']){
 const b=fs.readFileSync(f)
 if(b.toString('hex',0,4)!=='7f454c46'||b.readUInt16LE(18)!==40)throw Error('Expected ARM ELF tool: '+f)
}
JS
fixture=$(mktemp -d /tmp/tabby-armv7-appimage-probe-XXXXXX)
mkdir -p "$fixture/input" "$fixture/extract"
printf 'armv7-toolchain-fixture\n' >"$fixture/input/payload.txt"
printf '#!/bin/sh\nexit 0\n' >"$fixture/input/AppRun"
chmod +x "$fixture/input/AppRun"
runtime="$APPIMAGE_TOOLS_PATH/runtime-armv7l"
mksquashfs "$fixture/input" "$fixture/probe.AppImage" -offset "$(stat -c %s "$runtime")" -all-root -noappend -no-progress -quiet -no-xattrs -no-fragments -processors 1
dd if="$runtime" of="$fixture/probe.AppImage" conv=notrunc status=none
chmod +x "$fixture/probe.AppImage"
(cd "$fixture/extract" && ${SUPPLEMENT_APPIMAGE_RUNNER:+"$SUPPLEMENT_APPIMAGE_RUNNER"} "$fixture/probe.AppImage" --appimage-extract >/tmp/tabby-armv7-appimage-probe.log)
cmp "$fixture/input/payload.txt" "$fixture/extract/squashfs-root/payload.txt"
rm -rf "$fixture"
echo 'Native ARMv7 7za, AppImage assembly and actual runtime extraction passed'
