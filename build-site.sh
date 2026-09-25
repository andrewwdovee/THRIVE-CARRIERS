#!/usr/bin/env bash
# Wraps thrive-inbound-program.html in a full HTML document at site/index.html
# so it can be hosted on its own (e.g. Cloudflare Pages).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p site
{
  printf '<!doctype html>\n<html lang="en">\n<head>\n'
  printf '<meta charset="utf-8" />\n'
  printf '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />\n'
  printf '<style>html,body{margin:0}img{max-width:100%%}</style>\n'
  cat thrive-inbound-program.html
  printf '\n</html>\n'
} > site/index.html
echo "Built site/index.html ($(wc -c < site/index.html) bytes)"
