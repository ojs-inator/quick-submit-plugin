#!/bin/bash

set -e

plugin_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
plugin_parent="$(dirname "$plugin_dir")"
canonical_dir="$plugin_parent/quickSubmit"

if [ "$plugin_dir" != "$canonical_dir" ]; then
    rm -rf "$canonical_dir"
    mv "$plugin_dir" "$canonical_dir"
    plugin_dir="$canonical_dir"
fi

npx cypress run --headless --browser chrome --config "{\"specPattern\":[\"${plugin_dir}/cypress/tests/functional/*.cy.{js,jsx,ts,tsx}\"]}"
