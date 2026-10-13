#!/usr/bin/env bash
# Run `claude plugin test .` inside every plugin directory.
set -u
cd "$(dirname "$0")"

status=0
for plugin in ship boot-guard; do
  echo "=== $plugin"
  (cd "$plugin" && claude plugin test .) || status=1
done
exit $status
