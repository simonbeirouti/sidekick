#!/bin/sh

set -eu

WORKDIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)

supabase status --workdir "$WORKDIR" -o env
