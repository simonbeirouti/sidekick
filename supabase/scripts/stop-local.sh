#!/bin/sh

set -eu

WORKDIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)

supabase stop --workdir "$WORKDIR" --yes
