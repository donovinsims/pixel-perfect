#!/bin/sh
set -eu
exec node "$(dirname "$0")/scripts/pixel-perfect-clone.mjs" doctor "$@"
