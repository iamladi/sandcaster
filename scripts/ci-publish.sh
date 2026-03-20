#!/usr/bin/env bash
set -euo pipefail

# Publish packages to npm, skipping versions that already exist.
# Uses npm (not bun) for --provenance support.

publish_if_new() {
  local dir="$1"
  local name version

  name=$(node -p "require('./$dir/package.json').name")
  version=$(node -p "require('./$dir/package.json').version")

  if npm view "$name@$version" version >/dev/null 2>&1; then
    echo "Skipping $name@$version (already published)"
  else
    echo "Publishing $name@$version..."
    npm publish --access public "./$dir"
  fi
}

publish_if_new packages/sdk
publish_if_new apps/cli

changeset tag
