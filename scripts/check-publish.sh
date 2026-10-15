#!/usr/bin/env bash
# The publishing contract that used to live in phux scripts/check-install-surface.sh.
# Installer bytes stay in no-phux/phux. This repo copies them at build time and
# proves the deploy still serves those bytes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
failures=0

require() {
  if ! grep -Fq -- "$2" "$ROOT/$1"; then
    echo "missing: $1: $2" >&2
    failures=$((failures + 1))
  fi
}

forbid() {
  if grep -Fq -- "$2" "$ROOT/$1"; then
    echo "stale claim: $1: $2" >&2
    failures=$((failures + 1))
  fi
}

require scripts/sync-docs.ts 'scripts/install.sh'
require scripts/sync-docs.ts '"public/install", "public/install.sh"'
require scripts/sync-docs.ts 'scripts/install-cockpit.sh'
require scripts/sync-docs.ts '"public/install-cockpit", "public/install-cockpit.sh"'
require scripts/sync-docs.ts 'scripts/install-desktop.sh'
require scripts/sync-docs.ts '"public/install-desktop", "public/install-desktop.sh"'
require scripts/sync-docs.ts 'must start with #!/bin/sh'
forbid scripts/sync-docs.ts 'phall1/phux'

require .gitignore 'public/install'
require .gitignore 'public/install.sh'
require .gitignore 'public/install-cockpit'
require .gitignore 'public/install-cockpit.sh'
require .gitignore 'public/install-desktop'
require .gitignore 'public/install-desktop.sh'
require public/_headers '/install-cockpit'
require public/_headers '/install-desktop'

require .github/workflows/site-deploy.yml 'repository: no-phux/phux'
require .github/workflows/site-deploy.yml 'cmp phux/scripts/install-desktop.sh "$downloaded"'
require .github/workflows/site-deploy.yml 'Verify the installers are served'
require .github/workflows/site-deploy.yml 'if [ "$shebang" != '"'"'#!/bin/sh'"'"' ]; then'

require src/pages/index.astro 'install-desktop | sh'
require src/pages/index.astro 'id: "mobile", label: "Mobile", command: ""'
require src/pages/index.astro 'class="install-request" id="beta-form"'
require src/pages/index.astro 'wireBetaRequest('
forbid src/pages/index.astro '-s -- --channel next'

if [ "$failures" -ne 0 ]; then
  echo "publish contract: $failures failure(s)" >&2
  exit 1
fi
echo "publish contract ok"
