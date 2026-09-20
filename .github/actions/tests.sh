#!/bin/bash

set -e

plugin_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

npx cypress run --headless --browser chrome --config "{\"specPattern\":[\"${plugin_dir}/cypress/tests/functional/*.cy.{js,jsx,ts,tsx}\"]}"
