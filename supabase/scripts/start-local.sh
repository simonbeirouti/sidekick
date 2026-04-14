#!/bin/sh

set -eu

WORKDIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)

supabase start --workdir "$WORKDIR" --yes
