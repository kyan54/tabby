#!/usr/bin/env bash
set -euo pipefail
export GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0=/work/source GIT_CONFIG_KEY_1=safe.directory GIT_CONFIG_VALUE_1=/work/control
mode=${1:-all}
test "$(git rev-parse HEAD)" = b72b9b6e2feb7b5e352afd6b47c2f41fce3bfcf1
if [ ! -f /tmp/tabby-armv7-foundation-ready ]; then
 apt-get update
 apt-get install -y --no-install-recommends build-essential python3 pkg-config libfontconfig1-dev libsecret-1-dev libarchive-tools zsh ruby-dev rpm cpio curl ca-certificates xvfb xauth libgtk-3-0 libnss3 libgbm1 libasound2 cmake p7zip-full squashfs-tools desktop-file-utils libfuse2
 gem install fpm --no-document
 touch /tmp/tabby-armv7-foundation-ready
fi
source /work/control/scripts/supplement/armv7-tools.sh
if [ ! -f .supplement-prepared.json ]; then
 test "$mode" != package
 curl --fail --location --retry 3 -o /tmp/rustup-init https://static.rust-lang.org/rustup/dist/armv7-unknown-linux-gnueabihf/rustup-init
 chmod +x /tmp/rustup-init
 /tmp/rustup-init -y --profile minimal --default-toolchain stable
 export PATH="$HOME/.cargo/bin:$PATH"
 corepack enable
 yarn --frozen-lockfile --network-timeout 1000000
 basis=/work/frontend-basis
 mkdir -p "$basis"
 for file in BUILD_INFO.json tabby-1.0.238-fix-macos-arm64.zip; do
  curl --fail --silent --show-error --location --retry 3 -o "$basis/$file" "https://github.com/kyan54/tabby/releases/download/v1.0.238-fix/$file"
 done
 7za x -y "$basis/tabby-1.0.238-fix-macos-arm64.zip" "-o$basis/unpacked" >/tmp/tabby-frontend-extract.log
 node /work/control/scripts/supplement/reuse-frontend.cjs "$basis"
 node scripts/prepackage-plugins.mjs
 node -e 'const fs=require("node:fs");const p=require("/work/control/scripts/supplement/policy.cjs");fs.writeFileSync(".supplement-prepared.json",JSON.stringify({source:p.SOURCE,version:p.VERSION,arch:"armv7l",frontendBasis:JSON.parse(fs.readFileSync(".supplement-frontend-basis.json"))}))'
fi
node -e 'const p=require("/work/control/scripts/supplement/policy.cjs");const m=require(process.cwd()+"/.supplement-prepared.json");if(m.source!==p.SOURCE||m.version!==p.VERSION||m.arch!=="armv7l")throw Error("Wrong prepared source")'
git diff --exit-code -- '*.ts' '*.mjs' package.json app/package.json
if [ "$mode" = prepare ]; then exit 0; fi
USE_SYSTEM_FPM=true node scripts/build-linux.mjs
node /work/control/scripts/supplement/check.cjs linux armv7l
