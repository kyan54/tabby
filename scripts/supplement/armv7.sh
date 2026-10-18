#!/usr/bin/env bash
set -euo pipefail
export GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0=/work/source GIT_CONFIG_KEY_1=safe.directory GIT_CONFIG_VALUE_1=/work/control
apt-get update
apt-get install -y --no-install-recommends build-essential python3 pkg-config libfontconfig1-dev libsecret-1-dev libarchive-tools zsh ruby-dev rpm cpio curl ca-certificates xvfb xauth libgtk-3-0 libnss3 libgbm1 libasound2 cmake
curl --fail --location --retry 3 -o /tmp/rustup-init https://static.rust-lang.org/rustup/dist/armv7-unknown-linux-gnueabihf/rustup-init
chmod +x /tmp/rustup-init
/tmp/rustup-init -y --profile minimal --default-toolchain stable
export PATH="$HOME/.cargo/bin:$PATH"
gem install fpm --no-document
corepack enable
yarn --frozen-lockfile --network-timeout 1000000
yarn run build
node scripts/prepackage-plugins.mjs
USE_SYSTEM_FPM=true node scripts/build-linux.mjs
node /work/control/scripts/supplement/check.cjs linux armv7l
