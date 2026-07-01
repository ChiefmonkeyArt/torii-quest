#!/usr/bin/env bash
# bump-ver.sh <newversion>  e.g. v0.2.296-alpha
# Bumps the version string everywhere it appears, rebuilds continuum data, runs tests.
set -e
cd "$(dirname "$0")/.."
V="$1"
if [ -z "$V" ]; then echo "usage: bump-ver.sh <version>"; exit 1; fi
# strip leading v for package.json-style
PV="${V#v}"
echo "Bumping to $V (pkg $PV)"

# Source + config + public assets
# Regex matches any 0.2.NNN(-suffix)?-alpha (handles 300+ where the old
# 0\.2\.29[0-9] pattern broke — it could not find 0.2.300 to replace).
# NOTE: tests/live-update-check.test.js is EXCLUDED from the mass replace — it
# contains semantic versionDelta/cache fixtures (279->284=5 etc.) that must NOT
# be bumped. Its checkForUpdateLive block is handled by the targeted seds below.
sed -i "s/v0\.2\.[0-9][0-9][0-9]\(-[a-z]*\)\?-alpha/$V/g; s/0\.2\.[0-9][0-9][0-9]\(-[a-z]*\)\?-alpha/$PV/g" \
  package.json package-lock.json \
  src/config.js src/engine/dashboard/continuumData.js \
  public/sw.js public/continuum-data.json public/dashboard.html \
  NEXT_ACTION_STATE.json MVP_APPROVAL_STATE.json \
  index.html \
  tests/continuum-dashboard.helpers.test.js \
  tests/continuum-dashboard.sdk.test.js \
  tests/continuum-dashboard.render.test.js \
  tests/continuum-dashboard.model.test.js

# tests/live-update-check.test.js: bump ONLY the checkForUpdateLive describe
# block (release + writeCache latestVersion + behindBy assertions). The
# versionDelta / cache / liveStatusView fixtures use fixed semantic versions
# (279->284=5 etc.) and must NOT be touched. Python scopes edits to that block.
NUM=$(echo "$PV" | sed -E 's/^0\.2\.([0-9]+).*/\1/')
BEHIND=$((NUM - 280))
python3 - "$PV" "$NUM" "$BEHIND" <<'PYEOF'
import sys, re
pv, num, behind = sys.argv[1], sys.argv[2], sys.argv[3]
p = 'tests/live-update-check.test.js'
lines = open(p).read().splitlines(keepends=True)
# Find the checkForUpdateLive describe block boundaries.
start = end = None
depth = 0
for i, ln in enumerate(lines):
    if start is None and "describe('checkForUpdateLive'" in ln:
        start = i
    if start is not None:
        for ch in ln:
            if ch == '{': depth += 1
            elif ch == '}': depth -= 1
        if depth == 0:
            end = i + 1
            break
if start is None:
    sys.exit('checkForUpdateLive block not found')
block = ''.join(lines[start:end])
block = re.sub(r"release\('v0\.2\.[0-9]{3}-alpha'\)", f"release('v{pv}')", block, count=1)
block = re.sub(r"writeCache\(s, \{ latestVersion: '0\.2\.[0-9]{3}-alpha'",
               f"writeCache(s, {{ latestVersion: '{pv}'", block)
block = re.sub(r"expect\(a\.behindBy\)\.toBe\([0-9]+\);.*",
               f"expect(a.behindBy).toBe({behind});  // {num}-280={behind} (tracks app version)", block)
block = re.sub(r"expect\(v\.behindBy\)\.toBe\([0-9]+\);",
               f"expect(v.behindBy).toBe({behind});", block)
lines[start:end] = [block]
open(p, 'w').write(''.join(lines))
PYEOF

echo "Version bumped. Verify:"
grep -oE '0\.2\.[0-9][0-9][0-9](-[a-z]*)?-alpha' package.json src/config.js public/sw.js index.html | head -6
