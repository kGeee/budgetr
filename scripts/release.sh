#!/usr/bin/env bash
#
# release.sh — merge a branch into main, bump the app version, tag, and push.
# Pushing the v* tag triggers .github/workflows/release.yml, which builds the
# signed + notarized macOS DMG and publishes the GitHub Release.
#
#   Usage:  scripts/release.sh <branch> <version>
#   Example: scripts/release.sh feat/consolidated 0.4.0
#
# Flags:
#   --no-watch   don't tail the release workflow after pushing
#   --dry-run    print what would happen; make no changes
#
set -euo pipefail

BRANCH="${1:-}"
VERSION="${2:-}"
WATCH=1
DRY=0
for arg in "${@:3}"; do
  case "$arg" in
    --no-watch) WATCH=0 ;;
    --dry-run) DRY=1 ;;
  esac
done

if [[ -z "$BRANCH" || -z "$VERSION" ]]; then
  echo "usage: scripts/release.sh <branch> <version>   e.g. scripts/release.sh feat/x 0.4.0" >&2
  exit 2
fi

VERSION="${VERSION#v}"            # normalize: accept 0.4.0 or v0.4.0
TAG="v${VERSION}"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

run() { if [[ "$DRY" == 1 ]]; then echo "＋ $*"; else eval "$*"; fi; }

# ── preflight ────────────────────────────────────────────────────────────────
[[ -n "$(git status --porcelain)" ]] && { echo "✗ working tree is dirty — commit or stash first." >&2; exit 1; }
git rev-parse --verify "$BRANCH" >/dev/null 2>&1 || { echo "✗ no such branch: $BRANCH" >&2; exit 1; }
git rev-parse --verify "refs/tags/$TAG" >/dev/null 2>&1 && { echo "✗ tag $TAG already exists." >&2; exit 1; }
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "✗ version must be X.Y.Z (got $VERSION)." >&2; exit 1; }

echo "▸ Releasing $TAG from '$BRANCH' → main"

# ── merge branch into an up-to-date main ─────────────────────────────────────
run "git switch main"
run "git pull --ff-only origin main"
run "git merge --no-ff '$BRANCH' -m 'merge: $BRANCH → main ($TAG)'"

# ── bump version (web/package.json), commit, tag ─────────────────────────────
run "npm --prefix web version '$VERSION' --no-git-tag-version >/dev/null"
run "git add web/package.json web/package-lock.json"
run "git commit -m 'release: $TAG'"
run "git tag -a '$TAG' -m '$TAG'"

# ── push (the tag push is what triggers the release workflow) ────────────────
run "git push origin main"
run "git push origin '$TAG'"

if [[ "$DRY" == 1 ]]; then echo "✓ dry run complete."; exit 0; fi

echo "✓ Pushed $TAG. The release workflow is starting."
if [[ "$WATCH" == 1 ]] && command -v gh >/dev/null 2>&1; then
  sleep 5
  RUN_ID="$(gh run list --workflow=release.yml --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)"
  [[ -n "${RUN_ID:-}" ]] && gh run watch "$RUN_ID" --exit-status || echo "  (watch it: gh run watch --workflow=release.yml)"
fi
