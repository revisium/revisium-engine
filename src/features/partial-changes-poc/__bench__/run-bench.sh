#!/usr/bin/env bash
# M3 benchmarks of the partial-changes PoC. They are *.bench.ts files and never run with the default jest config.
#
#   run-bench.sh scale <rows>x<changed> [case,...]  one jest process per case (clean peak RSS per case)
#       cases: ensure verify preview preview-all commit-rows commit-field revert-rows commit-all native-commit native-revert
#   run-bench.sh structure [case,...]               100k-row structure commit with renumbering, replica sync
#   run-bench.sh races [case,...]                   concurrency stress
#   run-bench.sh limits [sizes]                     first native write to a committed table of N rows
#   run-bench.sh drop <like-pattern>                drops matching bench-* projects (e.g. 'bench-run-%')
#   run-bench.sh cleanup                            drops every bench-* project and runs VACUUM FULL
#
# Env:
#   BENCH_TX_TIMEOUT    TRANSACTION_TIMEOUT for the run in ms (default 3600000; use 15000 for the native default)
#   BENCH_NODE_OPTIONS  NODE_OPTIONS (default --expose-gc)
#   BENCH_KEEP_RUNS=1   keep the cloned branch of every case
# Every measurement is printed as one line "BENCH_RESULT {json}".
set -euo pipefail
cd "$(dirname "$0")/../../../.."

CONFIG=src/features/partial-changes-poc/__bench__/jest-bench.config.json
DIR=src/features/partial-changes-poc/__bench__
export TRANSACTION_TIMEOUT="${BENCH_TX_TIMEOUT:-3600000}"
export NODE_OPTIONS="${BENCH_NODE_OPTIONS:---expose-gc}"

jest_run() {
  pnpm exec jest --config "$CONFIG" --runInBand "$@" || echo "BENCH_PROCESS_FAILED exit=$? args=$*"
}

mode="${1:-}"
case "$mode" in
  scale)
    export BENCH_DATASET="${2:?rows x changed, e.g. 100000x100000}"
    cases="${3:-ensure,verify,preview,commit-rows,commit-field,revert-rows,commit-all,native-commit,native-revert}"
    for item in ${cases//,/ }; do
      BENCH_CASES="$item" jest_run "$DIR/scale.bench.ts"
    done
    ;;
  structure)
    cases="${2:-ensure,commit-structure,commit-structure-with-edits,native-commit,replica-sync}"
    for item in ${cases//,/ }; do
      BENCH_CASES="$item" jest_run "$DIR/structure.bench.ts"
    done
    ;;
  races)
    BENCH_CASES="${2:-all}" jest_run "$DIR/races.bench.ts"
    ;;
  limits)
    BENCH_LIMIT_SIZES="${2:-32700,32800,65500,65600}" jest_run "$DIR/native-limits.bench.ts"
    ;;
  drop)
    BENCH_DROP_PATTERN="${2:?like pattern}" jest_run "$DIR/drop-pattern.bench.ts"
    ;;
  cleanup)
    jest_run "$DIR/cleanup.bench.ts"
    ;;
  *)
    sed -n '2,17p' "$0"
    exit 1
    ;;
esac
