#!/usr/bin/env bash
set -euo pipefail
# tonistiigi's binfmt interpreter expects the target's original argv0 after the
# executable filename, matching the kernel's preserve-argv0 convention.
exec "${SUPPLEMENT_QEMU_ARM:?Missing ARM interpreter}" "$1" "$@"
