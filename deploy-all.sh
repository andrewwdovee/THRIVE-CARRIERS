#!/usr/bin/env bash
# One command to put every Thrive / Lead Tech page live at once.
#
#   ./deploy-all.sh            the onboarding sites (+ licensing if its folder is there)
#   ./deploy-all.sh --portal   the same, plus the Lead Tech fulfillment portal
#
# Every page links to the others by their permanent addresses
# (thrive-onboarding.pages.dev, thrive-links.pages.dev, ...). Those always
# show the newest production deploy, so a deploy here is all it takes for
# every link everywhere to open the new version. Deploying everything
# together just means no site is left a version behind the rest.
#
# Never share the 8-letter links wrangler prints (abc12345.project.pages.dev):
# those are frozen snapshots of one deploy and never update.
set -euo pipefail

RELAY="https://thrive-relay.aandrewdavidson.workers.dev"
ONBOARDING_URL="https://thrive-onboarding.pages.dev"
HERE="$(cd "$(dirname "$0")" && pwd)"
LICENSING_DIR="${LICENSING_DIR:-$HOME/thrive-onboarding}"
PORTAL_SRC="${PORTAL_SRC:-$HOME/thrive-leadtech-src}"

pages() {  # pages <folder> <project> <production branch>
  echo
  echo "==> $2"
  npx wrangler pages deploy "$1" --project-name "$2" --branch "$3" --commit-dirty=true
}

cd "$HERE" && git pull --ff-only

echo "==> Building the onboarding sites"
(cd onboarding && node build-onboarding.mjs "$RELAY")

pages onboarding/dist             thrive-onboarding    main
pages onboarding/dist/links       thrive-links         main
pages onboarding/dist/marketplace leadtech-marketplace main
pages onboarding/dist/training    thrive-training      MAIN

if [ -d "$LICENSING_DIR/docs" ]; then
  (cd "$LICENSING_DIR" && git pull --ff-only)
  pages "$LICENSING_DIR/docs" thrive-licensing main
else
  echo
  echo "(skipped licensing: no $LICENSING_DIR/docs)"
fi

if [ "${1:-}" = "--portal" ]; then
  echo
  echo "==> Building the Lead Tech portal"
  if [ -d "$PORTAL_SRC" ]; then
    (cd "$PORTAL_SRC" && git pull --ff-only)
  else
    git clone -b claude/build-this-fy7tpt https://github.com/andrewwdovee/THRIVE-CARRIERS.git "$PORTAL_SRC"
  fi
  (cd "$PORTAL_SRC" && npm ci && npm run artifact)
  cp "$PORTAL_SRC/artifact/fulfillment-desk.html" deploy/_leadtech-content.html
  (cd deploy && node build-leadtech.mjs "$RELAY" --onboarding "$ONBOARDING_URL")
  pages deploy/dist-leadtech thrive-leadtech main
fi

echo
echo "==> Checking each site serves the newest build"
for url in \
  "$ONBOARDING_URL/" "$ONBOARDING_URL/welcome/" "$ONBOARDING_URL/start-time/" \
  "https://thrive-links.pages.dev/" "https://leadtech-marketplace.pages.dev/" \
  "https://thrive-training.pages.dev/" "https://thrive-licensing.pages.dev/"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$url" || echo "---")
  printf '  %s  %s\n' "$code" "$url"
done
echo "Done. Every link now opens the new version."
