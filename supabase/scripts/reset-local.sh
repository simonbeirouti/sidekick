#!/bin/sh

set -eu

WORKDIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)

supabase db reset --workdir "$WORKDIR" --local --yes
